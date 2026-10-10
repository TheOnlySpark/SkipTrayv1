-- OTP Generation and Order Placement RPC
CREATE OR REPLACE FUNCTION public.place_order_with_otp(
  p_pickup_time TEXT,
  p_items JSON
) RETURNS uuid AS $$
DECLARE
  v_order_id uuid;
  v_otp text;
  v_user_id uuid;
  v_item json;
BEGIN
  -- Get user id
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
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
    -- check if sold out
    IF EXISTS (SELECT 1 FROM public.menu_items WHERE id = (v_item->>'menu_item_id')::uuid AND is_sold_out = true) THEN
        RAISE EXCEPTION 'An item in your order is sold out';
    END IF;

    INSERT INTO public.order_items (order_id, menu_item_id, quantity)
    VALUES (v_order_id, (v_item->>'menu_item_id')::uuid, (v_item->>'quantity')::int);
  END LOOP;

  RETURN v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Update Order Status RPC
CREATE OR REPLACE FUNCTION public.update_order_status(
  p_order_id uuid,
  p_status public.order_status
) RETURNS void AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('STAFF', 'ADMIN')) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE public.orders
  SET 
    status = p_status,
    accepted_at = CASE WHEN p_status = 'ACCEPTED' THEN now() ELSE accepted_at END,
    ready_at = CASE WHEN p_status = 'READY' THEN now() ELSE ready_at END,
    collected_at = CASE WHEN p_status = 'COLLECTED' THEN now() ELSE collected_at END
  WHERE id = p_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
