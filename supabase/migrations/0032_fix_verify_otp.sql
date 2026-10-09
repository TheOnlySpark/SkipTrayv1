-- ============================================================================
-- MIGRATION 0032: Fix verify_pickup_otp search_path
-- Adds extensions to the search_path so that any triggers or hashing 
-- functions (like digest from pgcrypto) can resolve correctly without error.
-- ============================================================================

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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;
