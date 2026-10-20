-- ==============================================================================
-- FIX FOR "null value in column "resend_available_at" of relation "order_otp_challenges""
-- Run this in your Supabase SQL Editor.
-- ==============================================================================

-- 1. Ensure resend_available_at has a sensible default so inserts without it succeed
ALTER TABLE public.order_otp_challenges
  ALTER COLUMN resend_available_at SET DEFAULT (now() + INTERVAL '60 seconds');

-- 2. Ensure expires_at has a sensible default
ALTER TABLE public.order_otp_challenges
  ALTER COLUMN expires_at SET DEFAULT (now() + INTERVAL '5 minutes');

-- 3. Replace request_collection_otp to always pass explicit NOT NULL values
CREATE OR REPLACE FUNCTION public.request_collection_otp(
  p_order_id uuid
) RETURNS json AS $$
DECLARE
  v_order          public.orders%ROWTYPE;
  v_last_challenge public.order_otp_challenges%ROWTYPE;
  v_now            timestamptz := clock_timestamp();
  v_expires_at     timestamptz := clock_timestamp() + INTERVAL '5 minutes';
  v_resend_at      timestamptz := clock_timestamp() + INTERVAL '60 seconds';
  v_challenge_id   uuid;
  v_dynamic_otp    text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.user_id != auth.uid() THEN
    RAISE EXCEPTION 'Access denied: You can only request pickup OTP for your own order';
  END IF;

  IF v_order.status != 'READY' THEN
    RAISE EXCEPTION 'Order is not ready for pickup (current status: %). OTP can only be requested for READY orders.', v_order.status;
  END IF;

  -- Resend cooldown check
  SELECT * INTO v_last_challenge
  FROM public.order_otp_challenges
  WHERE order_id = p_order_id AND status = 'ACTIVE'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_last_challenge.id IS NOT NULL THEN
    IF v_last_challenge.resend_available_at IS NOT NULL AND v_now < v_last_challenge.resend_available_at THEN
      RETURN json_build_object(
        'success', false,
        'message', format('Resend cooldown active. Please wait %s seconds.', GREATEST(1, EXTRACT(EPOCH FROM (v_last_challenge.resend_available_at - v_now))::int)),
        'resend_available_at', v_last_challenge.resend_available_at,
        'cooldown_active', true
      );
    END IF;

    -- Invalidate previous active challenge
    UPDATE public.order_otp_challenges
    SET status = 'SUPERSEDED'
    WHERE id = v_last_challenge.id;
  END IF;

  -- Generate dynamic 6-digit OTP returned only in memory to client (zero plaintext storage in db)
  v_dynamic_otp := lpad(floor(100000 + random() * 900000)::text, 6, '0');

  -- Create non-sensitive challenge audit record with guaranteed non-null timestamps
  INSERT INTO public.order_otp_challenges (
    order_id, user_id, tenant_id, canteen_id, created_at, expires_at, resend_available_at, attempts, max_attempts, status
  ) VALUES (
    v_order.id,
    v_order.user_id,
    v_order.tenant_id,
    v_order.canteen_id,
    v_now,
    v_expires_at,
    v_resend_at,
    0,
    5,
    'ACTIVE'
  ) RETURNING id INTO v_challenge_id;

  RETURN json_build_object(
    'success', true,
    'order_id', p_order_id,
    'challenge_id', v_challenge_id,
    'otp', v_dynamic_otp,
    'expires_at', v_expires_at,
    'resend_available_at', v_resend_at,
    'message', 'Pickup OTP generated successfully. Show this code or QR at counter.'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

GRANT EXECUTE ON FUNCTION public.request_collection_otp(uuid) TO authenticated;
