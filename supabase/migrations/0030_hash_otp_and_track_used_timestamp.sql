-- =======================================================================
-- Migration 0030: Hash OTPs in orders table & add otp_used_at timestamp
-- =======================================================================
-- 1. Ensure pgcrypto extension is available for sha256 hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

-- 2. Add otp_hash and otp_used_at columns to orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS otp_hash text,
  ADD COLUMN IF NOT EXISTS otp_used_at timestamptz;

-- 3. Backfill otp_hash and otp_used_at for existing orders
UPDATE public.orders
SET
  otp_hash = encode(digest(otp_code, 'sha256'), 'hex'),
  otp_used_at = CASE WHEN status = 'COLLECTED' THEN COALESCE(collected_at, now()) ELSE NULL END
WHERE otp_code IS NOT NULL AND otp_hash IS NULL;

-- 4. Make otp_code nullable and clear its value so raw OTP is not visible in table
ALTER TABLE public.orders ALTER COLUMN otp_code DROP NOT NULL;

-- Clear plain-text otp_code from existing rows for security
UPDATE public.orders
SET otp_code = NULL
WHERE otp_hash IS NOT NULL;

-- 5. Drop old function signatures for place_order_with_otp
DROP FUNCTION IF EXISTS public.place_order_with_otp(TEXT, JSON);
DROP FUNCTION IF EXISTS public.place_order_with_otp(TEXT, JSON, BOOLEAN);
DROP FUNCTION IF EXISTS public.place_order_with_otp(TEXT, JSON, BOOLEAN, UUID);

