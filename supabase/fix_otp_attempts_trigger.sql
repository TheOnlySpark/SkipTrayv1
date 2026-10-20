-- ==============================================================================
-- FIX FOR: "record 'new' has no field 'otp_attempts'"
-- Run this in your Supabase SQL Editor.
-- ==============================================================================

-- 1. Ensure pgcrypto extension is installed
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;

-- 2. Drop any legacy OTP columns from orders if they still exist
ALTER TABLE public.orders DROP COLUMN IF EXISTS otp_code CASCADE;
ALTER TABLE public.orders DROP COLUMN IF EXISTS otp_hash CASCADE;
ALTER TABLE public.orders DROP COLUMN IF EXISTS otp_attempts CASCADE;

-- 3. Replace enforce_order_security_and_state_machine trigger function 
-- to remove any reference to the dropped otp_attempts column
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

-- 4. Re-bind the trigger to orders table
DROP TRIGGER IF EXISTS trg_enforce_order_security ON public.orders;
CREATE TRIGGER trg_enforce_order_security
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_order_security_and_state_machine();

-- 5. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
