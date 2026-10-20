-- ==============================================================================
-- FIX FOR "function digest(text, unknown) does not exist" ERROR IN SUPABASE
-- Run this script in your Supabase SQL Editor.
-- ==============================================================================

-- 1. Ensure the pgcrypto extension is installed
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;

-- 2. Drop older conflicting overloads of verify_pickup_otp
DROP FUNCTION IF EXISTS public.verify_pickup_otp(uuid, text, boolean, text);
DROP FUNCTION IF EXISTS public.verify_pickup_otp(uuid, text, boolean);
DROP FUNCTION IF EXISTS public.verify_pickup_otp(uuid, text);

-- 3. Recreate verify_pickup_otp with clean OTP verification & correct search_path
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
  -- Authenticate caller
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_caller_role := public.get_user_role();
  IF v_caller_role NOT IN ('STAFF', 'CANTEEN_ADMIN', 'UNI_ADMIN', 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized: Only cafeteria staff and administrators can verify pickup OTP';
  END IF;

  v_caller_tenant := public.get_my_tenant_id();
  IF v_caller_role IN ('STAFF', 'CANTEEN_ADMIN') THEN
    v_caller_canteen := public.get_my_canteen_id();
    IF v_caller_canteen IS NULL THEN
      RAISE EXCEPTION 'Access denied: No cafeteria assigned to your account';
    END IF;
  END IF;

  -- Resolve target order
  IF p_order_id IS NOT NULL THEN
    SELECT * INTO v_order
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF v_order.id IS NULL THEN
      RAISE EXCEPTION 'Order not found';
    END IF;
  ELSIF v_clean_otp ~ '^\d{6}$' THEN
    IF v_caller_role IN ('STAFF', 'CANTEEN_ADMIN') THEN
      SELECT * INTO v_order
      FROM public.orders
      WHERE canteen_id = v_caller_canteen
        AND status = 'READY'
        AND otp_code = v_clean_otp
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE;
    ELSE
      SELECT * INTO v_order
      FROM public.orders
      WHERE tenant_id = v_caller_tenant
        AND status = 'READY'
        AND otp_code = v_clean_otp
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE;
    END IF;

    IF v_order.id IS NULL THEN
      RETURN json_build_object(
        'success', false,
        'message', 'No ready order found matching OTP ' || v_clean_otp
      );
    END IF;
  ELSE
    RETURN json_build_object(
      'success', false,
      'message', 'Please provide a valid 6-digit OTP code'
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

  -- Status check
  IF v_order.status = 'COLLECTED' THEN
    RETURN json_build_object(
      'success', false,
      'message', 'Order #' || COALESCE(v_order.order_number::text, '') || ' has already been collected'
    );
  END IF;

  IF v_order.status != 'READY' THEN
    RETURN json_build_object(
      'success', false,
      'message', 'Order #' || COALESCE(v_order.order_number::text, '') || ' is not ready for pickup (current status: ' || v_order.status || ')'
    );
  END IF;

  -- Validate OTP code if not an explicit admin override
  IF NOT p_is_override THEN
    IF v_clean_otp !~ '^\d{6}$' THEN
      RETURN json_build_object('success', false, 'message', 'OTP must be exactly 6 numeric digits');
    END IF;

    IF v_order.otp_code IS NOT NULL AND v_order.otp_code != v_clean_otp THEN
      RETURN json_build_object(
        'success', false,
        'message', 'Invalid OTP code. Please check with customer.'
      );
    END IF;
  END IF;

  -- Success transition
  UPDATE public.orders
  SET status = 'COLLECTED', collected_at = NOW()
  WHERE id = v_order.id;

  RETURN json_build_object(
    'success', true,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'message', 'Order #' || COALESCE(v_order.order_number::text, '') || ' verified and collected successfully'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

GRANT EXECUTE ON FUNCTION public.verify_pickup_otp(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_pickup_otp(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