-- 6. Recreate place_order_with_otp returning JSON with order_id and plain OTP
CREATE OR REPLACE FUNCTION public.place_order_with_otp(
  p_pickup_time TEXT,
  p_items JSON,
  p_is_takeaway BOOLEAN DEFAULT false,
  p_canteen_id UUID DEFAULT NULL
) RETURNS json AS $$
DECLARE
  v_order_id        uuid;
  v_otp             text;
  v_otp_hash        text;
  v_user_id         uuid;
  v_tenant_id       uuid;
  v_canteen_id      uuid := p_canteen_id;
  v_item            json;
  v_total_quantity  int := 0;
  v_suspended_until timestamptz;
  v_now_ist         timestamptz;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_tenant_id := public.get_my_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'User has no tenant association';
  END IF;

  -- RULE: Strictly only ONE active order in progress per profile regardless of canteens
  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE user_id = v_user_id
      AND status IN ('PLACED', 'ACCEPTED', 'PREPARING', 'READY')
  ) THEN
    RAISE EXCEPTION 'You already have an active order in progress. You can only place one active order at a time.';
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
    RAISE EXCEPTION 'Orders cannot be placed on Sundays. The cafeteria is closed.';
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

  -- Resolve default canteen if not provided
  IF v_canteen_id IS NULL THEN
    SELECT id INTO v_canteen_id
    FROM public.canteens
    WHERE tenant_id = v_tenant_id AND is_active = true
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_canteen_id IS NULL THEN
    RAISE EXCEPTION 'No active cafeteria/canteen found for this organization.';
  END IF;

  -- Validate canteen belongs to this tenant and is active
  IF NOT EXISTS (
    SELECT 1 FROM public.canteens
    WHERE id = v_canteen_id AND tenant_id = v_tenant_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Selected cafeteria/canteen is not available.';
  END IF;

  FOR v_item IN SELECT * FROM json_array_elements(p_items) LOOP
    IF (v_item->>'quantity')::int < 1 THEN
      RAISE EXCEPTION 'Item quantity must be at least 1';
    END IF;
    IF (v_item->>'quantity')::int > 10 THEN
      RAISE EXCEPTION 'Maximum quantity per item is 10';
    END IF;

    v_total_quantity := v_total_quantity + (v_item->>'quantity')::int;

    -- Validate menu item belongs to THIS tenant and THIS canteen
    IF NOT EXISTS (
      SELECT 1 FROM public.menu_items
      WHERE id = (v_item->>'menu_item_id')::uuid 
        AND tenant_id = v_tenant_id
        AND canteen_id = v_canteen_id
    ) THEN
      RAISE EXCEPTION 'Menu item not found in the selected cafeteria.';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.menu_items
      WHERE id = (v_item->>'menu_item_id')::uuid
        AND tenant_id = v_tenant_id
        AND canteen_id = v_canteen_id
        AND is_sold_out = true
    ) THEN
      RAISE EXCEPTION 'An item in your order is sold out';
    END IF;
  END LOOP;

  IF v_total_quantity > 15 THEN
    RAISE EXCEPTION 'Total quantity across all items cannot exceed 15';
  END IF;

  v_otp := lpad(floor(random() * 1000000)::text, 6, '0');
  v_otp_hash := encode(digest(v_otp, 'sha256'), 'hex');

  -- OTP uniqueness check using hash scoped to THIS tenant
  WHILE EXISTS (
    SELECT 1 FROM public.orders
    WHERE otp_hash = v_otp_hash
      AND tenant_id = v_tenant_id
      AND status IN ('PLACED', 'ACCEPTED', 'PREPARING', 'READY')
  ) LOOP
    v_otp := lpad(floor(random() * 1000000)::text, 6, '0');
    v_otp_hash := encode(digest(v_otp, 'sha256'), 'hex');
  END LOOP;

  -- Insert order storing hashed OTP (raw otp_code remains NULL in database)
  INSERT INTO public.orders (user_id, status, pickup_time, otp_hash, otp_code, is_takeaway, tenant_id, canteen_id)
  VALUES (v_user_id, 'PLACED', p_pickup_time, v_otp_hash, NULL, p_is_takeaway, v_tenant_id, v_canteen_id)
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM json_array_elements(p_items) LOOP
    INSERT INTO public.order_items (order_id, menu_item_id, quantity)
    VALUES (v_order_id, (v_item->>'menu_item_id')::uuid, (v_item->>'quantity')::int);
  END LOOP;

  -- Return order_id and raw OTP to the student client (to be stored in local session)
  RETURN json_build_object(
    'order_id', v_order_id,
    'otp_code', v_otp
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.place_order_with_otp(TEXT, JSON, BOOLEAN, UUID) TO authenticated;

-- 7. Update verify_pickup_otp to verify against otp_hash and record otp_used_at
CREATE OR REPLACE FUNCTION public.verify_pickup_otp(
  p_order_id   uuid,
  p_otp        text,
  p_is_override boolean DEFAULT false
) RETURNS json AS $$
DECLARE
  v_order public.orders%rowtype;
  v_supplied_hash text;
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
    UPDATE public.orders 
    SET 
      status = 'COLLECTED', 
      collected_at = now(),
      otp_used_at = now()
    WHERE id = p_order_id;
    RETURN json_build_object('success', true, 'message', 'Manually overridden and collected');
  END IF;

  IF v_order.otp_attempts >= 3 THEN
    RETURN json_build_object('success', false, 'message', 'Too many failed attempts. Manual override required.', 'requires_override', true);
  END IF;

  v_supplied_hash := encode(digest(p_otp, 'sha256'), 'hex');

  -- Compare hash (or fallback to legacy otp_code for unmigrated orders if any)
  IF (v_order.otp_hash IS NOT NULL AND v_order.otp_hash = v_supplied_hash)
     OR (v_order.otp_code IS NOT NULL AND v_order.otp_code = p_otp) THEN
    UPDATE public.orders 
    SET 
      status = 'COLLECTED', 
      collected_at = now(),
      otp_used_at = now()
    WHERE id = p_order_id;
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

GRANT EXECUTE ON FUNCTION public.verify_pickup_otp(uuid, text, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
