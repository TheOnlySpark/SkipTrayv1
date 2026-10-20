-- ============================================================================
-- MIGRATION 0042: Fix HIGH-03 Cross-Canteen & Cross-Tenant Data Access Vulnerability
-- 
-- Enforces strict multi-tenant and multi-canteen Row-Level Security (RLS) across:
--   1. Financial Ledger (order_ledger)
--   2. Payment Records (payments)
--   3. Staff Profiles (profiles)
--   4. Canteen Configurations (lunch_slot_configs)
--   5. Security Definer RPCs (verify_pickup_otp, mark_order_no_show, toggle_sold_out)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ORDER_LEDGER: Financial Ledger Table Hardening
-- ----------------------------------------------------------------------------

-- Add tenant_id if not present for direct indexed tenant isolation
ALTER TABLE public.order_ledger ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;

-- Backfill tenant_id from canteens
UPDATE public.order_ledger ol
SET tenant_id = c.tenant_id
FROM public.canteens c
WHERE c.id = ol.canteen_id AND ol.tenant_id IS NULL;

-- Create indexes for RLS query performance
CREATE INDEX IF NOT EXISTS idx_order_ledger_tenant  ON public.order_ledger(tenant_id);
CREATE INDEX IF NOT EXISTS idx_order_ledger_canteen ON public.order_ledger(canteen_id);
CREATE INDEX IF NOT EXISTS idx_order_ledger_student ON public.order_ledger(student_id);

-- Ensure RLS is enabled
ALTER TABLE public.order_ledger ENABLE ROW LEVEL SECURITY;

-- Drop all existing overly-permissive or insecure policies
DROP POLICY IF EXISTS "Staff/Admin can view all order ledgers"                         ON public.order_ledger;
DROP POLICY IF EXISTS "Users can view own order ledgers"                              ON public.order_ledger;
DROP POLICY IF EXISTS "Staff and Admin can view order ledgers"                        ON public.order_ledger;
DROP POLICY IF EXISTS "SUPER_ADMIN full access on order_ledger"                       ON public.order_ledger;
DROP POLICY IF EXISTS "Uni Admins can view tenant order ledgers"                      ON public.order_ledger;
DROP POLICY IF EXISTS "Staff and Canteen Admin can view assigned canteen ledgers"     ON public.order_ledger;
DROP POLICY IF EXISTS "Canteen Admins can insert assigned canteen ledgers"            ON public.order_ledger;
DROP POLICY IF EXISTS "Students can insert own order ledger"                          ON public.order_ledger;

-- 1.1 SUPER_ADMIN: Global full access
CREATE POLICY "SUPER_ADMIN full access on order_ledger"
  ON public.order_ledger FOR ALL
  TO authenticated
  USING (public.get_user_role() = 'SUPER_ADMIN')
  WITH CHECK (public.get_user_role() = 'SUPER_ADMIN');

-- 1.2 UNI_ADMIN: Can view financial ledgers ONLY across canteens in their own tenant
CREATE POLICY "Uni Admins can view tenant order ledgers"
  ON public.order_ledger FOR SELECT
  TO authenticated
  USING (
    public.get_user_role() = 'UNI_ADMIN'
    AND tenant_id = public.get_my_tenant_id()
  );

-- 1.3 CANTEEN_ADMIN & STAFF: Can view financial ledgers ONLY for their verified assigned canteen
CREATE POLICY "Staff and Canteen Admin can view assigned canteen ledgers"
  ON public.order_ledger FOR SELECT
  TO authenticated
  USING (
    public.get_user_role() IN ('STAFF', 'CANTEEN_ADMIN')
    AND tenant_id = public.get_my_tenant_id()
    AND canteen_id = public.get_my_canteen_id()
  );

-- 1.4 CANTEEN_ADMIN INSERT: Can insert ledger records only for their verified assigned canteen
CREATE POLICY "Canteen Admins can insert assigned canteen ledgers"
  ON public.order_ledger FOR INSERT
  TO authenticated
  WITH CHECK (
    public.get_user_role() = 'CANTEEN_ADMIN'
    AND tenant_id = public.get_my_tenant_id()
    AND canteen_id = public.get_my_canteen_id()
  );

