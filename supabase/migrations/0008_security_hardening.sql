-- =============================================================================
-- SECURITY HARDENING MIGRATION
-- Covers: HIGH-3, HIGH-4, MED-2, MED-3, MED-4, MED-6
-- =============================================================================

-- HIGH-3: Fix item_reviews update policy — prevent users from spoofing admin_reply
-- Users should only be able to delete and re-create reviews, not update them.
-- The admin_reply field should only be writable by admins.
DROP POLICY IF EXISTS "Users can update their own reviews" ON public.item_reviews;
-- (Admin update policy remains intact — admins can still reply)

-- HIGH-4: Add SET search_path = public to all SECURITY DEFINER functions
-- This prevents search_path hijacking attacks.

-- Fix place_order_with_otp (also includes MED-2, MED-3, MED-4 validations)
CREATE OR REPLACE FUNCTION public.place_order_with_otp(
  p_pickup_time TEXT,
  p_items JSON
) RETURNS uuid AS $$
DECLARE
  v_order_id uuid;
  v_otp text;
  v_user_id uuid;
  v_item json;
  v_total_quantity int := 0;
BEGIN
  -- Get user id
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- MED-2: Validate pickup_time format (HH:MM)
  IF p_pickup_time !~ '^\d{2}:\d{2}$' THEN
    RAISE EXCEPTION 'Invalid pickup time format. Use HH:MM.';
  END IF;

  -- MED-4: Validate items array is not empty
  IF p_items IS NULL OR json_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must contain at least one item';
  END IF;

  -- MED-4: Validate items array does not exceed limit
  IF json_array_length(p_items) > 5 THEN
    RAISE EXCEPTION 'Maximum 5 distinct items per order';
  END IF;

  -- MED-3 & MED-4: Validate individual items
  FOR v_item IN SELECT * FROM json_array_elements(p_items) LOOP
    -- MED-3: Validate quantity bounds
    IF (v_item->>'quantity')::int < 1 THEN
      RAISE EXCEPTION 'Item quantity must be at least 1';
    END IF;
    IF (v_item->>'quantity')::int > 10 THEN
      RAISE EXCEPTION 'Maximum quantity per item is 10';
    END IF;

    v_total_quantity := v_total_quantity + (v_item->>'quantity')::int;

    -- Validate the menu item exists and is not sold out
    IF NOT EXISTS (SELECT 1 FROM public.menu_items WHERE id = (v_item->>'menu_item_id')::uuid) THEN
      RAISE EXCEPTION 'Menu item not found';
    END IF;

    IF EXISTS (SELECT 1 FROM public.menu_items WHERE id = (v_item->>'menu_item_id')::uuid AND is_sold_out = true) THEN
      RAISE EXCEPTION 'An item in your order is sold out';
    END IF;
  END LOOP;

  -- Enforce total quantity limit
  IF v_total_quantity > 15 THEN
    RAISE EXCEPTION 'Total quantity across all items cannot exceed 15';
  END IF;

  -- Generate OTP (6 digits)
  v_otp := lpad(floor(random() * 1000000)::text, 6, '0');

  -- Ensure uniqueness of OTP (simple loop)
  WHILE EXISTS (SELECT 1 FROM public.orders WHERE otp_code = v_otp AND status IN ('PLACED', 'ACCEPTED', 'PREPARING', 'READY')) LOOP
    v_otp := lpad(floor(random() * 1000000)::text, 6, '0');
  END LOOP;

  -- Insert order
  INSERT INTO public.orders (user_id, status, pickup_time, otp_code)
  VALUES (v_user_id, 'PLACED', p_pickup_time, v_otp)
  RETURNING id INTO v_order_id;

  -- Insert items
  FOR v_item IN SELECT * FROM json_array_elements(p_items) LOOP
    INSERT INTO public.order_items (order_id, menu_item_id, quantity)
    VALUES (v_order_id, (v_item->>'menu_item_id')::uuid, (v_item->>'quantity')::int);
  END LOOP;

  RETURN v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- Fix update_order_status (also includes MED-6 state machine validation)
