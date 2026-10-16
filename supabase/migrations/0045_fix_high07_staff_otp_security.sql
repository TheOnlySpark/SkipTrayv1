-- ============================================================================
-- MIGRATION 0045: Fix HIGH-07 — Prevent Staff from Reading Pickup OTP Secrets
-- ============================================================================
-- Objective:
-- 1. Restrict direct SELECT on public.orders so that staff and admins cannot
--    read otp_code or otp_attempts via SELECT * or direct API requests.
-- 2. Provide a safe, dedicated database view public.staff_orders that exposes
--    only authorized operational order fields to staff, strictly omitting
--    otp_code and otp_attempts, and enforcing multi-tenant & multi-canteen scope.
-- 3. Upgrade public.verify_pickup_otp() RPC to enforce server-side row-level
--    locking, 3-attempt brute-force gating, QR expiry checks, canteen boundaries,
--    and atomic status transitions, without leaking OTP secrets to callers.
-- ============================================================================

-- 1. Create the safe view for staff and canteen administrators
CREATE OR REPLACE VIEW public.staff_orders AS
SELECT
  o.id,
  o.user_id,
  o.tenant_id,
  o.canteen_id,
  o.order_number,
  o.status,
  o.created_at,
  o.pickup_time,
  o.is_takeaway,
  o.total_tax_amount,
  o.collected_at,
  o.requested_pickup_time,
  o.planned_prep_start_time,
  o.target_ready_by_time,
  o.estimated_prep_duration_minutes,
  o.idempotency_key,
  o.payment_id
FROM public.orders o
WHERE
  -- Staff & Canteen Admin: strictly locked to assigned canteen & tenant
  (
    public.get_user_role() IN ('STAFF', 'CANTEEN_ADMIN')
    AND o.canteen_id = public.get_my_canteen_id()
    AND o.tenant_id = public.get_my_tenant_id()
  )
  OR
  -- University Admin: locked to their university tenant
  (
    public.get_user_role() = 'UNI_ADMIN'
    AND o.tenant_id = public.get_my_tenant_id()
  )
  OR
  -- Super Admin: platform-wide access
  (
    public.get_user_role() = 'SUPER_ADMIN'
  );

GRANT SELECT ON public.staff_orders TO authenticated;

COMMENT ON VIEW public.staff_orders IS E'@foreignKey (user_id) references profiles(id)\n@foreignKey (canteen_id) references canteens(id)\n@foreignKey (id) references order_items(order_id)';

-- 2. Restrict direct SELECT on public.orders to prevent staff from querying otp_code
DROP POLICY IF EXISTS "Staff and Canteen Admin can view assigned canteen orders and Uni Admin can view tenant orders" ON public.orders;
DROP POLICY IF EXISTS "Staff can view assigned canteen orders and Admin can view tenant orders" ON public.orders;
DROP POLICY IF EXISTS "Staff/Admin can view all orders" ON public.orders;
DROP POLICY IF EXISTS "Staff and Admin can view tenant orders" ON public.orders;

-- Ensure students retain access to their own orders (and their own OTP for pickup display)
DROP POLICY IF EXISTS "Users can view own orders" ON public.orders;
CREATE POLICY "Users can view own orders"
  ON public.orders FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND (tenant_id = public.get_my_tenant_id() OR public.get_user_role() = 'SUPER_ADMIN')
  );

-- 3. Upgrade public.verify_pickup_otp() RPC
CREATE OR REPLACE FUNCTION public.verify_pickup_otp(
  p_order_id    uuid DEFAULT NULL,
  p_otp         text DEFAULT NULL,
  p_is_override boolean DEFAULT false
) RETURNS json AS $$
DECLARE
  v_order          public.orders%rowtype;
  v_caller_role    public.user_role;
  v_caller_canteen uuid;
  v_caller_tenant  uuid;
  v_pickup_ts      timestamptz;
  v_expiry_ts      timestamptz;
  v_clean_otp      text := trim(p_otp);