-- 1.5 STUDENT INSERT: Can insert a ledger record ONLY for their own placed order in their tenant
CREATE POLICY "Students can insert own order ledger"
  ON public.order_ledger FOR INSERT
  TO authenticated
  WITH CHECK (
    student_id = auth.uid()
    AND tenant_id = public.get_my_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_ledger.order_id
        AND o.user_id = auth.uid()
        AND o.canteen_id = order_ledger.canteen_id
        AND o.tenant_id = public.get_my_tenant_id()
    )
  );

-- NOTE on UPDATE/DELETE: No UPDATE or DELETE policies are granted to non-super-admins.
-- Financial ledgers are immutable accounting records.


-- ----------------------------------------------------------------------------
-- 2. PAYMENTS: Payment Records Table Hardening
-- ----------------------------------------------------------------------------

-- Add canteen_id to payments table for direct, efficient canteen scoping
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS canteen_id uuid REFERENCES public.canteens(id) ON DELETE SET NULL;

-- Backfill canteen_id from linked orders
UPDATE public.payments p
SET canteen_id = o.canteen_id
FROM public.orders o
WHERE o.payment_id = p.id AND p.canteen_id IS NULL;

-- For any remaining rows where an order was not linked, resolve default canteen for tenant
UPDATE public.payments p
SET canteen_id = (SELECT c.id FROM public.canteens c WHERE c.tenant_id = p.tenant_id ORDER BY c.created_at ASC LIMIT 1)
WHERE p.canteen_id IS NULL AND p.tenant_id IS NOT NULL;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_payments_canteen ON public.payments(canteen_id);
CREATE INDEX IF NOT EXISTS idx_payments_tenant  ON public.payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payments_user    ON public.payments(user_id);

-- Ensure RLS is enabled
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Drop existing insecure/overly-broad policies
DROP POLICY IF EXISTS "Staff, Canteen, and Uni Admins can view tenant payments"       ON public.payments;
DROP POLICY IF EXISTS "Staff/Admin can view all payments"                             ON public.payments;
DROP POLICY IF EXISTS "Admin can view tenant payments"                                ON public.payments;
DROP POLICY IF EXISTS "Users can view own payments"                                   ON public.payments;
DROP POLICY IF EXISTS "Users can insert own payments"                                 ON public.payments;
DROP POLICY IF EXISTS "Users can update own payments"                                 ON public.payments;
DROP POLICY IF EXISTS "SUPER_ADMIN full access on payments"                           ON public.payments;
DROP POLICY IF EXISTS "Uni Admins can view tenant payments"                           ON public.payments;
DROP POLICY IF EXISTS "Staff and Canteen Admin can view assigned canteen payments"   ON public.payments;

-- 2.1 SUPER_ADMIN: Global full access
CREATE POLICY "SUPER_ADMIN full access on payments"
  ON public.payments FOR ALL
  TO authenticated
  USING (public.get_user_role() = 'SUPER_ADMIN')
  WITH CHECK (public.get_user_role() = 'SUPER_ADMIN');

-- 2.2 STUDENTS: Can view ONLY their own payments within their tenant
CREATE POLICY "Users can view own payments"
  ON public.payments FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND tenant_id = public.get_my_tenant_id()
  );

-- 2.3 UNI_ADMIN: Can view all payments within their university tenant
CREATE POLICY "Uni Admins can view tenant payments"
  ON public.payments FOR SELECT
  TO authenticated
  USING (
    public.get_user_role() = 'UNI_ADMIN'
    AND tenant_id = public.get_my_tenant_id()
  );

-- 2.4 STAFF & CANTEEN_ADMIN: Can view payments ONLY for their assigned canteen
CREATE POLICY "Staff and Canteen Admin can view assigned canteen payments"
  ON public.payments FOR SELECT
  TO authenticated
  USING (
    public.get_user_role() IN ('STAFF', 'CANTEEN_ADMIN')
    AND tenant_id = public.get_my_tenant_id()
    AND (
      canteen_id = public.get_my_canteen_id()
      OR EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.payment_id = payments.id
          AND o.canteen_id = public.get_my_canteen_id()
          AND o.tenant_id = public.get_my_tenant_id()
      )
    )
  );

