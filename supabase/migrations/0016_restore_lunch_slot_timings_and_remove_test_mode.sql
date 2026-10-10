-- 0016_restore_lunch_slot_timings_and_remove_test_mode.sql
-- Removes test mode column and restores strict production ordering rules:
-- 1. Lunch booking opens at 9:30 AM in the morning on the same day
-- 2. Minimum lead time between booking and pickup is 30 minutes
-- 3. Lunch pickup slots only from 12:30 PM to 1:40 PM in 10-minute intervals
-- 4. No orders on Sunday (canteen closed)

ALTER TABLE public.orders DROP COLUMN IF EXISTS is_test;

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
  v_now_ist timestamptz;
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

  v_now_ist := NOW() AT TIME ZONE 'Asia/Kolkata';

  -- Check Sunday restriction: App shouldn't accept orders on Sunday
  IF EXTRACT(DOW FROM v_now_ist) = 0 THEN
    RAISE EXCEPTION 'Orders cannot be placed on Sundays. The canteen is closed.';
  END IF;

  -- Check morning opening time: Booking opens at 9:30 AM IST in the morning
  IF v_now_ist::time < TIME '09:30:00' THEN
    RAISE EXCEPTION 'Lunch booking opens at 9:30 AM in the morning.';
  END IF;

  -- Validate pickup_time format (HH:MM)
  IF p_pickup_time !~ '^\d{2}:\d{2}$' THEN
    RAISE EXCEPTION 'Invalid pickup time format. Use HH:MM.';
  END IF;

  -- Enforce Lunch pickup slots from 12:30 PM to 1:40 PM in 10-minute intervals
  IF p_pickup_time NOT IN ('12:30', '12:40', '12:50', '13:00', '13:10', '13:20', '13:30', '13:40') THEN
    RAISE EXCEPTION 'Invalid pickup slot. Lunch pickup slots are available only between 12:30 PM and 1:40 PM in 10-minute intervals.';
  END IF;

  -- Validate order lead time: Must be placed at least 30 minutes in advance of the pickup slot (on same date)
  -- Allow 1 min buffer for network latency/clock skew (29 minutes)
  IF (v_now_ist::date + p_pickup_time::time) < (v_now_ist + INTERVAL '29 minutes') THEN
    RAISE EXCEPTION 'Orders must be placed at least 30 minutes in advance of the pickup slot.';
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

GRANT EXECUTE ON FUNCTION public.place_order_with_otp(TEXT, JSON) TO authenticated;
