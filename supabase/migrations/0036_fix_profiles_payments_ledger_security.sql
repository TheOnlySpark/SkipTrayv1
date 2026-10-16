-- ============================================================================
-- MIGRATION 0036: Database Security Remediation
-- 
-- 1. Profile Protection Trigger (Issue 1)
--    - BEFORE UPDATE trigger on public.profiles (prevent_unauthorized_profile_updates)
--    - Block non-SUPER_ADMIN callers from changing role, tenant_id, strike_count, suspended_until
--    - Ensure users can only update permitted personal fields (name, id_number, avatar_url)
--    - Harmonize profile update RLS policy
--
-- 2. Strict Server-Only Payment Writes (Issue 1)
--    - Drop permissive INSERT and UPDATE policies on public.payments for authenticated role
--    - Ensure clients can only SELECT their own payments (user_id = auth.uid())
--    - All INSERT and UPDATE operations strictly require service_role
--
-- 3. Multi-Tenant & Canteen Scoping on Order Ledger (Issue 2)
--    - Add tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE to public.order_ledger
--    - Backfill tenant_id from associated orders.tenant_id, enforce NOT NULL
--    - Add canteen_id uuid REFERENCES public.canteens(id) ON DELETE CASCADE backfilled from orders.canteen_id
--    - Automatic trigger to populate tenant_id and canteen_id on order_ledger insert
--    - Tiered RLS on order_ledger:
--      * SUPER_ADMIN: full access across all tenants
--      * UNI_ADMIN: access all ledgers matching tenant_id = public.get_my_tenant_id()
--      * CANTEEN_ADMIN & STAFF: access ledgers matching their tenant AND canteen_id = (SELECT canteen_id FROM public.profiles WHERE id = auth.uid())
--      * STUDENT & TEACHER: zero access
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PROFILE PROTECTION (R1)
-- ----------------------------------------------------------------------------

-- Ensure avatar_url column exists on public.profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;

-- Create BEFORE UPDATE trigger function on public.profiles
CREATE OR REPLACE FUNCTION public.prevent_unauthorized_profile_updates()
RETURNS trigger AS $$
DECLARE
  v_caller_role public.user_role;
