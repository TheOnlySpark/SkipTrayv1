-- ============================================================================
-- MIGRATION 0030: RBAC Hierarchy Update
-- Introduces UNI_ADMIN and CANTEEN_ADMIN roles and scopes RLS policies.
-- ============================================================================

-- 1. Extend user_role enum
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'UNI_ADMIN';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'CANTEEN_ADMIN';
COMMIT;

-- 2. Create get_my_canteen_id helper function (SECURITY DEFINER prevents infinite recursion)
CREATE OR REPLACE FUNCTION public.get_my_canteen_id()
RETURNS uuid AS $$
  SELECT canteen_id FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE;

-- 2.1 Update Canteens Policies
DROP POLICY IF EXISTS "Tenant Admins can view all canteens" ON public.canteens;
DROP POLICY IF EXISTS "Tenant Admins can manage canteens" ON public.canteens;
DROP POLICY IF EXISTS "Uni Admins can view all canteens in their tenant" ON public.canteens;
DROP POLICY IF EXISTS "Uni Admins can manage canteens in their tenant" ON public.canteens;

CREATE POLICY "Uni Admins can view all canteens in their tenant"
  ON public.canteens FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.get_my_tenant_id()
    AND public.get_user_role() IN ('UNI_ADMIN', 'SUPER_ADMIN')
  );

CREATE POLICY "Uni Admins can manage canteens in their tenant"
  ON public.canteens FOR ALL
  TO authenticated
  USING (
    tenant_id = public.get_my_tenant_id()
    AND public.get_user_role() IN ('UNI_ADMIN', 'SUPER_ADMIN')
  )
  WITH CHECK (
    tenant_id = public.get_my_tenant_id()
    AND public.get_user_role() IN ('UNI_ADMIN', 'SUPER_ADMIN')
  );

-- 3. Update Profiles Policies
DROP POLICY IF EXISTS "Staff/Admin can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Elevated roles can view relevant profiles" ON public.profiles;
DROP POLICY IF EXISTS "Uni Admins can update tenant profiles" ON public.profiles;
DROP POLICY IF EXISTS "Canteen Admins can update canteen profiles" ON public.profiles;

CREATE POLICY "Elevated roles can view relevant profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    (public.get_user_role() = 'SUPER_ADMIN')
    OR
    (public.get_user_role() = 'UNI_ADMIN' AND tenant_id = public.get_my_tenant_id())
    OR
    (public.get_user_role() IN ('CANTEEN_ADMIN', 'STAFF') AND canteen_id = public.get_my_canteen_id())
  );

-- Allow Uni Admins to update profiles in their tenant (e.g. assign canteen admins)
CREATE POLICY "Uni Admins can update tenant profiles"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (public.get_user_role() = 'UNI_ADMIN' AND tenant_id = public.get_my_tenant_id())
  WITH CHECK (public.get_user_role() = 'UNI_ADMIN' AND tenant_id = public.get_my_tenant_id());

-- Allow Canteen Admins to update profiles in their canteen (e.g. assign staff)
CREATE POLICY "Canteen Admins can update canteen profiles"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (public.get_user_role() = 'CANTEEN_ADMIN' AND canteen_id = public.get_my_canteen_id())
  WITH CHECK (public.get_user_role() = 'CANTEEN_ADMIN' AND canteen_id = public.get_my_canteen_id());

-- 4. Update Menu Items Policies
DROP POLICY IF EXISTS "Admin can insert menu items" ON public.menu_items;
DROP POLICY IF EXISTS "Admin can update menu items" ON public.menu_items;
DROP POLICY IF EXISTS "Admin can delete menu items" ON public.menu_items;
DROP POLICY IF EXISTS "Canteen Admin can manage menu items" ON public.menu_items;

CREATE POLICY "Canteen Admin can manage menu items"
  ON public.menu_items FOR ALL
  TO authenticated
  USING (
    public.get_user_role() IN ('CANTEEN_ADMIN', 'SUPER_ADMIN')
    AND canteen_id = public.get_my_canteen_id()
  )
  WITH CHECK (
    public.get_user_role() IN ('CANTEEN_ADMIN', 'SUPER_ADMIN')
    AND canteen_id = public.get_my_canteen_id()
  );

