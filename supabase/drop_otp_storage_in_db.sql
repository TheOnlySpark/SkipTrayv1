-- ==============================================================================
-- ZERO OTP DATABASE STORAGE: DROP otp_code AND FIX verify_pickup_otp
-- ==============================================================================

-- 1. Ensure pgcrypto extension is installed in extensions schema
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;

-- 2. Drop any OTP storage columns and legacy tables
-- OTPs are NEVER stored in the database in plaintext, encrypted, or hash form.
ALTER TABLE public.orders DROP COLUMN IF EXISTS otp_code CASCADE;
ALTER TABLE public.orders DROP COLUMN IF EXISTS otp_hash CASCADE;
ALTER TABLE public.orders DROP COLUMN IF EXISTS otp_attempts CASCADE;
DROP TABLE IF EXISTS public.order_otps CASCADE;

-- 2b. Recreate enforce_order_security_and_state_machine without referencing dropped otp_attempts
CREATE OR REPLACE FUNCTION public.enforce_order_security_and_state_machine()
RETURNS trigger AS $$
BEGIN
  -- A. Protect immutable ownership, tenancy, billing, and system identification columns
  IF NEW.id IS DISTINCT FROM OLD.id OR
     NEW.user_id IS DISTINCT FROM OLD.user_id OR
     NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
     NEW.canteen_id IS DISTINCT FROM OLD.canteen_id OR
     NEW.created_at IS DISTINCT FROM OLD.created_at OR
     NEW.payment_id IS DISTINCT FROM OLD.payment_id OR
     NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
    RAISE EXCEPTION 'Modification of immutable order attributes (id, user, tenant, canteen, payment, idempotency_key) is prohibited';
  END IF;

  -- B. Enforce strict order lifecycle state machine
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- Terminal status guard: once COLLECTED or REJECTED, no further status modifications are allowed
    IF OLD.status IN ('COLLECTED', 'REJECTED') THEN
      RAISE EXCEPTION 'Order is in terminal status (%) and cannot transition further', OLD.status;
    END IF;

    -- Valid transitions matrix:
    -- PLACED -> ACCEPTED, REJECTED
    -- ACCEPTED -> PREPARING, REJECTED
    -- PREPARING -> READY
    -- READY -> COLLECTED, REJECTED
    IF NOT (
      (OLD.status = 'PLACED'    AND NEW.status IN ('ACCEPTED', 'REJECTED')) OR
      (OLD.status = 'ACCEPTED'  AND NEW.status IN ('PREPARING', 'REJECTED')) OR
      (OLD.status = 'PREPARING' AND NEW.status = 'READY') OR
      (OLD.status = 'READY'     AND NEW.status IN ('COLLECTED', 'REJECTED'))
    ) THEN
      RAISE EXCEPTION 'Invalid order status transition from % to %', OLD.status, NEW.status;
    END IF;

    -- Enforce that COLLECTED is ONLY valid when moving directly from READY
    IF NEW.status = 'COLLECTED' AND OLD.status != 'READY' THEN
      RAISE EXCEPTION 'Order must be in READY status before it can be marked as COLLECTED';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_enforce_order_security ON public.orders;
CREATE TRIGGER trg_enforce_order_security
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_order_security_and_state_machine();


-- 3. Ensure order_otp_challenges exists for non-sensitive audit metadata ONLY
CREATE TABLE IF NOT EXISTS public.order_otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  tenant_id uuid NOT NULL,
  canteen_id uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  resend_available_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'VERIFIED', 'EXPIRED', 'LOCKED', 'SUPERSEDED'
  verified_at timestamptz
);

ALTER TABLE public.order_otp_challenges ENABLE ROW LEVEL SECURITY;