-- 2.5 STUDENTS INSERT: Can insert payments only for themselves in their verified tenant
CREATE POLICY "Users can insert own payments"
  ON public.payments FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND tenant_id = public.get_my_tenant_id()
    AND (
      canteen_id IS NULL
      OR canteen_id IN (SELECT id FROM public.canteens WHERE tenant_id = public.get_my_tenant_id())
    )
  );

-- 2.6 STUDENTS UPDATE: Can update payment details for their own payments; forbids changing user_id, tenant_id, or canteen_id
CREATE POLICY "Users can update own payments"
  ON public.payments FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND tenant_id = public.get_my_tenant_id()
  )
  WITH CHECK (
    user_id = auth.uid()
    AND tenant_id = public.get_my_tenant_id()
    AND (
      canteen_id IS NULL
      OR canteen_id = payments.canteen_id
    )
  );


-- ----------------------------------------------------------------------------
-- 3. PROFILES: Staff & Student Profile Isolation
-- ----------------------------------------------------------------------------

-- Drop overly-broad profile select policies
DROP POLICY IF EXISTS "Elevated roles can view relevant profiles"                      ON public.profiles;
DROP POLICY IF EXISTS "Staff/Admin can view all profiles"                             ON public.profiles;
DROP POLICY IF EXISTS "Super Admins can view all profiles"                            ON public.profiles;
DROP POLICY IF EXISTS "Uni Admins can view tenant profiles"                           ON public.profiles;
DROP POLICY IF EXISTS "Canteen Admins can view assigned staff and tenant students"    ON public.profiles;
DROP POLICY IF EXISTS "Staff can view assigned staff and tenant students"             ON public.profiles;
DROP POLICY IF EXISTS "Canteen Admins can update canteen profiles"                    ON public.profiles;
DROP POLICY IF EXISTS "Canteen Admins can update assigned staff profiles"             ON public.profiles;

-- 3.1 SUPER_ADMIN: Can view all profiles
CREATE POLICY "Super Admins can view all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (public.get_user_role() = 'SUPER_ADMIN');

-- 3.2 UNI_ADMIN: Can view profiles only within their tenant
CREATE POLICY "Uni Admins can view tenant profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    public.get_user_role() = 'UNI_ADMIN'
    AND tenant_id = public.get_my_tenant_id()
  );

-- 3.3 CANTEEN_ADMIN: Can view only:
--     - Their own profile
--     - Staff assigned to their own canteen
--     - Students/Teachers in their tenant (for orders and penalty management)
--     Explicitly CANNOT view staff or admins of other canteens!
CREATE POLICY "Canteen Admins can view assigned staff and tenant students"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    public.get_user_role() = 'CANTEEN_ADMIN'
    AND (
      id = auth.uid()
      OR (role = 'STAFF' AND canteen_id = public.get_my_canteen_id() AND tenant_id = public.get_my_tenant_id())
      OR (role IN ('STUDENT', 'TEACHER') AND tenant_id = public.get_my_tenant_id())
    )
  );

-- 3.4 STAFF: Can view only:
--     - Their own profile
--     - Staff assigned to their own canteen
--     - Students/Teachers in their tenant (for customer pickup identification)
--     Explicitly CANNOT view staff or admins of other canteens!
CREATE POLICY "Staff can view assigned staff and tenant students"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    public.get_user_role() = 'STAFF'
    AND (
      id = auth.uid()
      OR (role = 'STAFF' AND canteen_id = public.get_my_canteen_id() AND tenant_id = public.get_my_tenant_id())
      OR (role IN ('STUDENT', 'TEACHER') AND tenant_id = public.get_my_tenant_id())
    )
  );

-- 3.5 CANTEEN_ADMIN UPDATE: Can update only staff assigned to their canteen, without changing role or canteen_id
CREATE POLICY "Canteen Admins can update assigned staff profiles"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (
    public.get_user_role() = 'CANTEEN_ADMIN'
    AND role = 'STAFF'
    AND canteen_id = public.get_my_canteen_id()
    AND tenant_id = public.get_my_tenant_id()
  )
  WITH CHECK (
    public.get_user_role() = 'CANTEEN_ADMIN'
    AND role = 'STAFF'
    AND canteen_id = public.get_my_canteen_id()
    AND tenant_id = public.get_my_tenant_id()
  );