-- 5. Update Orders Policies
DROP POLICY IF EXISTS "Staff can view assigned canteen orders and Admin can view tenant orders" ON public.orders;
DROP POLICY IF EXISTS "Staff can update assigned canteen orders and Admin can update tenant orders" ON public.orders;
DROP POLICY IF EXISTS "Staff and Canteen Admin can view assigned canteen orders and Uni Admin can view tenant orders" ON public.orders;
DROP POLICY IF EXISTS "Staff and Canteen Admin can update assigned canteen orders and Uni Admin can update tenant orders" ON public.orders;

CREATE POLICY "Staff and Canteen Admin can view assigned canteen orders and Uni Admin can view tenant orders"
  ON public.orders FOR SELECT
  TO authenticated
  USING (
    (public.get_user_role() IN ('STAFF', 'CANTEEN_ADMIN') AND canteen_id = public.get_my_canteen_id())
    OR
    (public.get_user_role() IN ('UNI_ADMIN', 'SUPER_ADMIN') AND tenant_id = public.get_my_tenant_id())
  );

CREATE POLICY "Staff and Canteen Admin can update assigned canteen orders and Uni Admin can update tenant orders"
  ON public.orders FOR UPDATE
  TO authenticated
  USING (
    (public.get_user_role() IN ('STAFF', 'CANTEEN_ADMIN') AND canteen_id = public.get_my_canteen_id())
    OR
    (public.get_user_role() IN ('UNI_ADMIN', 'SUPER_ADMIN') AND tenant_id = public.get_my_tenant_id())
  )
  WITH CHECK (
    (public.get_user_role() IN ('STAFF', 'CANTEEN_ADMIN') AND canteen_id = public.get_my_canteen_id())
    OR
    (public.get_user_role() IN ('UNI_ADMIN', 'SUPER_ADMIN') AND tenant_id = public.get_my_tenant_id())
  );

-- 6. Update update_order_status RPC
CREATE OR REPLACE FUNCTION public.update_order_status(
  p_order_id uuid,
  p_status   public.order_status
) RETURNS void AS $$
DECLARE
  v_caller_role public.user_role;
  v_caller_tenant uuid;
  v_caller_canteen uuid;
  v_order_tenant uuid;
  v_order_canteen uuid;
BEGIN
  v_caller_role := public.get_user_role();
  IF v_caller_role NOT IN ('STAFF', 'CANTEEN_ADMIN', 'UNI_ADMIN', 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT tenant_id, canteen_id INTO v_order_tenant, v_order_canteen
  FROM public.orders
  WHERE id = p_order_id;

  IF v_order_tenant IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_caller_role != 'SUPER_ADMIN' THEN
    v_caller_tenant := public.get_my_tenant_id();
    IF v_caller_tenant IS DISTINCT FROM v_order_tenant THEN
      RAISE EXCEPTION 'Access denied: order belongs to another organization';
    END IF;

    -- Staff and Canteen Admin lockdown check
    IF v_caller_role IN ('STAFF', 'CANTEEN_ADMIN') THEN
      SELECT canteen_id INTO v_caller_canteen
      FROM public.profiles
      WHERE id = auth.uid();

      IF v_caller_canteen IS NULL OR v_caller_canteen IS DISTINCT FROM v_order_canteen THEN
        RAISE EXCEPTION 'Access denied: You are only authorized to manage orders for your assigned cafeteria.';
      END IF;
    END IF;
  END IF;

  UPDATE public.orders
  SET
    status       = p_status,
    accepted_at  = CASE WHEN p_status = 'ACCEPTED'  THEN NOW() ELSE accepted_at  END,
    ready_at     = CASE WHEN p_status = 'READY'     THEN NOW() ELSE ready_at     END,
    collected_at = CASE WHEN p_status = 'COLLECTED' THEN NOW() ELSE collected_at END
  WHERE id = p_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

NOTIFY pgrst, 'reload schema';
