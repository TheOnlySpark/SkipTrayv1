-- ============================================================================
-- MIGRATION 0044: Fix MEDIUM-01 — Secure Tenant Assignment During Signup
--                 and Prevent Email Membership Enumeration
--
-- 1. Adds allow_public_registration column to public.tenants (default true,
--    system tenant set to false).
-- 2. Hardens handle_new_user() trigger function:
--    - Validates tenant existence and is_active = true.
--    - Enforces public registration policy (rejects system tenant and inactive tenants).
--    - Ignores client user_metadata for privileges (strictly forces role = 'STUDENT'
--      and canteen_id = NULL for public signups).
--    - Allows server-controlled app_metadata for trusted administrative provisioning.
-- 3. Adds prevent_profile_tenant_tampering trigger on public.profiles:
--    - Prevents users from mutating tenant_id on existing profile records.
-- 4. Hardens check_user_tenant_access() RPC:
--    - Revokes execute permissions from PUBLIC and anon.
--    - Restricts execution strictly to authenticated administrative roles.
--    - Enforces tenant-scoping so University Admins can only inspect their own tenant.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tenant Public Registration Configuration
-- ----------------------------------------------------------------------------

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS allow_public_registration boolean NOT NULL DEFAULT true;

-- Protect the system tenant: Super Admin tenant never permits public self-registration
UPDATE public.tenants
SET allow_public_registration = false
WHERE slug = 'system';


-- ----------------------------------------------------------------------------
-- 2. Hardened handle_new_user() Trigger Function
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  v_tenant_id       uuid;
  v_role            public.user_role := 'STUDENT';
  v_canteen_id      uuid := NULL;
  v_name            text := NULL;
  v_raw_role        text;
  v_tenant_active   boolean;
  v_tenant_slug     text;
  v_allow_public    boolean;
  v_is_server_admin boolean := false;
BEGIN
  -- 1. Determine tenant_id source:
  -- Server-side admin provisioning uses raw_app_meta_data (set only by trusted service role).
  -- Public self-registration uses raw_user_meta_data.
  IF new.raw_app_meta_data IS NOT NULL AND new.raw_app_meta_data ? 'tenant_id' AND (new.raw_app_meta_data->>'tenant_id') IS NOT NULL THEN
    v_tenant_id := (new.raw_app_meta_data->>'tenant_id')::uuid;
    v_is_server_admin := true;
  ELSIF new.raw_user_meta_data IS NOT NULL AND new.raw_user_meta_data ? 'tenant_id' AND (new.raw_user_meta_data->>'tenant_id') IS NOT NULL THEN
    v_tenant_id := (new.raw_user_meta_data->>'tenant_id')::uuid;
  END IF;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Registration denied: Valid institution context is required.';
  END IF;

  -- 2. Verify target tenant existence and status in public.tenants
  SELECT is_active, slug, allow_public_registration
  INTO v_tenant_active, v_tenant_slug, v_allow_public
  FROM public.tenants
  WHERE id = v_tenant_id;

  IF v_tenant_active IS NULL THEN
    RAISE EXCEPTION 'Registration denied: Selected institution does not exist.';
  END IF;

  IF NOT v_tenant_active THEN
    RAISE EXCEPTION 'Registration denied: Selected institution is currently inactive or suspended.';
  END IF;

  -- 3. For public self-registration: enforce approved registration policy
  IF NOT v_is_server_admin THEN
    IF v_tenant_slug = 'system' THEN
      RAISE EXCEPTION 'Registration denied: Direct self-registration is not permitted for the system management tenant.';
    END IF;

    IF NOT v_allow_public THEN
      RAISE EXCEPTION 'Registration denied: This institution does not permit public self-registration.';
    END IF;
  END IF;

  -- 4. Extract name if present
  v_name := COALESCE(new.raw_user_meta_data->>'name', new.raw_app_meta_data->>'name');

  -- 5. Role Assignment:
  -- Privileged roles can ONLY be granted via server-controlled raw_app_meta_data.
  -- Public self-registration is strictly forced to 'STUDENT', ignoring any client metadata.
  IF v_is_server_admin AND new.raw_app_meta_data ? 'role' THEN
    v_raw_role := new.raw_app_meta_data->>'role';
    IF v_raw_role IS NOT NULL AND v_raw_role IN ('STUDENT', 'TEACHER', 'STAFF', 'CANTEEN_ADMIN', 'UNI_ADMIN', 'ADMIN') THEN
      v_role := v_raw_role::public.user_role;
    END IF;
  ELSE
    v_role := 'STUDENT';
  END IF;

  -- 6. Canteen Assignment:
  -- Canteens can ONLY be assigned via server-controlled raw_app_meta_data.
  IF v_is_server_admin AND new.raw_app_meta_data ? 'canteen_id' AND (new.raw_app_meta_data->>'canteen_id') IS NOT NULL THEN
    v_canteen_id := (new.raw_app_meta_data->>'canteen_id')::uuid;
    -- Verify canteen belongs to the same tenant and is active
    IF NOT EXISTS (
      SELECT 1 FROM public.canteens
      WHERE id = v_canteen_id AND tenant_id = v_tenant_id AND is_active = true
    ) THEN
      RAISE EXCEPTION 'Invalid canteen assignment: Canteen % does not belong to tenant % or is inactive.', v_canteen_id, v_tenant_id;
    END IF;
  ELSE
    v_canteen_id := NULL;
  END IF;

  -- 7. Insert profile record atomically
  INSERT INTO public.profiles (id, name, role, tenant_id, canteen_id)
  VALUES (new.id, v_name, v_role, v_tenant_id, v_canteen_id);

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ----------------------------------------------------------------------------
-- 3. Prevent Tenant Tampering on Existing Profiles
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prevent_profile_tenant_tampering()
RETURNS trigger AS $$
BEGIN
  IF OLD.tenant_id IS NOT NULL AND NEW.tenant_id != OLD.tenant_id THEN
    -- Only Super Admins can migrate accounts across tenants
    IF public.get_user_role() != 'SUPER_ADMIN' THEN
      RAISE EXCEPTION 'Unauthorized: tenant_id is immutable and cannot be modified';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_prevent_profile_tenant_tampering ON public.profiles;