BEGIN
  -- 1. Allow bypass for internal trusted system calls / RPCs
  IF current_setting('app.bypass_profile_trigger', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- 2. Allow database background operations and service_role (where auth.uid() is null)
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- 3. Retrieve caller role
  v_caller_role := public.get_user_role();

  -- 4. SUPER_ADMIN is unrestricted across all tenants
  IF v_caller_role = 'SUPER_ADMIN' THEN
    RETURN NEW;
  END IF;

  -- 5. Primary key and immutable system timestamp protection
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Unauthorized: Profile id cannot be modified';
  END IF;

  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Unauthorized: created_at timestamp cannot be modified';
  END IF;

  -- 6. Block non-SUPER_ADMIN callers from changing sensitive administrative columns
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Unauthorized: Only SUPER_ADMIN can modify user role';
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'Unauthorized: Only SUPER_ADMIN can modify tenant_id';
  END IF;

  IF NEW.strike_count IS DISTINCT FROM OLD.strike_count THEN
    RAISE EXCEPTION 'Unauthorized: Only SUPER_ADMIN can modify strike_count';
  END IF;

  IF NEW.suspended_until IS DISTINCT FROM OLD.suspended_until THEN
    RAISE EXCEPTION 'Unauthorized: Only SUPER_ADMIN can modify suspended_until';
  END IF;

  -- 7. Block non-UNI_ADMIN / non-SUPER_ADMIN callers from changing canteen_id
  IF NEW.canteen_id IS DISTINCT FROM OLD.canteen_id THEN
    IF v_caller_role IS DISTINCT FROM 'UNI_ADMIN' THEN
      RAISE EXCEPTION 'Unauthorized: Only UNI_ADMIN or SUPER_ADMIN can modify canteen_id';
    END IF;
  END IF;

  -- 8. Regular users (STUDENT, TEACHER) may only update their own permitted personal fields (name, id_number, avatar_url)
  IF v_caller_role IN ('STUDENT', 'TEACHER') THEN
    IF auth.uid() != OLD.id THEN
      RAISE EXCEPTION 'Unauthorized: Users can only update their own profile';
    END IF;

    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.strike_count IS DISTINCT FROM OLD.strike_count
       OR NEW.suspended_until IS DISTINCT FROM OLD.suspended_until
       OR NEW.canteen_id IS DISTINCT FROM OLD.canteen_id
       OR NEW.id IS DISTINCT FROM OLD.id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Unauthorized: Users can only update permitted personal fields (name, id_number, avatar_url)';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Attach trigger to public.profiles
DROP TRIGGER IF EXISTS prevent_unauthorized_profile_updates ON public.profiles;

CREATE TRIGGER prevent_unauthorized_profile_updates
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_unauthorized_profile_updates();

-- Clean up and consolidate profile UPDATE RLS policies
DROP POLICY IF EXISTS "Users can update own profile safely" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Secure disciplinary procedures to respect tenant scoping and set internal bypass for trigger
CREATE OR REPLACE FUNCTION public.record_no_show(p_student_id uuid)
RETURNS void AS $$
DECLARE
  v_current_strikes int;
BEGIN
  IF public.get_user_role() NOT IN ('STAFF', 'CANTEEN_ADMIN', 'UNI_ADMIN', 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF public.get_user_role() != 'SUPER_ADMIN' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = p_student_id AND tenant_id = public.get_my_tenant_id()
    ) THEN
      RAISE EXCEPTION 'Unauthorized: Student does not belong to your tenant';
    END IF;
  END IF;

  PERFORM set_config('app.bypass_profile_trigger', 'true', true);

  SELECT strike_count INTO v_current_strikes
  FROM public.profiles
  WHERE id = p_student_id;

  v_current_strikes := COALESCE(v_current_strikes, 0) + 1;

  IF v_current_strikes >= 3 THEN
    UPDATE public.profiles
    SET strike_count = v_current_strikes, suspended_until = NOW() + interval '7 days'
    WHERE id = p_student_id;
  ELSE
    UPDATE public.profiles
    SET strike_count = v_current_strikes
    WHERE id = p_student_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.clear_no_show_strikes(p_student_id uuid)
RETURNS json AS $$
BEGIN
  IF public.get_user_role() NOT IN ('CANTEEN_ADMIN', 'UNI_ADMIN', 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized - Requires Canteen Admin or Uni Admin role';
  END IF;

  IF public.get_user_role() != 'SUPER_ADMIN' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = p_student_id AND tenant_id = public.get_my_tenant_id()
    ) THEN
      RAISE EXCEPTION 'Unauthorized: Student does not belong to your tenant';
    END IF;
  END IF;

  PERFORM set_config('app.bypass_profile_trigger', 'true', true);

  UPDATE public.profiles
  SET strike_count = 0, suspended_until = NULL
  WHERE id = p_student_id;

  RETURN json_build_object('success', true, 'message', 'Strikes and suspension cleared successfully');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ----------------------------------------------------------------------------
-- 2. STRICT SERVER-ONLY PAYMENT WRITES (R2)
-- ----------------------------------------------------------------------------

-- Ensure RLS is active on public.payments
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Drop permissive INSERT and UPDATE policies for authenticated callers
DROP POLICY IF EXISTS "Users can insert own payments" ON public.payments;
DROP POLICY IF EXISTS "Users can update own payments" ON public.payments;
DROP POLICY IF EXISTS "SUPER_ADMIN full access on payments" ON public.payments;

-- Drop and recreate SELECT policies: clients can only SELECT their own payments
DROP POLICY IF EXISTS "Users can view own payments" ON public.payments;
CREATE POLICY "Users can view own payments"
  ON public.payments FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Elevated roles can view tenant payments
DROP POLICY IF EXISTS "Staff, Canteen, and Uni Admins can view tenant payments" ON public.payments;
CREATE POLICY "Staff, Canteen, and Uni Admins can view tenant payments"
  ON public.payments FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.get_my_tenant_id()
    AND public.get_user_role() IN ('STAFF', 'CANTEEN_ADMIN', 'UNI_ADMIN')
  );

-- SUPER_ADMIN can view all payments across all tenants
DROP POLICY IF EXISTS "SUPER_ADMIN view all payments" ON public.payments;
CREATE POLICY "SUPER_ADMIN view all payments"
  ON public.payments FOR SELECT
  TO authenticated
  USING (public.get_user_role() = 'SUPER_ADMIN');

-- Service role has exclusive management rights (INSERT, UPDATE, DELETE)
DROP POLICY IF EXISTS "Service role manages payments" ON public.payments;
CREATE POLICY "Service role manages payments"
  ON public.payments FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- ----------------------------------------------------------------------------
-- 3. MULTI-TENANT & CANTEEN SCOPING ON ORDER LEDGER (R3)
-- ----------------------------------------------------------------------------

-- 1. Add tenant_id column if not exists
ALTER TABLE public.order_ledger
  ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- 2. Backfill tenant_id from associated orders.tenant_id
UPDATE public.order_ledger ol
SET tenant_id = o.tenant_id
FROM public.orders o
WHERE ol.order_id = o.id
  AND ol.tenant_id IS NULL;

-- Backfill any remaining ledgers from student profiles if order relation missing
UPDATE public.order_ledger ol
SET tenant_id = p.tenant_id
FROM public.profiles p
WHERE ol.student_id = p.id
  AND ol.tenant_id IS NULL;

