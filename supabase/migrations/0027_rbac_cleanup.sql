-- ============================================================================
-- MIGRATION 0031: RBAC Hierarchy Cleanup
-- Replaces remaining instances of 'ADMIN' with 'UNI_ADMIN' and incorporates 'CANTEEN_ADMIN'.
-- ============================================================================

-- -----------------------------------------------------------------------
-- 1. TENANT_SETTINGS Policies
-- -----------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin can update own tenant settings" ON public.tenant_settings;

CREATE POLICY "Uni Admin can update own tenant settings"
  ON public.tenant_settings FOR UPDATE
  TO authenticated
  USING (
    tenant_id = public.get_my_tenant_id()
    AND public.get_user_role() IN ('UNI_ADMIN', 'SUPER_ADMIN')
  )
  WITH CHECK (
    tenant_id = public.get_my_tenant_id()
    AND public.get_user_role() IN ('UNI_ADMIN', 'SUPER_ADMIN')
  );

-- -----------------------------------------------------------------------
-- 2. ORDER_ITEMS Policies
-- -----------------------------------------------------------------------
DROP POLICY IF EXISTS "Staff and Admin can view tenant order items" ON public.order_items;

CREATE POLICY "Staff and Canteen Admin can view assigned order items, Uni Admin views all"
  ON public.order_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders
      WHERE id = order_items.order_id
        AND tenant_id = public.get_my_tenant_id()
        AND (
          (public.get_user_role() IN ('STAFF', 'CANTEEN_ADMIN') AND canteen_id = public.get_my_canteen_id())
          OR public.get_user_role() IN ('UNI_ADMIN', 'SUPER_ADMIN')
        )
    )
  );

-- -----------------------------------------------------------------------
-- 3. ITEM_REVIEWS Policies
-- -----------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin can view tenant reviews" ON public.item_reviews;
DROP POLICY IF EXISTS "Admin can update tenant reviews" ON public.item_reviews;
DROP POLICY IF EXISTS "Admin can delete tenant reviews" ON public.item_reviews;

CREATE POLICY "Canteen and Uni Admins can view tenant reviews"
  ON public.item_reviews FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.get_my_tenant_id()
    AND public.get_user_role() IN ('CANTEEN_ADMIN', 'UNI_ADMIN', 'SUPER_ADMIN')
  );

CREATE POLICY "Canteen and Uni Admins can update tenant reviews"
  ON public.item_reviews FOR UPDATE
  TO authenticated
  USING (
    tenant_id = public.get_my_tenant_id()
    AND public.get_user_role() IN ('CANTEEN_ADMIN', 'UNI_ADMIN', 'SUPER_ADMIN')
  )
  WITH CHECK (tenant_id = public.get_my_tenant_id());

CREATE POLICY "Canteen and Uni Admins can delete tenant reviews"
  ON public.item_reviews FOR DELETE
  TO authenticated
  USING (
    tenant_id = public.get_my_tenant_id()
    AND public.get_user_role() IN ('CANTEEN_ADMIN', 'UNI_ADMIN', 'SUPER_ADMIN')
  );

-- -----------------------------------------------------------------------
-- 4. PAYMENTS Policies
-- -----------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin can view tenant payments" ON public.payments;

CREATE POLICY "Staff, Canteen, and Uni Admins can view tenant payments"
  ON public.payments FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.get_my_tenant_id()
    AND public.get_user_role() IN ('STAFF', 'CANTEEN_ADMIN', 'UNI_ADMIN', 'SUPER_ADMIN')
  );

-- -----------------------------------------------------------------------
-- 5. RPC Cleanups (from 0024)
-- -----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_no_show(p_student_id uuid)
RETURNS void AS $$
DECLARE
  v_current_strikes int;
BEGIN
  IF public.get_user_role() NOT IN ('STAFF', 'CANTEEN_ADMIN', 'UNI_ADMIN', 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT strike_count INTO v_current_strikes
  FROM public.profiles
  WHERE id = p_student_id;

  v_current_strikes := COALESCE(v_current_strikes, 0) + 1;

  IF v_current_strikes >= 3 THEN
    UPDATE public.profiles
    SET strike_count = v_current_strikes, suspended_until = NOW() + interval '7 days'
    WHERE id = p_student_id;
  ELSE
    UPDATE public.profiles
    SET strike_count = v_current_strikes
    WHERE id = p_student_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.clear_no_show_strikes(p_student_id uuid)
RETURNS json AS $$
BEGIN
  IF public.get_user_role() NOT IN ('CANTEEN_ADMIN', 'UNI_ADMIN', 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized - Requires Canteen Admin or Uni Admin role';
  END IF;

  UPDATE public.profiles
  SET strike_count = 0, suspended_until = NULL
  WHERE id = p_student_id;

  RETURN json_build_object('success', true, 'message', 'Strikes and suspension cleared successfully');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.toggle_sold_out(item_id uuid, new_status boolean)
RETURNS void AS $$
BEGIN
  IF public.get_user_role() NOT IN ('STAFF', 'CANTEEN_ADMIN', 'UNI_ADMIN', 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE public.menu_items
  SET is_sold_out = new_status, updated_at = now()
  WHERE id = item_id AND tenant_id = public.get_my_tenant_id();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.update_tenant_settings(
  p_display_name  text DEFAULT NULL,
  p_logo_url      text DEFAULT NULL,
  p_primary_color text DEFAULT NULL,
  p_timezone      text DEFAULT NULL
) RETURNS void AS $$
BEGIN
  IF public.get_user_role() NOT IN ('UNI_ADMIN', 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE public.tenant_settings
  SET
    display_name  = COALESCE(p_display_name,  display_name),
    logo_url      = COALESCE(p_logo_url,      logo_url),
    primary_color = COALESCE(p_primary_color, primary_color),
    timezone      = COALESCE(p_timezone,      timezone),
    updated_at    = now()
  WHERE tenant_id = public.get_my_tenant_id();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

NOTIFY pgrst, 'reload schema';
