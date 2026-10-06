-- ============================================================================
-- MIGRATION 0024: Tenant-Scoped RPC Functions
-- Updates all existing RPCs + adds 3 new ones for tenant management.
-- ============================================================================

-- -----------------------------------------------------------------------
-- 1. handle_new_user trigger
--    Now reads tenant_id from app_metadata (set by frontend at signup).
--    Supports email+password auth — no phone derivation needed.
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  -- tenant_id passed via supabase.auth.signUp options.data → raw_user_meta_data
  v_tenant_id := (new.raw_user_meta_data->>'tenant_id')::uuid;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id is required in app_metadata for new user signup';
  END IF;

  INSERT INTO public.profiles (id, role, tenant_id)
  VALUES (new.id, 'STUDENT', v_tenant_id);

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- -----------------------------------------------------------------------
-- 2. place_order_with_otp
--    Adds tenant_id to INSERT; scopes menu item validation to tenant.
-- -----------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.place_order_with_otp(TEXT, JSON);
DROP FUNCTION IF EXISTS public.place_order_with_otp(TEXT, JSON, BOOLEAN);

CREATE OR REPLACE FUNCTION public.place_order_with_otp(
  p_pickup_time TEXT,
  p_items JSON,
  p_is_takeaway BOOLEAN DEFAULT false
) RETURNS uuid AS $$
DECLARE
  v_order_id       uuid;
  v_otp            text;
  v_user_id        uuid;
  v_tenant_id      uuid;
  v_item           json;
  v_total_quantity int := 0;
  v_suspended_until timestamptz;
  v_now_ist        timestamptz;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_tenant_id := public.get_my_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'User has no tenant association';
  END IF;

  -- Check suspension
  SELECT suspended_until INTO v_suspended_until
  FROM public.profiles WHERE id = v_user_id;

  IF v_suspended_until IS NOT NULL AND v_suspended_until > NOW() THEN
    RAISE EXCEPTION 'Your account is deactivated until % due to repeated order no-shows (2 strikes).',
      to_char(v_suspended_until AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH:MI AM (IST)');
  END IF;

  v_now_ist := NOW() AT TIME ZONE 'Asia/Kolkata';

  IF EXTRACT(DOW FROM v_now_ist) = 0 THEN
    RAISE EXCEPTION 'Orders cannot be placed on Sundays. The canteen is closed.';
  END IF;

  IF v_now_ist::time < TIME '09:30:00' THEN
    RAISE EXCEPTION 'Lunch booking opens at 9:30 AM in the morning.';
  END IF;

  IF p_pickup_time !~ '^\d{2}:\d{2}$' THEN
    RAISE EXCEPTION 'Invalid pickup time format. Use HH:MM.';
  END IF;

  IF p_pickup_time NOT IN ('11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30') THEN
    RAISE EXCEPTION 'Invalid pickup slot. Lunch pickup slots are available only between 11:30 AM and 2:30 PM in 30-minute intervals.';
  END IF;

  IF (v_now_ist::date + p_pickup_time::time) < (v_now_ist + INTERVAL '29 minutes') THEN
    RAISE EXCEPTION 'Orders must be placed at least 30 minutes in advance of the pickup slot.';
  END IF;

  IF p_items IS NULL OR json_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must contain at least one item';
  END IF;

  IF json_array_length(p_items) > 5 THEN
    RAISE EXCEPTION 'Maximum 5 distinct items per order';
  END IF;

  FOR v_item IN SELECT * FROM json_array_elements(p_items) LOOP
    IF (v_item->>'quantity')::int < 1 THEN
      RAISE EXCEPTION 'Item quantity must be at least 1';
    END IF;
    IF (v_item->>'quantity')::int > 10 THEN
      RAISE EXCEPTION 'Maximum quantity per item is 10';
    END IF;

    v_total_quantity := v_total_quantity + (v_item->>'quantity')::int;

    -- Validate menu item belongs to THIS tenant
    IF NOT EXISTS (
      SELECT 1 FROM public.menu_items
      WHERE id = (v_item->>'menu_item_id')::uuid AND tenant_id = v_tenant_id
    ) THEN
      RAISE EXCEPTION 'Menu item not found';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.menu_items
      WHERE id = (v_item->>'menu_item_id')::uuid
        AND tenant_id = v_tenant_id
        AND is_sold_out = true
    ) THEN
      RAISE EXCEPTION 'An item in your order is sold out';
    END IF;
  END LOOP;

  IF v_total_quantity > 15 THEN
    RAISE EXCEPTION 'Total quantity across all items cannot exceed 15';
  END IF;

  v_otp := lpad(floor(random() * 1000000)::text, 6, '0');

  -- OTP uniqueness scoped to THIS tenant only
  WHILE EXISTS (
    SELECT 1 FROM public.orders
    WHERE otp_code = v_otp
      AND tenant_id = v_tenant_id
      AND status IN ('PLACED', 'ACCEPTED', 'PREPARING', 'READY')
  ) LOOP
    v_otp := lpad(floor(random() * 1000000)::text, 6, '0');
  END LOOP;

  -- Insert order WITH tenant_id
  INSERT INTO public.orders (user_id, status, pickup_time, otp_code, is_takeaway, tenant_id)
  VALUES (v_user_id, 'PLACED', p_pickup_time, v_otp, p_is_takeaway, v_tenant_id)
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM json_array_elements(p_items) LOOP
    INSERT INTO public.order_items (order_id, menu_item_id, quantity)
    VALUES (v_order_id, (v_item->>'menu_item_id')::uuid, (v_item->>'quantity')::int);
  END LOOP;

  RETURN v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.place_order_with_otp(TEXT, JSON, BOOLEAN) TO authenticated;


