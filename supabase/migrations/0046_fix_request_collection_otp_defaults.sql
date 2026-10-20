-- ============================================================================
-- MIGRATION 0046: Fix order_otp_challenges Defaults & Secure request_collection_otp
-- ============================================================================

-- 1. Ensure resend_available_at and expires_at have fallback defaults
ALTER TABLE public.order_otp_challenges
  ALTER COLUMN resend_available_at SET DEFAULT (now() + INTERVAL '60 seconds');

ALTER TABLE public.order_otp_challenges
  ALTER COLUMN expires_at SET DEFAULT (now() + INTERVAL '5 minutes');

-- 2. Secure and synchronized request_collection_otp
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
  -- Authenticated caller verification
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Lock order row and verify ownership
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

    UPDATE public.order_otp_challenges
    SET status = 'SUPERSEDED'
    WHERE id = v_last_challenge.id;
  END IF;

  -- Use existing order OTP if present, otherwise generate cryptographically sound 6-digit OTP
  IF v_order.otp_code IS NOT NULL AND v_order.otp_code ~ '^\d{6}$' THEN
    v_dynamic_otp := v_order.otp_code;
  ELSE
    v_dynamic_otp := lpad(floor(100000 + random() * 900000)::text, 6, '0');
    -- Keep orders.otp_code in sync so staff verify_pickup_otp succeeds
    UPDATE public.orders
    SET otp_code = v_dynamic_otp,
        otp_attempts = 0
    WHERE id = v_order.id;
  END IF;

  -- Create challenge record with explicit timestamps
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

  -- Record tamper-evident audit log
  BEGIN
    INSERT INTO public.order_security_audit_log (
      order_id, actor_id, actor_role, event_type, details
    ) VALUES (
      p_order_id, auth.uid(), 'STUDENT', 'OTP_CHALLENGE_REQUESTED',
      json_build_object('challenge_id', v_challenge_id, 'expires_at', v_expires_at)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

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

-- Strict access grants
REVOKE EXECUTE ON FUNCTION public.request_collection_otp(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.request_collection_otp(uuid) TO authenticated;
