-- ============================================================================
-- Fix: Restore Super Admin Profile and Protect System Tenant
-- ============================================================================

-- 1. Modify the delete function to protect the system tenant
CREATE OR REPLACE FUNCTION public.admin_delete_tenant_cascade(p_tenant_id uuid)
RETURNS json AS $$
DECLARE
  v_orders_deleted int;
  v_users_deleted int;
  v_system_tenant_id uuid;
BEGIN
  -- Security Check
  IF public.get_user_role() != 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'Unauthorized — SUPER_ADMIN role required';
  END IF;

  -- Protect the system tenant from being deleted!
  SELECT id INTO v_system_tenant_id FROM public.tenants WHERE slug = 'system' LIMIT 1;
  IF p_tenant_id = v_system_tenant_id THEN
    RAISE EXCEPTION 'Cannot delete the system tenant. It is required for Super Admins.';
  END IF;

  -- Delete all child records associated with this tenant
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

GRANT EXECUTE ON FUNCTION public.admin_delete_tenant_cascade(uuid) TO authenticated;

-- 2. Restore the Super Admin profile if it was accidentally deleted
DO $$
DECLARE
  v_user_id uuid;
  v_tenant_id uuid;
BEGIN
  -- Get the system tenant id
  SELECT id INTO v_tenant_id FROM public.tenants WHERE slug = 'system' LIMIT 1;
  
  -- If the system tenant was deleted, recreate it!
  IF v_tenant_id IS NULL THEN
    INSERT INTO public.tenants (id, slug, name, is_active)
    VALUES ('00000000-0000-0000-0000-000000000000', 'system', 'System Default', true)
    RETURNING id INTO v_tenant_id;

    INSERT INTO public.tenant_settings (tenant_id, display_name)
    VALUES (v_tenant_id, 'System Default');
  END IF;

  -- Find the admin user in auth.users by email
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'admin@skiptray.com' LIMIT 1;

  -- Re-insert their profile so they get SUPER_ADMIN access back
  IF v_user_id IS NOT NULL THEN
    INSERT INTO public.profiles (id, role, tenant_id)
    VALUES (v_user_id, 'SUPER_ADMIN', v_tenant_id)
    ON CONFLICT (id) DO UPDATE SET role = 'SUPER_ADMIN', tenant_id = v_tenant_id;
  END IF;
END $$;
