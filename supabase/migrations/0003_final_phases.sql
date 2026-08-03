-- Phase 6: OTP Verification RPC
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Phase 7: Cancel Order RPC
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
$$ LANGUAGE plpgsql SECURITY DEFINER;
