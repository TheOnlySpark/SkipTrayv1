-- ============================================================================
-- MIGRATION 0043: Fix HIGH-05 — Prevent Admins from Assigning Staff to Wrong Canteen
-- Hardens staff & canteen assignment at the database layer:
-- 1. Adds tenant-canteen consistency trigger on public.profiles
-- 2. Upgrades handle_new_user() to support atomic server-controlled app_metadata
-- 3. Hardens RLS UPDATE policies on profiles (prevents ownership & scope tampering)
-- 4. Performs data integrity check for existing records
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tenant-Canteen Consistency Trigger on public.profiles
-- ----------------------------------------------------------------------------
-- Ensures no profile can EVER have a canteen_id that belongs to a different tenant,
-- protecting against cross-tenant assignment even via direct DB/API bypass.

CREATE OR REPLACE FUNCTION public.check_profile_canteen_tenant_consistency()
RETURNS trigger AS $$
DECLARE
  v_canteen_tenant uuid;
  v_canteen_active boolean;
BEGIN
  IF NEW.canteen_id IS NOT NULL THEN
    SELECT tenant_id, is_active INTO v_canteen_tenant, v_canteen_active
    FROM public.canteens
    WHERE id = NEW.canteen_id;

    IF v_canteen_tenant IS NULL THEN
      RAISE EXCEPTION 'Target canteen % does not exist', NEW.canteen_id;
    END IF;

    IF v_canteen_tenant != NEW.tenant_id THEN
      RAISE EXCEPTION 'Cross-tenant assignment violation: Canteen % belongs to tenant %, but profile is in tenant %',
        NEW.canteen_id, v_canteen_tenant, NEW.tenant_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_check_profile_canteen_tenant ON public.profiles;

CREATE TRIGGER trg_check_profile_canteen_tenant
  BEFORE INSERT OR UPDATE OF canteen_id, tenant_id ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.check_profile_canteen_tenant_consistency();


-- ----------------------------------------------------------------------------
-- 2. Upgrade handle_new_user() Trigger for Atomic Account Creation
-- ----------------------------------------------------------------------------
-- Reads role and canteen_id from raw_app_meta_data (set only by trusted server),
-- while user-supplied raw_user_meta_data can only default to STUDENT.
-- Atomically assigns the validated canteen_id on creation.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  v_tenant_id   uuid;
  v_role        public.user_role := 'STUDENT';
  v_canteen_id  uuid := NULL;
  v_name        text := NULL;
  v_raw_role    text;
BEGIN
  -- First try to get tenant_id from user_metadata (used by frontend signups)
  v_tenant_id := (new.raw_user_meta_data->>'tenant_id')::uuid;

  -- If not found, try app_metadata (used by edge functions or server-side admin client)
  IF v_tenant_id IS NULL THEN
    v_tenant_id := (new.raw_app_meta_data->>'tenant_id')::uuid;
  END IF;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id is required in either user_metadata or app_metadata for new user signup';
  END IF;

  -- Extract name if present
  v_name := COALESCE(new.raw_user_meta_data->>'name', new.raw_app_meta_data->>'name');

  -- Role can ONLY be elevated via raw_app_meta_data (server-controlled, never raw_user_meta_data)
  v_raw_role := new.raw_app_meta_data->>'role';
  IF v_raw_role IS NOT NULL AND v_raw_role IN ('STUDENT', 'TEACHER', 'STAFF', 'CANTEEN_ADMIN', 'UNI_ADMIN', 'ADMIN') THEN
    v_role := v_raw_role::public.user_role;
  END IF;

  -- Canteen can ONLY be assigned via raw_app_meta_data
  IF new.raw_app_meta_data->>'canteen_id' IS NOT NULL THEN
    v_canteen_id := (new.raw_app_meta_data->>'canteen_id')::uuid;
    -- Verify canteen belongs to the same tenant
    IF NOT EXISTS (
      SELECT 1 FROM public.canteens
      WHERE id = v_canteen_id AND tenant_id = v_tenant_id
    ) THEN
      RAISE EXCEPTION 'Invalid canteen assignment: canteen % does not belong to tenant %', v_canteen_id, v_tenant_id;
    END IF;
  END IF;

  INSERT INTO public.profiles (id, name, role, tenant_id, canteen_id)
  VALUES (new.id, v_name, v_role, v_tenant_id, v_canteen_id);

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ----------------------------------------------------------------------------
-- 3. Hardened RLS UPDATE Policies on public.profiles
-- ----------------------------------------------------------------------------

-- 3.1 Regular Users: Can update their personal info (name, etc.), but
-- CANNOT mutate role, tenant_id, or canteen_id (prevents privilege escalation & ownership tampering).
DROP POLICY IF EXISTS "Users can update own profile"        ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile safely" ON public.profiles;

CREATE POLICY "Users can update own profile safely"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND role = (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid())
    AND tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid())
    AND canteen_id IS NOT DISTINCT FROM (SELECT p.canteen_id FROM public.profiles p WHERE p.id = auth.uid())
  );

-- 3.2 University Admins: Can update profiles in their tenant, but:
-- - CANNOT assign SUPER_ADMIN role
-- - CANNOT change tenant_id away from their university
-- - CANNOT assign a canteen_id outside their university tenant
DROP POLICY IF EXISTS "Uni Admins can update tenant profiles" ON public.profiles;

CREATE POLICY "Uni Admins can update tenant profiles"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (
    public.get_user_role() = 'UNI_ADMIN'
    AND tenant_id = public.get_my_tenant_id()
    AND role != 'SUPER_ADMIN'
  )
  WITH CHECK (
    public.get_user_role() = 'UNI_ADMIN'
    AND tenant_id = public.get_my_tenant_id()
    AND role != 'SUPER_ADMIN'
    AND (
      canteen_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.canteens c
        WHERE c.id = profiles.canteen_id
          AND c.tenant_id = public.get_my_tenant_id()
      )
    )
  );

-- 3.3 Canteen Admins: Reinforce policy from Migration 0042
-- Canteen Admins can only update staff assigned to their own canteen,
-- and cannot reassign role, canteen_id, or tenant_id.
DROP POLICY IF EXISTS "Canteen Admins can update assigned staff profiles" ON public.profiles;

CREATE POLICY "Canteen Admins can update assigned staff profiles"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (
    public.get_user_role() = 'CANTEEN_ADMIN'
    AND role = 'STAFF'
    AND canteen_id = public.get_my_canteen_id()
    AND tenant_id = public.get_my_tenant_id()
  )
  WITH CHECK (
    public.get_user_role() = 'CANTEEN_ADMIN'
    AND role = 'STAFF'
    AND canteen_id = public.get_my_canteen_id()
    AND tenant_id = public.get_my_tenant_id()
  );


-- ----------------------------------------------------------------------------
-- 4. Audit & Verification of Existing Records
-- ----------------------------------------------------------------------------
-- Non-destructive integrity audit reporting any pre-existing inconsistent records.

DO $$
DECLARE
  v_inconsistent_count int;
BEGIN
  SELECT COUNT(*) INTO v_inconsistent_count
  FROM public.profiles p
  JOIN public.canteens c ON p.canteen_id = c.id
  WHERE p.tenant_id != c.tenant_id;

  IF v_inconsistent_count > 0 THEN
    RAISE WARNING 'HIGH-05 Audit: Found % profile(s) with cross-tenant canteen assignments! Please review.', v_inconsistent_count;
  ELSE
    RAISE NOTICE 'HIGH-05 Audit: All profiles have consistent tenant/canteen relationships.';
  END IF;
END $$;
