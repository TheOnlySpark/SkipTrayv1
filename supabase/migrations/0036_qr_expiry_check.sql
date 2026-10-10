-- ============================================================================
-- MIGRATION 0036: QR Code Expiry Check in verify_pickup_otp
-- Prevents expired QR codes from being accepted after pickup slot + 30 min.
-- Staff can still manually override to collect legitimate late pickups.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.verify_pickup_otp(
  p_order_id   uuid,
  p_otp        text,
  p_is_override boolean DEFAULT false
) RETURNS json AS $$
DECLARE
  v_order      public.orders%rowtype;
  v_pickup_ts  timestamptz;
  v_expiry_ts  timestamptz;
BEGIN
  -- Role gate: only STAFF / ADMIN / SUPER_ADMIN may verify
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('STAFF', 'ADMIN', 'SUPER_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Fetch the order (row-lock for atomicity)
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id AND tenant_id = public.get_my_tenant_id()
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Status gate: order must be READY
  IF v_order.status != 'READY' THEN
    RAISE EXCEPTION 'Order is not ready for pickup';
  END IF;

  -- -----------------------------------------------------------------------
  -- QR EXPIRY GATE
  -- Build a full IST timestamp from the order's creation date + pickup_time.
  -- The QR code is considered expired 30 minutes after the pickup slot.
  -- -----------------------------------------------------------------------
  v_pickup_ts := (
    (v_order.created_at AT TIME ZONE 'Asia/Kolkata')::date
    + v_order.pickup_time::time
  ) AT TIME ZONE 'Asia/Kolkata';

  v_expiry_ts := v_pickup_ts + INTERVAL '30 minutes';

  IF NOW() > v_expiry_ts AND NOT p_is_override THEN
    RETURN json_build_object(
      'success',          false,
      'message',          format(
        'QR code expired. Pickup slot was %s — grace period ended at %s (IST). Use Manual Override if the student is present.',
        to_char(v_pickup_ts AT TIME ZONE 'Asia/Kolkata', 'HH:MI AM'),
        to_char(v_expiry_ts AT TIME ZONE 'Asia/Kolkata', 'HH:MI AM')
      ),
      'requires_override', true
    );
  END IF;
  -- -----------------------------------------------------------------------

  -- Manual override path (staff explicitly confirmed override)
  IF p_is_override THEN
    UPDATE public.orders
    SET status = 'COLLECTED', collected_at = now()
    WHERE id = p_order_id;
    RETURN json_build_object('success', true, 'message', 'Manually overridden and collected');
  END IF;

  -- Attempt gate: block after 3 failed OTP attempts
  IF v_order.otp_attempts >= 3 THEN
    RETURN json_build_object(
      'success',          false,
      'message',          'Too many failed attempts. Manual override required.',
      'requires_override', true
    );
  END IF;

  -- OTP match check
  IF v_order.otp_code = p_otp THEN
    UPDATE public.orders
    SET status = 'COLLECTED', collected_at = now()
    WHERE id = p_order_id;
    RETURN json_build_object('success', true, 'message', 'OTP verified successfully');
  ELSE
    UPDATE public.orders
    SET otp_attempts = otp_attempts + 1
    WHERE id = p_order_id;

    IF v_order.otp_attempts + 1 >= 3 THEN
      RETURN json_build_object(
        'success',          false,
        'message',          'Invalid OTP. Too many failed attempts. Manual override required.',
        'requires_override', true
      );
    ELSE
      RETURN json_build_object(
        'success',          false,
        'message',          'Invalid OTP.',
        'requires_override', false
      );
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;