BEGIN
  -- 1. Authentication check
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_caller_role := public.get_user_role();
  IF v_caller_role NOT IN ('STAFF', 'CANTEEN_ADMIN', 'UNI_ADMIN', 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized: Only staff and administrators may verify pickup OTP';
  END IF;

  v_caller_tenant := public.get_my_tenant_id();
  IF v_caller_role IN ('STAFF', 'CANTEEN_ADMIN') THEN
    v_caller_canteen := public.get_my_canteen_id();
    IF v_caller_canteen IS NULL THEN
      RAISE EXCEPTION 'Access denied: No canteen assigned to your account';
    END IF;
  END IF;

  -- 2. Resolve target order with row-level lock (prevents concurrent race conditions)
  IF p_order_id IS NOT NULL THEN
    SELECT * INTO v_order
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF v_order.id IS NULL THEN
      RAISE EXCEPTION 'Order not found';
    END IF;
  ELSIF v_clean_otp IS NOT NULL AND v_clean_otp ~ '^\d{6}$' THEN
    -- Quick OTP lookup: find READY order in caller's canteen matching OTP
    IF v_caller_role IN ('STAFF', 'CANTEEN_ADMIN') THEN
      SELECT * INTO v_order
      FROM public.orders
      WHERE canteen_id = v_caller_canteen
        AND status = 'READY'
        AND otp_code = v_clean_otp
      FOR UPDATE;
    ELSE
      SELECT * INTO v_order
      FROM public.orders
      WHERE tenant_id = v_caller_tenant
        AND status = 'READY'
        AND otp_code = v_clean_otp
      FOR UPDATE;
    END IF;

    IF v_order.id IS NULL THEN
      RETURN json_build_object(
        'success', false,
        'message', 'No ready order found matching the provided OTP code.'
      );
    END IF;
  ELSE
    RETURN json_build_object(
      'success', false,
      'message', 'Please provide a valid order ID or 6-digit OTP code.'
    );
  END IF;

  -- 3. Multi-tenant and canteen boundary checks
  IF v_caller_role != 'SUPER_ADMIN' AND v_order.tenant_id IS DISTINCT FROM v_caller_tenant THEN
    RAISE EXCEPTION 'Unauthorized: Order belongs to another organization';
  END IF;

  IF v_caller_role IN ('STAFF', 'CANTEEN_ADMIN') THEN
    IF v_caller_canteen IS DISTINCT FROM v_order.canteen_id THEN
      RAISE EXCEPTION 'Access denied: You are only authorized to verify orders for your assigned cafeteria.';
    END IF;
  END IF;

  -- 4. Status validations
  IF v_order.status = 'COLLECTED' THEN
    RETURN json_build_object(
      'success', false,
      'message', format('Order #%s has already been collected.', v_order.order_number)
    );
  END IF;

  IF v_order.status != 'READY' THEN
    RETURN json_build_object(
      'success', false,
      'message', format('Order #%s is not ready for pickup (current status: %s).', v_order.order_number, v_order.status)
    );
  END IF;

  -- 5. Manual override path
  IF p_is_override THEN
    UPDATE public.orders
    SET status = 'COLLECTED', collected_at = NOW()
    WHERE id = v_order.id;

    RETURN json_build_object(
      'success', true,
      'message', 'Order manually overridden and marked as collected successfully.',
      'order_id', v_order.id,
      'order_number', v_order.order_number
    );
  END IF;

  -- 6. Attempt limit gate (3 attempts)
  IF v_order.otp_attempts >= 3 THEN
    RETURN json_build_object(
      'success', false,
      'message', format('Order #%s has exceeded maximum OTP attempts. Manual override required.', v_order.order_number),
      'requires_override', true,
      'order_id', v_order.id,
      'order_number', v_order.order_number
    );
  END IF;

  -- 7. QR Expiry check (pickup slot + 30 min grace)
  v_pickup_ts := (
    (v_order.created_at AT TIME ZONE 'Asia/Kolkata')::date
    + v_order.pickup_time::time
  ) AT TIME ZONE 'Asia/Kolkata';
  v_expiry_ts := v_pickup_ts + INTERVAL '30 minutes';

  IF NOW() > v_expiry_ts THEN
    RETURN json_build_object(
      'success', false,
      'message', format(
        'QR code expired. Pickup slot was %s — grace period ended at %s (IST). Use Manual Override if the student is present.',
        to_char(v_pickup_ts AT TIME ZONE 'Asia/Kolkata', 'HH:MI AM'),
        to_char(v_expiry_ts AT TIME ZONE 'Asia/Kolkata', 'HH:MI AM')
      ),
      'requires_override', true,
      'order_id', v_order.id,
      'order_number', v_order.order_number
    );
  END IF;

  -- 8. OTP format check
  IF v_clean_otp IS NULL OR NOT (v_clean_otp ~ '^\d{6}$') THEN
    RETURN json_build_object(
      'success', false,
      'message', 'OTP must be exactly 6 numeric digits.'
    );
  END IF;

  -- 9. Secure comparison and attempt counting
  IF v_order.otp_code != v_clean_otp THEN
    UPDATE public.orders
    SET otp_attempts = otp_attempts + 1
    WHERE id = v_order.id;

    IF v_order.otp_attempts + 1 >= 3 THEN
      RETURN json_build_object(
        'success', false,
        'message', format('Invalid OTP code. 3 failed attempts reached. Order #%s locked. Manual override required.', v_order.order_number),
        'requires_override', true,
        'order_id', v_order.id,
        'order_number', v_order.order_number
      );
    ELSE
      RETURN json_build_object(
        'success', false,
        'message', format('Invalid OTP code for Order #%s (%s of 3 attempts remaining).', v_order.order_number, 3 - (v_order.otp_attempts + 1)),
        'requires_override', false,
        'order_id', v_order.id,
        'order_number', v_order.order_number
      );
    END IF;
  END IF;

  -- 10. Atomic verification and status transition
  UPDATE public.orders
  SET status = 'COLLECTED', collected_at = NOW()
  WHERE id = v_order.id;

  RETURN json_build_object(
    'success', true,
    'message', format('Order #%s verified and collected successfully.', v_order.order_number),
    'order_id', v_order.id,
    'order_number', v_order.order_number
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

REVOKE ALL ON FUNCTION public.verify_pickup_otp(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_pickup_otp(uuid, text, boolean) TO authenticated;
