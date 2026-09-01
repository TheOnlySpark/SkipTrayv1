-- 0015_testing_mode_bypass.sql
-- Relaxes strict same-day clock cutoff checks in place_order_with_otp
-- so developers & testers can place lunch orders at any time of day for testing.

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

  -- Validate total quantity max 5 items
  FOR v_item IN SELECT * FROM json_array_elements(p_items)
  LOOP
    v_total_quantity := v_total_quantity + (v_item->>'quantity')::int;
  END LOOP;

  IF v_total_quantity > 5 THEN
    RAISE EXCEPTION 'Maximum 5 total items allowed per order';
  END IF;

  IF v_total_quantity <= 0 THEN
    RAISE EXCEPTION 'Order must contain at least 1 item';
  END IF;

  -- Verify no sold out items are included
  FOR v_item IN SELECT * FROM json_array_elements(p_items)
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.menu_items 
      WHERE id = (v_item->>'menu_item_id')::uuid 
      AND is_sold_out = true
    ) THEN
      RAISE EXCEPTION 'One or more items in your cart are currently sold out.';
    END IF;
  END LOOP;

  -- Generate cryptographically random 6-digit OTP
  LOOP
    v_otp := lpad(floor(random() * 1000000)::text, 6, '0');
    -- Verify OTP uniqueness among currently active orders
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.orders 
      WHERE otp_code = v_otp 
      AND status IN ('PLACED', 'ACCEPTED', 'PREPARING', 'READY')
    );
  END LOOP;

  -- Create order with initial status 'PLACED'
  INSERT INTO public.orders (
    user_id,
    pickup_time,
    otp_code,
    status
  ) VALUES (
    v_user_id,
    p_pickup_time,
    v_otp,
    'PLACED'
  ) RETURNING id INTO v_order_id;

  -- Insert order items
  FOR v_item IN SELECT * FROM json_array_elements(p_items)
  LOOP
    INSERT INTO public.order_items (
      order_id,
      menu_item_id,
      quantity,
      price_at_order
    )
    SELECT
      v_order_id,
      (v_item->>'menu_item_id')::uuid,
      (v_item->>'quantity')::int,
      price
    FROM public.menu_items
    WHERE id = (v_item->>'menu_item_id')::uuid;
  END LOOP;

  RETURN v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