CREATE TRIGGER trg_prevent_profile_tenant_tampering
  BEFORE UPDATE OF tenant_id ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_profile_tenant_tampering();


-- ----------------------------------------------------------------------------
-- 4. Harden check_user_tenant_access() RPC
-- ----------------------------------------------------------------------------
-- Restricts execution to authenticated administrators within their own scope.
-- Completely blocks unauthenticated and ordinary user email enumeration.

CREATE OR REPLACE FUNCTION public.check_user_tenant_access(p_email text, p_tenant_id uuid)
RETURNS boolean AS $$
DECLARE
  v_caller_role   public.user_role;
  v_caller_tenant uuid;
  v_has_access    boolean;
BEGIN
  -- 1. Require authenticated session
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required';
  END IF;

  -- 2. Authorization check: Only administrators can query membership status
  v_caller_role := public.get_user_role();
  v_caller_tenant := public.get_my_tenant_id();

  IF v_caller_role NOT IN ('SUPER_ADMIN', 'UNI_ADMIN', 'ADMIN') THEN
    RAISE EXCEPTION 'Forbidden: Insufficient privileges to inspect organization membership';
  END IF;

  -- 3. Multi-tenant scoping: University Admins can ONLY inspect their own university scope
  IF v_caller_role IN ('UNI_ADMIN', 'ADMIN') AND p_tenant_id != v_caller_tenant THEN
    RAISE EXCEPTION 'Forbidden: You cannot inspect membership for a different organization';
  END IF;

  -- 4. Query membership within authorized tenant scope
  SELECT EXISTS (
    SELECT 1
    FROM auth.users u
    JOIN public.profiles p ON p.id = u.id
    WHERE lower(u.email) = lower(trim(p_email))
      AND p.tenant_id = p_tenant_id
  ) INTO v_has_access;

  RETURN v_has_access;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

-- Revoke execution from PUBLIC and unauthenticated (anon) callers
REVOKE ALL ON FUNCTION public.check_user_tenant_access(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_user_tenant_access(text, uuid) FROM anon;

-- Grant execution strictly to authenticated users (inner checks enforce admin role)
GRANT EXECUTE ON FUNCTION public.check_user_tenant_access(text, uuid) TO authenticated;
