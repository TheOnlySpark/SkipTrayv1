-- ============================================================================
-- MIGRATION 0042: Hardening Privileged RPC Functions (HIGH-06)
-- Enforces tenant and canteen scoping checks in privileged database RPC functions:
-- 1. mark_order_no_show
-- 2. toggle_sold_out
-- 3. admin_reset_student_strikes
-- ============================================================================

-- -----------------------------------------------------------------------
-- 1. mark_order_no_show
-- Scope:
-- - Role: STAFF, CANTEEN_ADMIN, UNI_ADMIN, SUPER_ADMIN
-- - Tenant: Must match caller's tenant (or SUPER_ADMIN)
-- - Canteen: If STAFF or CANTEEN_ADMIN, order must belong to their canteen
-- - Student strike target must also belong to the same tenant
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_order_no_show(p_order_id uuid)
RETURNS json AS $$
DECLARE
  v_caller_role     public.user_role;
  v_caller_tenant   uuid;
  v_caller_canteen  uuid;
  v_order           public.orders%rowtype;
  v_user_id         uuid;
  v_user_tenant     uuid;
  v_current_strikes int;
  v_new_strikes     int;
  v_is_suspended    boolean := false;
  v_suspended_until timestamptz := null;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  v_caller_role := public.get_user_role();
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('STAFF', 'CANTEEN_ADMIN', 'UNI_ADMIN', 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized: insufficient privileges to mark no-show';
  END IF;

  v_caller_tenant := public.get_my_tenant_id();

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Organization check
  IF v_caller_role != 'SUPER_ADMIN' THEN
    IF v_caller_tenant IS DISTINCT FROM v_order.tenant_id THEN
      RAISE EXCEPTION 'Unauthorized: Order belongs to another organization';
    END IF;

    -- Cafeteria lockdown for Staff and Canteen Admin
    IF v_caller_role IN ('STAFF', 'CANTEEN_ADMIN') THEN
      v_caller_canteen := public.get_my_canteen_id();
      IF v_caller_canteen IS NULL OR v_caller_canteen IS DISTINCT FROM v_order.canteen_id THEN
        RAISE EXCEPTION 'Unauthorized: Order belongs to another cafeteria';
      END IF;
    END IF;
  END IF;

  IF v_order.status != 'READY' THEN
    RAISE EXCEPTION 'Only orders in READY status can be marked as No-Show';
  END IF;

  v_user_id := v_order.user_id;

  -- Check student profile tenant match
  SELECT tenant_id, strike_count, suspended_until
  INTO v_user_tenant, v_current_strikes, v_suspended_until
  FROM public.profiles
  WHERE id = v_user_id
  FOR UPDATE;

  IF v_caller_role != 'SUPER_ADMIN' AND v_user_tenant IS DISTINCT FROM v_caller_tenant THEN
    RAISE EXCEPTION 'Unauthorized: Student belongs to another organization';
  END IF;

  UPDATE public.orders SET status = 'REJECTED' WHERE id = p_order_id;

  v_new_strikes := COALESCE(v_current_strikes, 0) + 1;

  IF v_new_strikes >= 2 THEN
    v_is_suspended    := true;
    v_suspended_until := NOW() + interval '3 days';
    UPDATE public.profiles
    SET strike_count = 0, suspended_until = v_suspended_until
    WHERE id = v_user_id;
  ELSE
    UPDATE public.profiles
    SET strike_count = v_new_strikes
    WHERE id = v_user_id;
  END IF;

  RETURN json_build_object(
    'success',        true,
    'order_id',       p_order_id,
    'user_id',        v_user_id,
    'strike_count',   CASE WHEN v_is_suspended THEN 0 ELSE v_new_strikes END,
    'is_suspended',   v_is_suspended,
    'suspended_until', v_suspended_until
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- -----------------------------------------------------------------------
-- 2. toggle_sold_out
-- Scope:
-- - Role: STAFF, CANTEEN_ADMIN, UNI_ADMIN, SUPER_ADMIN
-- - Tenant: Item must belong to caller's tenant (or SUPER_ADMIN)
-- - Canteen: If STAFF or CANTEEN_ADMIN, item must belong to caller's assigned canteen
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.toggle_sold_out(item_id uuid, new_status boolean)
RETURNS void AS $$
DECLARE
  v_caller_role     public.user_role;
  v_caller_tenant   uuid;
  v_caller_canteen  uuid;
  v_item_tenant     uuid;
  v_item_canteen    uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  v_caller_role := public.get_user_role();
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('STAFF', 'CANTEEN_ADMIN', 'UNI_ADMIN', 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized: insufficient privileges to toggle sold-out status';
  END IF;

  SELECT tenant_id, canteen_id
  INTO v_item_tenant, v_item_canteen
  FROM public.menu_items
  WHERE id = item_id;

  IF v_item_tenant IS NULL THEN
    RAISE EXCEPTION 'Menu item not found';
  END IF;

  IF v_caller_role != 'SUPER_ADMIN' THEN
    v_caller_tenant := public.get_my_tenant_id();
    IF v_caller_tenant IS DISTINCT FROM v_item_tenant THEN
      RAISE EXCEPTION 'Unauthorized: Item belongs to another organization';
    END IF;

    IF v_caller_role IN ('STAFF', 'CANTEEN_ADMIN') THEN
      v_caller_canteen := public.get_my_canteen_id();
      IF v_caller_canteen IS NULL OR v_caller_canteen IS DISTINCT FROM v_item_canteen THEN
        RAISE EXCEPTION 'Unauthorized: Item belongs to another cafeteria';
      END IF;
    END IF;
  END IF;

  UPDATE public.menu_items
  SET is_sold_out = new_status, updated_at = now()
  WHERE id = item_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- -----------------------------------------------------------------------
-- 3. admin_reset_student_strikes
-- Scope:
-- - Role: UNI_ADMIN, SUPER_ADMIN
-- - Tenant: Student must belong to caller's tenant (or SUPER_ADMIN)
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_reset_student_strikes(p_student_id uuid)
RETURNS json AS $$
DECLARE
  v_caller_role   public.user_role;
  v_caller_tenant uuid;
  v_target_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  v_caller_role := public.get_user_role();
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('UNI_ADMIN', 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized: only organization administrators can reset strikes';
  END IF;

  SELECT tenant_id INTO v_target_tenant
  FROM public.profiles
  WHERE id = p_student_id;

  IF v_target_tenant IS NULL THEN
    RAISE EXCEPTION 'Student not found';
  END IF;

  IF v_caller_role != 'SUPER_ADMIN' THEN
    v_caller_tenant := public.get_my_tenant_id();
    IF v_caller_tenant IS DISTINCT FROM v_target_tenant THEN
      RAISE EXCEPTION 'Student not found in your organization';
    END IF;
  END IF;

  UPDATE public.profiles
  SET strike_count = 0, suspended_until = NULL
  WHERE id = p_student_id;

  RETURN json_build_object('success', true, 'message', 'Strikes and suspension cleared successfully');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Permissions
GRANT EXECUTE ON FUNCTION public.mark_order_no_show(uuid)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_sold_out(uuid, boolean)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_student_strikes(uuid)  TO authenticated;