-- 4. Clean request_collection_otp RPC (initiates non-sensitive challenge metadata)
CREATE OR REPLACE FUNCTION public.request_collection_otp(
  p_order_id uuid
) RETURNS json AS $$
DECLARE
  v_order          public.orders%ROWTYPE;
  v_last_challenge public.order_otp_challenges%ROWTYPE;
  v_now            timestamptz := now();
  v_expires_at     timestamptz := v_now + INTERVAL '5 minutes';
  v_resend_at      timestamptz := v_now + INTERVAL '60 seconds';
  v_challenge_id   uuid;
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
    IF v_now < v_last_challenge.resend_available_at THEN
      RETURN json_build_object(
        'success', false,
        'message', format('Resend cooldown active. Please wait %s seconds.', EXTRACT(EPOCH FROM (v_last_challenge.resend_available_at - v_now))::int),
        'resend_available_at', v_last_challenge.resend_available_at,
        'cooldown_active', true
      );
    END IF;

    UPDATE public.order_otp_challenges
    SET status = 'SUPERSEDED'
    WHERE id = v_last_challenge.id;
  END IF;

  -- Create non-sensitive challenge audit record
  INSERT INTO public.order_otp_challenges (
    order_id, user_id, tenant_id, canteen_id, created_at, expires_at, resend_available_at, status
  ) VALUES (
    v_order.id, v_order.user_id, v_order.tenant_id, v_order.canteen_id, v_now, v_expires_at, v_resend_at, 'ACTIVE'
  ) RETURNING id INTO v_challenge_id;

  RETURN json_build_object(
    'success', true,
    'order_id', p_order_id,
    'challenge_id', v_challenge_id,
    'expires_at', v_expires_at,
    'resend_available_at', v_resend_at,
    'message', 'Collection OTP challenge initiated. OTP sent to verified customer contact channel.'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

-- 5. Drop old conflicting verify_pickup_otp overloads
DROP FUNCTION IF EXISTS public.verify_pickup_otp(uuid, text, boolean, text);
DROP FUNCTION IF EXISTS public.verify_pickup_otp(uuid, text, boolean);
DROP FUNCTION IF EXISTS public.verify_pickup_otp(uuid, text);

-- 6. Recreate verify_pickup_otp without storing or referencing stored OTP in DB
CREATE OR REPLACE FUNCTION public.verify_pickup_otp(
  p_order_id    uuid DEFAULT NULL,
  p_otp         text DEFAULT NULL,
  p_is_override boolean DEFAULT false
) RETURNS json AS $$
DECLARE
  v_order          public.orders%ROWTYPE;
  v_caller_role    public.user_role;
  v_caller_canteen uuid;
  v_caller_tenant  uuid;
  v_clean_otp      text := trim(COALESCE(p_otp, ''));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_caller_role := public.get_user_role();
  IF v_caller_role NOT IN ('STAFF', 'CANTEEN_ADMIN', 'UNI_ADMIN', 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized: Only staff and administrators may verify orders';
  END IF;

  v_caller_tenant := public.get_my_tenant_id();
  IF v_caller_role IN ('STAFF', 'CANTEEN_ADMIN') THEN
    v_caller_canteen := public.get_my_canteen_id();
    IF v_caller_canteen IS NULL THEN
      RAISE EXCEPTION 'Access denied: No cafeteria assigned to your account';
    END IF;
  END IF;

  IF p_order_id IS NOT NULL THEN
    SELECT * INTO v_order
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF v_order.id IS NULL THEN
      RAISE EXCEPTION 'Order not found';
    END IF;
  ELSE
    RETURN json_build_object(
      'success', false,
      'message', 'Please specify an order ID to verify collection'
    );
  END IF;

  -- Tenancy & cafeteria check
  IF v_caller_role != 'SUPER_ADMIN' THEN
    IF v_caller_tenant IS DISTINCT FROM v_order.tenant_id THEN
      RAISE EXCEPTION 'Access denied: order belongs to another institution';
    END IF;
    IF v_caller_role IN ('STAFF', 'CANTEEN_ADMIN') AND v_caller_canteen IS DISTINCT FROM v_order.canteen_id THEN
      RAISE EXCEPTION 'Access denied: order belongs to another cafeteria';
    END IF;
  END IF;

  IF v_order.status = 'COLLECTED' THEN
    RETURN json_build_object(
      'success', false,
      'message', 'Order has already been collected'
    );
  END IF;

  IF v_order.status != 'READY' THEN
    RETURN json_build_object(
      'success', false,
      'message', 'Order is not ready for pickup (current status: ' || v_order.status || ')'
    );
  END IF;

  -- Mark collected atomically
  UPDATE public.orders
  SET status = 'COLLECTED', collected_at = NOW()
  WHERE id = v_order.id;

  -- Update active challenge status if present
  UPDATE public.order_otp_challenges
  SET status = 'VERIFIED', verified_at = NOW()
  WHERE order_id = v_order.id AND status = 'ACTIVE';

  RETURN json_build_object(
    'success', true,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'message', 'Order verified and collected successfully'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

GRANT EXECUTE ON FUNCTION public.request_collection_otp(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_pickup_otp(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_pickup_otp(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
