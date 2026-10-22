-- ============================================================================
-- MIGRATION 0053: Drop Duplicate Order Number Default
-- ============================================================================
-- Resolves the issue where order numbers advanced by +2 (even numbers only)
-- because both column DEFAULT and BEFORE INSERT trigger were executing.
--
-- 1. Drops the column default on public.orders (order_number) so get_next_daily_order_number()
--    is evaluated ONLY ONCE per row insert by the authoritative BEFORE INSERT trigger.
-- 2. Ensures trg_set_order_number trigger is active and authoritative.
-- 3. Resyncs today's daily_sequences counter with the current MAX(order_number) of today
--    so the very next order increments by exactly +1.
-- ============================================================================

-- 1. Remove duplicate column default
ALTER TABLE public.orders 
ALTER COLUMN order_number DROP DEFAULT;

-- 2. Ensure the trigger function always assigns the fresh next daily sequence number
CREATE OR REPLACE FUNCTION public.trg_assign_order_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    NEW.order_number := public.get_next_daily_order_number();
    RETURN NEW;
END;
$$;

-- 3. Ensure trigger is attached and active
DROP TRIGGER IF EXISTS trg_set_order_number ON public.orders;
CREATE TRIGGER trg_set_order_number
BEFORE INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.trg_assign_order_number();

-- 4. Sync today's sequence counter with current max order_number for today (or 0 if clean)
DO $$
DECLARE
    v_today DATE := (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE;
    v_current_max INTEGER := 0;
BEGIN
    SELECT COALESCE(MAX(order_number), 0) INTO v_current_max
    FROM public.orders
    WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::DATE = v_today;

    INSERT INTO public.daily_sequences (seq_date, last_value)
    VALUES (v_today, v_current_max)
    ON CONFLICT (seq_date)
    DO UPDATE SET last_value = v_current_max;
END $$;

-- 5. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
