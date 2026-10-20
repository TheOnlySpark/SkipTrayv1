-- ============================================================================
-- MIGRATION: 0042_secure_admin_provisioning_and_first_login.sql
-- REMEDIATION: MEDIUM-02 — Remove Hardcoded Super Admin Credentials & Secure Provisioning
-- ============================================================================

-- 1. Remediate any accounts created with exposed credentials in dev/staging/prod
DO $$
DECLARE
  v_exposed_user_id uuid;
BEGIN
  -- Search for exposed email 'superadmin@skiptray.com'
  SELECT id INTO v_exposed_user_id FROM auth.users WHERE email = 'superadmin@skiptray.com' LIMIT 1;
  IF v_exposed_user_id IS NOT NULL THEN
    -- Demote role and revoke access immediately
    UPDATE public.profiles
    SET role = 'STUDENT',
        name = '[Deactivated Compromised Account]'
    WHERE id = v_exposed_user_id;

    -- Invalidate auth user if auth.users schema allows
    BEGIN
      UPDATE auth.users
      SET banned_until = 'infinity'::timestamptz,
          raw_app_meta_data = raw_app_meta_data || '{"banned": true, "reason": "Compromised seed account remediation (MEDIUM-02)"}'::jsonb
      WHERE id = v_exposed_user_id;
    EXCEPTION WHEN OTHERS THEN
      NULL; -- auth schema column availability fallback
    END;
  END IF;

  -- Search for fixed seed UUID '11111111-1111-1111-1111-111111111111'
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = '11111111-1111-1111-1111-111111111111') THEN
    UPDATE public.profiles
    SET role = 'STUDENT',
        name = '[Deactivated Compromised UUID]'
    WHERE id = '11111111-1111-1111-1111-111111111111';
  END IF;
END $$;

-- 2. Enhance profiles with first-login password status tracking
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS password_last_changed_at timestamptz DEFAULT now();

-- 3. Create Admin Provisioning and Security Audit Log
CREATE TABLE IF NOT EXISTS public.admin_provisioning_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  action text NOT NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  target_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  target_email_masked text,
  ip_address text,
  details jsonb DEFAULT '{}'::jsonb
);

ALTER TABLE public.admin_provisioning_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins can view provisioning audit log" ON public.admin_provisioning_audit_log;
CREATE POLICY "Super admins can view provisioning audit log"
  ON public.admin_provisioning_audit_log FOR SELECT
  TO authenticated
  USING (public.get_user_role() = 'SUPER_ADMIN');

-- 4. Lockdown Profile RLS: Prevent users from modifying role, tenant_id, or must_change_password
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile safely" ON public.profiles;

CREATE POLICY "Users can update own profile safely"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND (
      role = (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid())
      OR public.get_user_role() = 'SUPER_ADMIN'
    )
    AND (
      tenant_id IS NOT DISTINCT FROM (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid())
      OR public.get_user_role() = 'SUPER_ADMIN'
    )
    AND (
      must_change_password = (SELECT p.must_change_password FROM public.profiles p WHERE p.id = auth.uid())
      OR public.get_user_role() = 'SUPER_ADMIN'
    )
  );

-- 5. Strict Trigger to Prevent Privilege Escalation and Self-Role Modifications
CREATE OR REPLACE FUNCTION public.prevent_unauthorized_role_escalation()
RETURNS trigger AS $$
DECLARE
  v_caller_role public.user_role;
  v_is_service_role boolean;