-- -----------------------------------------------------------------------
-- 3. update_order_status — scoped to caller's tenant
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_order_status(
  p_order_id uuid,
  p_status   public.order_status
) RETURNS void AS $$
DECLARE
  v_current_status public.order_status;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('STAFF', 'ADMIN', 'SUPER_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT status INTO v_current_status
  FROM public.orders
  WHERE id = p_order_id AND tenant_id = public.get_my_tenant_id();

  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF NOT (
    (v_current_status = 'PLACED'    AND p_status IN ('ACCEPTED', 'REJECTED')) OR
    (v_current_status = 'ACCEPTED'  AND p_status IN ('PREPARING', 'REJECTED')) OR
    (v_current_status = 'PREPARING' AND p_status = 'READY')
  ) THEN
    RAISE EXCEPTION 'Invalid status transition from % to %', v_current_status, p_status;
  END IF;

  UPDATE public.orders
  SET
    status       = p_status,
    accepted_at  = CASE WHEN p_status = 'ACCEPTED'  THEN now() ELSE accepted_at  END,
    ready_at     = CASE WHEN p_status = 'READY'      THEN now() ELSE ready_at     END,
    collected_at = CASE WHEN p_status = 'COLLECTED'  THEN now() ELSE collected_at END
  WHERE id = p_order_id AND tenant_id = public.get_my_tenant_id();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- -----------------------------------------------------------------------
-- 4. verify_pickup_otp — scoped to caller's tenant
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_pickup_otp(
  p_order_id   uuid,
  p_otp        text,
  p_is_override boolean DEFAULT false
) RETURNS json AS $$
DECLARE
  v_order public.orders%rowtype;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('STAFF', 'ADMIN', 'SUPER_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id AND tenant_id = public.get_my_tenant_id()
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.status != 'READY' THEN
    RAISE EXCEPTION 'Order is not ready for pickup';
  END IF;

  IF p_is_override THEN
    UPDATE public.orders SET status = 'COLLECTED', collected_at = now() WHERE id = p_order_id;
    RETURN json_build_object('success', true, 'message', 'Manually overridden and collected');
  END IF;

  IF v_order.otp_attempts >= 3 THEN
    RETURN json_build_object('success', false, 'message', 'Too many failed attempts. Manual override required.', 'requires_override', true);
  END IF;

  IF v_order.otp_code = p_otp THEN
    UPDATE public.orders SET status = 'COLLECTED', collected_at = now() WHERE id = p_order_id;
    RETURN json_build_object('success', true, 'message', 'OTP verified successfully');
  ELSE
    UPDATE public.orders SET otp_attempts = otp_attempts + 1 WHERE id = p_order_id;
    IF v_order.otp_attempts + 1 >= 3 THEN
      RETURN json_build_object('success', false, 'message', 'Invalid OTP. Too many failed attempts. Manual override required.', 'requires_override', true);
    ELSE
      RETURN json_build_object('success', false, 'message', 'Invalid OTP.', 'requires_override', false);
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- -----------------------------------------------------------------------
-- 5. cancel_order — scoped to caller's tenant
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid)
RETURNS void AS $$
DECLARE
  v_order public.orders%rowtype;
BEGIN
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
    AND user_id = auth.uid()
    AND tenant_id = public.get_my_tenant_id()
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found or not owned by user';
  END IF;

  IF v_order.status NOT IN ('PLACED', 'ACCEPTED') THEN
    RAISE EXCEPTION 'Order cannot be cancelled in its current state';
  END IF;

  IF now() - v_order.created_at > interval '5 minutes' THEN
    RAISE EXCEPTION 'Order can only be cancelled within 5 minutes of placement';
  END IF;

  UPDATE public.orders SET status = 'REJECTED' WHERE id = p_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- -----------------------------------------------------------------------
-- 6. mark_order_no_show — scoped to caller's tenant
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_order_no_show(p_order_id uuid)
RETURNS json AS $$
DECLARE
  v_order          public.orders%rowtype;
  v_user_id        uuid;
  v_current_strikes int;
  v_new_strikes    int;
  v_is_suspended   boolean := false;
  v_suspended_until timestamptz := null;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('STAFF', 'ADMIN', 'SUPER_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id AND tenant_id = public.get_my_tenant_id()
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.status != 'READY' THEN
    RAISE EXCEPTION 'Only orders in READY status can be marked as No-Show';
  END IF;

  v_user_id := v_order.user_id;
  UPDATE public.orders SET status = 'REJECTED' WHERE id = p_order_id;

  SELECT strike_count, suspended_until INTO v_current_strikes, v_suspended_until
  FROM public.profiles WHERE id = v_user_id FOR UPDATE;

  v_new_strikes := COALESCE(v_current_strikes, 0) + 1;

  IF v_new_strikes >= 2 THEN
    v_is_suspended    := true;
    v_suspended_until := NOW() + interval '3 days';
    UPDATE public.profiles SET strike_count = 0, suspended_until = v_suspended_until WHERE id = v_user_id;
  ELSE
    UPDATE public.profiles SET strike_count = v_new_strikes WHERE id = v_user_id;
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
-- 7. admin_reset_student_strikes — scoped to caller's tenant
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_reset_student_strikes(p_student_id uuid)
RETURNS json AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('ADMIN', 'SUPER_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Ensure the student belongs to the same tenant
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_student_id AND tenant_id = public.get_my_tenant_id()
  ) THEN
    RAISE EXCEPTION 'Student not found in your organization';
  END IF;

  UPDATE public.profiles
  SET strike_count = 0, suspended_until = NULL
  WHERE id = p_student_id;

  RETURN json_build_object('success', true, 'message', 'Strikes and suspension cleared successfully');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- -----------------------------------------------------------------------
-- 8. toggle_sold_out — scoped to caller's tenant
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.toggle_sold_out(item_id uuid, new_status boolean)
RETURNS void AS $$
BEGIN
  IF public.get_user_role() NOT IN ('STAFF', 'ADMIN', 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE public.menu_items
  SET is_sold_out = new_status, updated_at = now()
  WHERE id = item_id AND tenant_id = public.get_my_tenant_id();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- -----------------------------------------------------------------------
-- 9. NEW: create_tenant (SUPER_ADMIN only)
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_tenant(
  p_slug text,
  p_name text
) RETURNS uuid AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  IF public.get_user_role() != 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'Unauthorized — SUPER_ADMIN role required';
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

GRANT EXECUTE ON FUNCTION public.create_tenant(text, text) TO authenticated;


-- -----------------------------------------------------------------------
-- 10. NEW: update_tenant_settings (ADMIN of that tenant only)
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_tenant_settings(
  p_display_name  text DEFAULT NULL,
  p_logo_url      text DEFAULT NULL,
  p_primary_color text DEFAULT NULL,
  p_timezone      text DEFAULT NULL
) RETURNS void AS $$
BEGIN
  IF public.get_user_role() NOT IN ('ADMIN', 'SUPER_ADMIN') THEN
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

GRANT EXECUTE ON FUNCTION public.update_tenant_settings(text, text, text, text) TO authenticated;


-- -----------------------------------------------------------------------
-- 11. NEW: admin_toggle_tenant (SUPER_ADMIN only)
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_toggle_tenant(
  p_tenant_id uuid,
  p_is_active  boolean
) RETURNS void AS $$
BEGIN
  IF public.get_user_role() != 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'Unauthorized — SUPER_ADMIN role required';
  END IF;

  UPDATE public.tenants SET is_active = p_is_active WHERE id = p_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.admin_toggle_tenant(uuid, boolean) TO authenticated;


-- -----------------------------------------------------------------------
-- Grant execute on all updated functions
-- -----------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.mark_order_no_show(uuid)                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_student_strikes(uuid)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_order_status(uuid, public.order_status)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_pickup_otp(uuid, text, boolean)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid)                                TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_sold_out(uuid, boolean)                    TO authenticated;
