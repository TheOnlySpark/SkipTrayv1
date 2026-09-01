  -- Migration: 10-minute No-Show, Strike Tracking, and 3-Day Account Deactivation
  -- 1. Extend profiles table with strike_count and suspended_until
  ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS strike_count INTEGER NOT NULL DEFAULT 0 CHECK (strike_count >= 0),
  ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMPTZ DEFAULT NULL;

  -- 2. Create RPC mark_order_no_show for Staff/Admin
  CREATE OR REPLACE FUNCTION public.mark_order_no_show(
    p_order_id uuid
  ) RETURNS json AS $$
  DECLARE
    v_order public.orders%rowtype;
    v_user_id uuid;
    v_current_strikes int;
    v_new_strikes int;
    v_is_suspended boolean := false;
    v_suspended_until timestamptz := null;
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
      RAISE EXCEPTION 'Only orders in READY status can be marked as No-Show';
    END IF;

    v_user_id := v_order.user_id;

    -- Update order status to REJECTED
    UPDATE public.orders 
    SET status = 'REJECTED' 
    WHERE id = p_order_id;

    -- Fetch current student strike count and suspension status
    SELECT strike_count, suspended_until INTO v_current_strikes, v_suspended_until
    FROM public.profiles
    WHERE id = v_user_id
    FOR UPDATE;

    v_new_strikes := COALESCE(v_current_strikes, 0) + 1;

    IF v_new_strikes >= 2 THEN
      v_is_suspended := true;
      v_suspended_until := NOW() + interval '3 days';
      
      UPDATE public.profiles
      SET 
        strike_count = 0,
        suspended_until = v_suspended_until
      WHERE id = v_user_id;
    ELSE
      UPDATE public.profiles
      SET 
        strike_count = v_new_strikes
      WHERE id = v_user_id;
    END IF;

    RETURN json_build_object(
      'success', true,
      'order_id', p_order_id,
      'user_id', v_user_id,
      'strike_count', CASE WHEN v_is_suspended THEN 0 ELSE v_new_strikes END,
      'is_suspended', v_is_suspended,
      'suspended_until', v_suspended_until
    );
  END;
  $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

  -- 3. Update place_order_with_otp to enforce 3-day account deactivation
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
    v_suspended_until timestamptz;
  BEGIN
    -- Get user id
    v_user_id := auth.uid();
    
    IF v_user_id IS NULL THEN
      RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Check if user is suspended/deactivated
    SELECT suspended_until INTO v_suspended_until 
    FROM public.profiles 
    WHERE id = v_user_id;

    IF v_suspended_until IS NOT NULL AND v_suspended_until > NOW() THEN
      RAISE EXCEPTION 'Your account is deactivated until % due to repeated order no-shows (2 strikes).', 
        to_char(v_suspended_until AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH:MI AM (IST)');
    END IF;

    -- Validate pickup_time format (HH:MM)
    IF p_pickup_time !~ '^\d{2}:\d{2}$' THEN
      RAISE EXCEPTION 'Invalid pickup time format. Use HH:MM.';
    END IF;

    -- Validate items array is not empty
    IF p_items IS NULL OR json_array_length(p_items) = 0 THEN
      RAISE EXCEPTION 'Order must contain at least one item';
    END IF;

    -- Validate items array does not exceed limit
    IF json_array_length(p_items) > 5 THEN
      RAISE EXCEPTION 'Maximum 5 distinct items per order';
    END IF;

    -- Validate individual items
    FOR v_item IN SELECT * FROM json_array_elements(p_items) LOOP
      -- Validate quantity bounds
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

    -- Ensure uniqueness of OTP
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

  -- 4. Admin RPC to reset student strikes / lift suspension
  CREATE OR REPLACE FUNCTION public.admin_reset_student_strikes(
    p_student_id uuid
  ) RETURNS json AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN') THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;

    UPDATE public.profiles
    SET 
      strike_count = 0,
      suspended_until = NULL
    WHERE id = p_student_id;

    RETURN json_build_object('success', true, 'message', 'Strikes and suspension cleared successfully');
  END;
  $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

  -- 5. Permissions
  GRANT EXECUTE ON FUNCTION public.mark_order_no_show(uuid) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.admin_reset_student_strikes(uuid) TO authenticated;