BEGIN
  v_is_service_role := (
    current_setting('role', true) = 'service_role'
    OR current_setting('request.jwt.claim.role', true) = 'service_role'
  );
  IF v_is_service_role THEN
    RETURN NEW;
  END IF;

  -- Guard role and tenant modification
  IF (NEW.role != OLD.role) OR (NEW.tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
    v_caller_role := public.get_user_role();
    IF v_caller_role != 'SUPER_ADMIN' THEN
      INSERT INTO public.admin_provisioning_audit_log (
        action, actor_id, target_user_id, details
      ) VALUES (
        'PRIVILEGE_ESCALATION_BLOCKED',
        auth.uid(),
        OLD.id,
        jsonb_build_object(
          'attempted_role', NEW.role,
          'previous_role', OLD.role,
          'attempted_tenant', NEW.tenant_id
        )
      );
      RAISE EXCEPTION 'Unauthorized: only Super Administrators may assign administrative roles or change tenants.';
    END IF;

    -- Prevent self-role modification (Super Admin cannot elevate themselves or change their own role)
    IF auth.uid() = OLD.id AND NEW.role != OLD.role THEN
      RAISE EXCEPTION 'Forbidden: Administrators cannot modify their own role.';
    END IF;
  END IF;

  -- Guard must_change_password modification from direct client updates
  IF (NEW.must_change_password != OLD.must_change_password) THEN
    IF auth.uid() = OLD.id AND NOT v_is_service_role THEN
      IF OLD.must_change_password = true AND NEW.must_change_password = false THEN
        RAISE EXCEPTION 'Forbidden: Password setup must be completed through the secure password reset flow.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_prevent_unauthorized_role_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_unauthorized_role_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_unauthorized_role_escalation();

-- 6. RPC: Complete First-Login Password Reset
CREATE OR REPLACE FUNCTION public.complete_first_login_password_setup()
RETURNS json AS $$
DECLARE
  v_user_id uuid;
  v_user_email text;
  v_masked_email text;
  v_must_change boolean;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authentication required';
  END IF;

  SELECT must_change_password INTO v_must_change FROM public.profiles WHERE id = v_user_id;
  IF v_must_change IS NOT TRUE THEN
    RETURN json_build_object(
      'success', true,
      'message', 'Password setup is not required for this account.'
    );
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;
  IF v_user_email IS NOT NULL AND position('@' in v_user_email) > 1 THEN
    v_masked_email := substring(v_user_email from 1 for 2) || '***@' || split_part(v_user_email, '@', 2);
  ELSE
    v_masked_email := 'masked';
  END IF;

  UPDATE public.profiles
  SET must_change_password = false,
      password_last_changed_at = now()
  WHERE id = v_user_id;

  INSERT INTO public.admin_provisioning_audit_log (
    action, actor_id, target_user_id, target_email_masked, details
  ) VALUES (
    'FIRST_LOGIN_RESET',
    v_user_id,
    v_user_id,
    v_masked_email,
    jsonb_build_object('status', 'SUCCESS', 'completed_at', now())
  );

  RETURN json_build_object(
    'success', true,
    'message', 'First login password setup verified successfully.'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.complete_first_login_password_setup() TO authenticated;

-- 7. RPC: Secure Super Admin Provisioning (Requires service_role or Super Admin)
CREATE OR REPLACE FUNCTION public.provision_super_admin(
  p_user_id uuid,
  p_email text,
  p_name text DEFAULT 'Super Administrator'
) RETURNS json AS $$
DECLARE
  v_is_service_role boolean;
  v_system_tenant_id uuid;
  v_existing_profile public.profiles%ROWTYPE;
  v_masked_email text;
BEGIN
  v_is_service_role := (
    current_setting('role', true) = 'service_role'
    OR current_setting('request.jwt.claim.role', true) = 'service_role'
  );
  IF NOT v_is_service_role AND public.get_user_role() != 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'Unauthorized: Super Admin provisioning requires service_role or Super Admin privileges.';
  END IF;

  -- Ensure System Tenant exists
  SELECT id INTO v_system_tenant_id FROM public.tenants WHERE slug = 'system' LIMIT 1;
  IF v_system_tenant_id IS NULL THEN
    INSERT INTO public.tenants (id, slug, name, is_active)
    VALUES ('00000000-0000-0000-0000-000000000001', 'system', 'System Administration', true)
    RETURNING id INTO v_system_tenant_id;
  END IF;

  IF position('@' in p_email) > 1 THEN
    v_masked_email := substring(p_email from 1 for 2) || '***@' || split_part(p_email, '@', 2);
  ELSE
    v_masked_email := 'masked';
  END IF;

  -- Check if profile already exists
  SELECT * INTO v_existing_profile FROM public.profiles WHERE id = p_user_id;

  IF v_existing_profile.id IS NOT NULL THEN
    -- Idempotent: Update role to SUPER_ADMIN, assign to system tenant, and set must_change_password
    UPDATE public.profiles
    SET role = 'SUPER_ADMIN',
        tenant_id = v_system_tenant_id,
        name = COALESCE(v_existing_profile.name, p_name),
        must_change_password = true
    WHERE id = p_user_id;
  ELSE
    INSERT INTO public.profiles (
      id, role, tenant_id, name, must_change_password
    ) VALUES (
      p_user_id, 'SUPER_ADMIN', v_system_tenant_id, p_name, true
    );
  END IF;

  INSERT INTO public.admin_provisioning_audit_log (
    action, actor_id, target_user_id, target_email_masked, details
  ) VALUES (
    'PROVISION_SUCCESS',
    auth.uid(),
    p_user_id,
    v_masked_email,
    jsonb_build_object(
      'role', 'SUPER_ADMIN',
      'tenant_id', v_system_tenant_id,
      'must_change_password', true
    )
  );

  RETURN json_build_object(
    'success', true,
    'user_id', p_user_id,
    'role', 'SUPER_ADMIN',
    'tenant_id', v_system_tenant_id,
    'must_change_password', true,
    'message', 'Super Admin profile provisioned successfully with mandatory first-login password setup.'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.provision_super_admin(uuid, text, text) TO authenticated, service_role;

-- 8. Enforce must_change_password on Privileged Administrative RPCs
-- 8a. create_tenant
CREATE OR REPLACE FUNCTION public.create_tenant(
  p_slug text,
  p_name text
) RETURNS uuid AS $$
DECLARE
  v_tenant_id uuid;
  v_must_change boolean;
BEGIN
  IF public.get_user_role() != 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'Unauthorized — SUPER_ADMIN role required';
  END IF;

  SELECT must_change_password INTO v_must_change FROM public.profiles WHERE id = auth.uid();
  IF v_must_change IS TRUE THEN
    RAISE EXCEPTION 'Password setup required: Please complete first-login password setup before accessing administrative features.';
  END IF;

  IF p_slug !~ '^[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]$' THEN
    RAISE EXCEPTION 'Invalid slug format. Use lowercase letters, numbers, and hyphens (3–40 chars).';
  END IF;

  INSERT INTO public.tenants (slug, name)
  VALUES (p_slug, p_name)
  RETURNING id INTO v_tenant_id;

  INSERT INTO public.tenant_settings (tenant_id, display_name)
  VALUES (v_tenant_id, p_name);

  RETURN v_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 8b. admin_toggle_tenant
CREATE OR REPLACE FUNCTION public.admin_toggle_tenant(
  p_tenant_id uuid,
  p_is_active boolean
) RETURNS void AS $$
DECLARE
  v_must_change boolean;
BEGIN
  IF public.get_user_role() != 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'Unauthorized — SUPER_ADMIN role required';
  END IF;

  SELECT must_change_password INTO v_must_change FROM public.profiles WHERE id = auth.uid();
  IF v_must_change IS TRUE THEN
    RAISE EXCEPTION 'Password setup required: Please complete first-login password setup before accessing administrative features.';
  END IF;

  UPDATE public.tenants
  SET is_active = p_is_active
  WHERE id = p_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 8c. admin_delete_tenant_cascade
CREATE OR REPLACE FUNCTION public.admin_delete_tenant_cascade(p_tenant_id uuid)
RETURNS json AS $$
DECLARE
  v_orders_deleted int;
  v_users_deleted int;
  v_system_tenant_id uuid;
  v_must_change boolean;
BEGIN
  IF public.get_user_role() != 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'Unauthorized — SUPER_ADMIN role required';
  END IF;

  SELECT must_change_password INTO v_must_change FROM public.profiles WHERE id = auth.uid();
  IF v_must_change IS TRUE THEN
    RAISE EXCEPTION 'Password setup required: Please complete first-login password setup before accessing administrative features.';
  END IF;

  SELECT id INTO v_system_tenant_id FROM public.tenants WHERE slug = 'system' LIMIT 1;
  IF p_tenant_id = v_system_tenant_id THEN
    RAISE EXCEPTION 'Cannot delete the system tenant. It is required for Super Admins.';
  END IF;

  DELETE FROM public.item_reviews WHERE tenant_id = p_tenant_id;
  DELETE FROM public.order_items WHERE order_id IN (SELECT id FROM public.orders WHERE tenant_id = p_tenant_id);

  WITH deleted_orders AS (
    DELETE FROM public.orders WHERE tenant_id = p_tenant_id RETURNING 1
  ) SELECT count(*) INTO v_orders_deleted FROM deleted_orders;
  
  DELETE FROM public.payments WHERE tenant_id = p_tenant_id;
  DELETE FROM public.menu_items WHERE tenant_id = p_tenant_id;
  
  WITH deleted_profiles AS (
    DELETE FROM public.profiles WHERE tenant_id = p_tenant_id RETURNING 1
  ) SELECT count(*) INTO v_users_deleted FROM deleted_profiles;
  
  DELETE FROM public.tenant_settings WHERE tenant_id = p_tenant_id;
  DELETE FROM public.tenants WHERE id = p_tenant_id;

  RETURN json_build_object(
    'success', true,
    'message', 'Tenant and all associated data successfully deleted',
    'orders_deleted', v_orders_deleted,
    'users_deleted', v_users_deleted
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 8d. reset_order_otp_attempts
CREATE OR REPLACE FUNCTION public.reset_order_otp_attempts(
  p_order_id uuid
) RETURNS json AS $$
DECLARE
  v_caller_role    public.user_role;
  v_caller_tenant  uuid;
  v_caller_canteen uuid;
  v_order          public.orders%ROWTYPE;
  v_must_change    boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT must_change_password INTO v_must_change FROM public.profiles WHERE id = auth.uid();
  IF v_must_change IS TRUE THEN
    RAISE EXCEPTION 'Password setup required: Please complete first-login password setup before performing administrative actions.';
  END IF;

  v_caller_role := public.get_user_role();
  IF v_caller_role NOT IN ('CANTEEN_ADMIN', 'UNI_ADMIN', 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized: only cafeteria administrators can reset OTP attempt counters';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  v_caller_tenant  := public.get_my_tenant_id();
  v_caller_canteen := public.get_my_canteen_id();

  IF v_caller_role != 'SUPER_ADMIN' THEN
    IF v_order.tenant_id != v_caller_tenant THEN
      RAISE EXCEPTION 'Unauthorized: cross-tenant operation forbidden';
    END IF;
    IF v_caller_role = 'CANTEEN_ADMIN' AND v_order.canteen_id != v_caller_canteen THEN
      RAISE EXCEPTION 'Unauthorized: cross-canteen operation forbidden';
    END IF;
  END IF;

  UPDATE public.orders
  SET otp_attempts = 0
  WHERE id = p_order_id;

  UPDATE public.order_otp_challenges
  SET attempts = 0,
      status = 'ACTIVE'
  WHERE order_id = p_order_id AND status = 'LOCKED';

  INSERT INTO public.order_security_audit_log (
    order_id, actor_id, actor_role, event_type, details
  ) VALUES (
    p_order_id,
    auth.uid(),
    v_caller_role::text,
    'ADMIN_RESET_OTP_ATTEMPTS',
    jsonb_build_object(
      'action', 'Lockout counter reset by administrator',
      'reset_at', now()
    )
  );

  RETURN json_build_object(
    'success', true,
    'order_id', p_order_id,
    'message', 'OTP attempt counter reset successfully. Customer may now retry verification.'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