-- ----------------------------------------------------------------------------
-- 4. LUNCH_SLOT_CONFIGS: Canteen-Level Configuration Isolation
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Anyone can view lunch slot configs"                            ON public.lunch_slot_configs;
DROP POLICY IF EXISTS "Admins and staff can manage lunch slot configs"                ON public.lunch_slot_configs;
DROP POLICY IF EXISTS "Tenant users can view lunch slot configs"                      ON public.lunch_slot_configs;
DROP POLICY IF EXISTS "Super Admins can manage all lunch slot configs"                ON public.lunch_slot_configs;
DROP POLICY IF EXISTS "Uni Admins can manage tenant lunch slot configs"               ON public.lunch_slot_configs;
DROP POLICY IF EXISTS "Canteen Admins can manage assigned lunch slot configs"         ON public.lunch_slot_configs;

-- 4.1 SELECT: Authenticated users can view configs only for canteens within their tenant
CREATE POLICY "Tenant users can view lunch slot configs"
  ON public.lunch_slot_configs FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.get_my_tenant_id()
    OR public.get_user_role() = 'SUPER_ADMIN'
  );

-- 4.2 SUPER_ADMIN: Full management
CREATE POLICY "Super Admins can manage all lunch slot configs"
  ON public.lunch_slot_configs FOR ALL
  TO authenticated
  USING (public.get_user_role() = 'SUPER_ADMIN')
  WITH CHECK (public.get_user_role() = 'SUPER_ADMIN');

-- 4.3 UNI_ADMIN: Manage all canteens in tenant
CREATE POLICY "Uni Admins can manage tenant lunch slot configs"
  ON public.lunch_slot_configs FOR ALL
  TO authenticated
  USING (
    public.get_user_role() = 'UNI_ADMIN'
    AND tenant_id = public.get_my_tenant_id()
  )
  WITH CHECK (
    public.get_user_role() = 'UNI_ADMIN'
    AND tenant_id = public.get_my_tenant_id()
  );

-- 4.4 CANTEEN_ADMIN: Manage ONLY their assigned canteen's slot config
CREATE POLICY "Canteen Admins can manage assigned lunch slot configs"
  ON public.lunch_slot_configs FOR ALL
  TO authenticated
  USING (
    public.get_user_role() = 'CANTEEN_ADMIN'
    AND canteen_id = public.get_my_canteen_id()
    AND tenant_id = public.get_my_tenant_id()
  )
  WITH CHECK (
    public.get_user_role() = 'CANTEEN_ADMIN'
    AND canteen_id = public.get_my_canteen_id()
    AND tenant_id = public.get_my_tenant_id()
  );


-- ----------------------------------------------------------------------------
-- 5. RPC SECURITY DEFINER HARDENING: Cross-Canteen Enforcement
-- ----------------------------------------------------------------------------

-- 5.1 verify_pickup_otp: Lock down staff to their assigned canteen
CREATE OR REPLACE FUNCTION public.verify_pickup_otp(
  p_order_id   uuid,
  p_otp        text,
  p_is_override boolean DEFAULT false
) RETURNS json AS $$
DECLARE
  v_order          public.orders%rowtype;
  v_caller_role    public.user_role;
  v_caller_canteen uuid;
  v_pickup_ts      timestamptz;
  v_expiry_ts      timestamptz;