-- Add foreign key constraint for tenant_id with ON DELETE CASCADE
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'order_ledger_tenant_id_fkey'
      AND table_name = 'order_ledger'
  ) THEN
    ALTER TABLE public.order_ledger
      ADD CONSTRAINT order_ledger_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Enforce NOT NULL on tenant_id
ALTER TABLE public.order_ledger
  ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_order_ledger_tenant ON public.order_ledger(tenant_id);

-- 3. Add / ensure canteen_id column on order_ledger
ALTER TABLE public.order_ledger
  ADD COLUMN IF NOT EXISTS canteen_id uuid;

-- Backfill canteen_id from orders.canteen_id
UPDATE public.order_ledger ol
SET canteen_id = o.canteen_id
FROM public.orders o
WHERE ol.order_id = o.id
  AND (ol.canteen_id IS NULL OR ol.canteen_id != o.canteen_id);

-- Enforce ON DELETE CASCADE foreign key on canteen_id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'order_ledger_canteen_id_fkey'
      AND table_name = 'order_ledger'
  ) THEN
    ALTER TABLE public.order_ledger DROP CONSTRAINT order_ledger_canteen_id_fkey;
  END IF;
END $$;

ALTER TABLE public.order_ledger
  ADD CONSTRAINT order_ledger_canteen_id_fkey
  FOREIGN KEY (canteen_id) REFERENCES public.canteens(id) ON DELETE CASCADE;

ALTER TABLE public.order_ledger
  ALTER COLUMN canteen_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_order_ledger_canteen ON public.order_ledger(canteen_id);

-- 4. Automatic BEFORE INSERT trigger to auto-populate tenant_id & canteen_id from orders if omitted
CREATE OR REPLACE FUNCTION public.set_order_ledger_tenant_and_canteen()
RETURNS trigger AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    SELECT tenant_id INTO NEW.tenant_id FROM public.orders WHERE id = NEW.order_id;
  END IF;
  IF NEW.canteen_id IS NULL THEN
    SELECT canteen_id INTO NEW.canteen_id FROM public.orders WHERE id = NEW.order_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_order_ledger_set_tenant ON public.order_ledger;
CREATE TRIGGER trg_order_ledger_set_tenant
  BEFORE INSERT ON public.order_ledger
  FOR EACH ROW
  EXECUTE FUNCTION public.set_order_ledger_tenant_and_canteen();

-- 5. Tiered RLS on order_ledger
ALTER TABLE public.order_ledger ENABLE ROW LEVEL SECURITY;

-- Drop all old policies
DROP POLICY IF EXISTS "Staff/Admin can view all order ledgers" ON public.order_ledger;
DROP POLICY IF EXISTS "Users can view own order ledgers" ON public.order_ledger;
DROP POLICY IF EXISTS "SUPER_ADMIN full access on order_ledger" ON public.order_ledger;
DROP POLICY IF EXISTS "UNI_ADMIN view tenant order_ledger" ON public.order_ledger;
DROP POLICY IF EXISTS "Canteen Admin and Staff view canteen order_ledger" ON public.order_ledger;
DROP POLICY IF EXISTS "Service role full access on order_ledger" ON public.order_ledger;

-- SUPER_ADMIN: full access across all tenants
CREATE POLICY "SUPER_ADMIN full access on order_ledger"
  ON public.order_ledger FOR ALL
  TO authenticated
  USING (public.get_user_role() = 'SUPER_ADMIN')
  WITH CHECK (public.get_user_role() = 'SUPER_ADMIN');

-- UNI_ADMIN: access all ledgers matching tenant_id = public.get_my_tenant_id()
CREATE POLICY "UNI_ADMIN view tenant order_ledger"
  ON public.order_ledger FOR SELECT
  TO authenticated
  USING (
    public.get_user_role() = 'UNI_ADMIN'
    AND tenant_id = public.get_my_tenant_id()
  );

-- CANTEEN_ADMIN & STAFF: access ledgers matching their tenant AND canteen_id = (SELECT canteen_id FROM public.profiles WHERE id = auth.uid())
CREATE POLICY "Canteen Admin and Staff view canteen order_ledger"
  ON public.order_ledger FOR SELECT
  TO authenticated
  USING (
    public.get_user_role() IN ('CANTEEN_ADMIN', 'STAFF')
    AND tenant_id = public.get_my_tenant_id()
    AND canteen_id = (SELECT canteen_id FROM public.profiles WHERE id = auth.uid())
  );

-- STUDENT & TEACHER: zero access (no policies granted -> PostgREST returns empty array [])

-- Service role: full access for background processes & Edge Functions
CREATE POLICY "Service role full access on order_ledger"
  ON public.order_ledger FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
