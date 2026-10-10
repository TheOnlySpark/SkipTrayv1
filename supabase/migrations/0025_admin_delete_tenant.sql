-- ============================================================================
-- MIGRATION 0025: admin_delete_tenant_cascade
-- Allows SUPER_ADMIN to fully delete a tenant despite foreign key dependencies
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_delete_tenant_cascade(p_tenant_id uuid)
RETURNS json AS $$
DECLARE
  v_orders_deleted int;
  v_users_deleted int;
BEGIN
  -- 1. Security Check
  IF public.get_user_role() != 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'Unauthorized — SUPER_ADMIN role required';
  END IF;

  -- 2. Delete all child records associated with this tenant
  -- item_reviews
  DELETE FROM public.item_reviews WHERE tenant_id = p_tenant_id;
  
  -- order_items (relies on orders, but we can do it via subquery)
  DELETE FROM public.order_items WHERE order_id IN (SELECT id FROM public.orders WHERE tenant_id = p_tenant_id);
  
  -- payments
  DELETE FROM public.payments WHERE tenant_id = p_tenant_id;
  
  -- orders
  WITH deleted_orders AS (
    DELETE FROM public.orders WHERE tenant_id = p_tenant_id RETURNING 1
  ) SELECT count(*) INTO v_orders_deleted FROM deleted_orders;
  
  -- menu_items
  DELETE FROM public.menu_items WHERE tenant_id = p_tenant_id;
  
  -- profiles (these are the tenant's users)
  WITH deleted_profiles AS (
    DELETE FROM public.profiles WHERE tenant_id = p_tenant_id RETURNING 1
  ) SELECT count(*) INTO v_users_deleted FROM deleted_profiles;
  
  -- tenant_settings
  DELETE FROM public.tenant_settings WHERE tenant_id = p_tenant_id;
  
  -- 3. Finally, delete the tenant
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