BEGIN
  -- Authenticated user validation
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_caller_role := public.get_user_role();
  IF v_caller_role NOT IN ('STAFF', 'CANTEEN_ADMIN', 'UNI_ADMIN', 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Fetch the order with row-level lock
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Multi-tenant check
  IF v_caller_role != 'SUPER_ADMIN' AND v_order.tenant_id IS DISTINCT FROM public.get_my_tenant_id() THEN
    RAISE EXCEPTION 'Unauthorized: Order belongs to another organization';
  END IF;

  -- Multi-canteen lockdown check for Staff and Canteen Admin
  IF v_caller_role IN ('STAFF', 'CANTEEN_ADMIN') THEN
    v_caller_canteen := public.get_my_canteen_id();
    IF v_caller_canteen IS NULL OR v_caller_canteen IS DISTINCT FROM v_order.canteen_id THEN
      RAISE EXCEPTION 'Access denied: You are only authorized to verify orders for your assigned cafeteria.';
    END IF;
  END IF;

  -- Status gate: order must be READY
  IF v_order.status != 'READY' THEN
    RAISE EXCEPTION 'Order is not ready for pickup';
  END IF;

  -- QR Expiry check
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

  -- OTP verification
  IF v_order.otp_code != p_otp THEN
    RETURN json_build_object('success', false, 'message', 'Invalid OTP code.');
  END IF;

  -- Mark collected
  UPDATE public.orders
  SET status = 'COLLECTED', collected_at = NOW()
  WHERE id = p_order_id;

  RETURN json_build_object('success', true, 'message', 'Order marked as collected successfully.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;


-- 5.2 mark_order_no_show: Lock down staff to their assigned canteen
CREATE OR REPLACE FUNCTION public.mark_order_no_show(p_order_id uuid)
RETURNS json AS $$
DECLARE
  v_order           public.orders%rowtype;
  v_caller_role     public.user_role;
  v_caller_canteen  uuid;
  v_user_id         uuid;
  v_current_strikes int;
  v_new_strikes     int;
  v_is_suspended    boolean := false;
  v_suspended_until timestamptz := null;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_caller_role := public.get_user_role();
  IF v_caller_role NOT IN ('STAFF', 'CANTEEN_ADMIN', 'UNI_ADMIN', 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Tenant check
  IF v_caller_role != 'SUPER_ADMIN' AND v_order.tenant_id IS DISTINCT FROM public.get_my_tenant_id() THEN
    RAISE EXCEPTION 'Unauthorized: Order belongs to another organization';
  END IF;

  -- Canteen check for Staff and Canteen Admin
  IF v_caller_role IN ('STAFF', 'CANTEEN_ADMIN') THEN
    v_caller_canteen := public.get_my_canteen_id();
    IF v_caller_canteen IS NULL OR v_caller_canteen IS DISTINCT FROM v_order.canteen_id THEN
      RAISE EXCEPTION 'Access denied: You are only authorized to mark no-shows for your assigned cafeteria.';
    END IF;
  END IF;

  IF v_order.status != 'READY' THEN
    RAISE EXCEPTION 'Only orders in READY status can be marked as No-Show';
  END IF;

  v_user_id := v_order.user_id;
  UPDATE public.orders SET status = 'REJECTED' WHERE id = p_order_id;

  SELECT strike_count, suspended_until INTO v_current_strikes, v_suspended_until
  FROM public.profiles WHERE id = v_user_id FOR UPDATE;

  v_new_strikes := COALESCE(v_current_strikes, 0) + 1;

  IF v_new_strikes >= 2 THEN
    v_is_suspended    := true;
    v_suspended_until := NOW() + interval '3 days';
    UPDATE public.profiles SET strike_count = 0, suspended_until = v_suspended_until WHERE id = v_user_id;
  ELSE
    UPDATE public.profiles SET strike_count = v_new_strikes WHERE id = v_user_id;
  END IF;

  RETURN json_build_object(
    'success',        true,
    'order_id',       p_order_id,
    'user_id',        v_user_id,
    'strike_count',   CASE WHEN v_is_suspended THEN 0 ELSE v_new_strikes END,
    'is_suspended',   v_is_suspended,
    'suspended_until', v_suspended_until
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- 5.3 toggle_sold_out: Lock down staff to their assigned canteen
CREATE OR REPLACE FUNCTION public.toggle_sold_out(item_id uuid, new_status boolean)
RETURNS void AS $$
DECLARE
  v_caller_role public.user_role;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_caller_role := public.get_user_role();

  IF v_caller_role IN ('STAFF', 'CANTEEN_ADMIN') THEN
    UPDATE public.menu_items
    SET is_sold_out = new_status, updated_at = now()
    WHERE id = item_id 
      AND tenant_id = public.get_my_tenant_id()
      AND canteen_id = public.get_my_canteen_id();

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Access denied: You can only update menu items for your assigned cafeteria.';
    END IF;
  ELSIF v_caller_role IN ('UNI_ADMIN', 'SUPER_ADMIN') THEN
    UPDATE public.menu_items
    SET is_sold_out = new_status, updated_at = now()
    WHERE id = item_id 
      AND (v_caller_role = 'SUPER_ADMIN' OR tenant_id = public.get_my_tenant_id());

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Menu item not found in your organization';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unauthorized';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

NOTIFY pgrst, 'reload schema';