CREATE OR REPLACE FUNCTION public.update_order_status(
  p_order_id uuid,
  p_status public.order_status
) RETURNS void AS $$
DECLARE
  v_current_status public.order_status;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('STAFF', 'ADMIN')) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Get current status
  SELECT status INTO v_current_status FROM public.orders WHERE id = p_order_id;
  
  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- MED-6: Enforce valid state transitions
  IF NOT (
    (v_current_status = 'PLACED' AND p_status IN ('ACCEPTED', 'REJECTED')) OR
    (v_current_status = 'ACCEPTED' AND p_status IN ('PREPARING', 'REJECTED')) OR
    (v_current_status = 'PREPARING' AND p_status = 'READY')
    -- Note: READY -> COLLECTED is handled exclusively by verify_pickup_otp RPC
  ) THEN
    RAISE EXCEPTION 'Invalid status transition from % to %', v_current_status, p_status;
  END IF;

  UPDATE public.orders
  SET 
    status = p_status,
    accepted_at = CASE WHEN p_status = 'ACCEPTED' THEN now() ELSE accepted_at END,
    ready_at = CASE WHEN p_status = 'READY' THEN now() ELSE ready_at END,
    collected_at = CASE WHEN p_status = 'COLLECTED' THEN now() ELSE collected_at END
  WHERE id = p_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- Fix verify_pickup_otp (HIGH-4: add search_path)
CREATE OR REPLACE FUNCTION public.verify_pickup_otp(
  p_order_id uuid,
  p_otp text,
  p_is_override boolean DEFAULT false
) RETURNS json AS $$
DECLARE
  v_order public.orders%rowtype;
BEGIN
  -- Verify staff/admin role
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('STAFF', 'ADMIN')) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.status != 'READY' THEN
    RAISE EXCEPTION 'Order is not ready for pickup';
  END IF;

  IF p_is_override THEN
    -- Manual override
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


-- Fix cancel_order (HIGH-4: add search_path)
CREATE OR REPLACE FUNCTION public.cancel_order(
  p_order_id uuid
) RETURNS void AS $$
DECLARE
  v_order public.orders%rowtype;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id AND user_id = auth.uid() FOR UPDATE;
  
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


-- Fix check_order_rate_limit (HIGH-4: add search_path)
CREATE OR REPLACE FUNCTION public.check_order_rate_limit()
RETURNS trigger AS $$
DECLARE
  recent_orders_count integer;
BEGIN
  SELECT count(*)
  INTO recent_orders_count
  FROM public.orders
  WHERE user_id = new.user_id
    AND created_at > (now() - interval '1 minute');

  IF recent_orders_count > 0 THEN
    RAISE EXCEPTION 'Rate limit exceeded: You can only place one order per minute.';
  END IF;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- Fix toggle_sold_out (HIGH-4: already had search_path via get_user_role, but adding for consistency)
CREATE OR REPLACE FUNCTION public.toggle_sold_out(item_id uuid, new_status boolean)
RETURNS void AS $$
BEGIN
  IF public.get_user_role() NOT IN ('STAFF', 'ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE public.menu_items
  SET is_sold_out = new_status, updated_at = now()
  WHERE id = item_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- MED-1: Add database-level length constraints on text columns
-- (These serve as a last line of defense even if frontend validation is bypassed)
ALTER TABLE public.profiles 
  ADD CONSTRAINT profiles_name_length CHECK (length(name) <= 100),
  ADD CONSTRAINT profiles_id_number_length CHECK (length(id_number) <= 20);

ALTER TABLE public.menu_items
  ADD CONSTRAINT menu_items_name_length CHECK (length(name) <= 100);

ALTER TABLE public.item_reviews
  ADD CONSTRAINT reviews_feedback_length CHECK (length(feedback_text) <= 1000),
  ADD CONSTRAINT reviews_reply_length CHECK (length(admin_reply) <= 500);
