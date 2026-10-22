-- ============================================================================
-- MIGRATION 0052: Fix Daily Order Numbers & Eliminate User Repetition
-- ============================================================================
-- 1. Ensure public.daily_sequences table exists with proper primary key & defaults
-- 2. Grant explicit RLS policies on daily_sequences so SECURITY DEFINER operations never fail
-- 3. Upgrade get_next_daily_order_number() to reset at midnight Asia/Kolkata (IST)
-- 4. Set column default on public.orders (order_number)
-- 5. Attach an authoritative BEFORE INSERT trigger (trg_set_order_number) on public.orders
--    to guarantee every order unconditionally receives a fresh sequential number for the day
-- ============================================================================

-- 1. Ensure daily_sequences table exists
CREATE TABLE IF NOT EXISTS public.daily_sequences (
    seq_date DATE PRIMARY KEY,
    last_value INTEGER NOT NULL DEFAULT 0
);

-- Enable Row Level Security
ALTER TABLE public.daily_sequences ENABLE ROW LEVEL SECURITY;

-- Explicit policy for system / SECURITY DEFINER routines
DROP POLICY IF EXISTS "Allow system access on daily_sequences" ON public.daily_sequences;
CREATE POLICY "Allow system access on daily_sequences"
ON public.daily_sequences
FOR ALL
TO authenticated, anon, service_role
USING (true)
WITH CHECK (true);

-- 2. Upgrade get_next_daily_order_number function with strict search_path and atomic upsert
CREATE OR REPLACE FUNCTION public.get_next_daily_order_number()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    next_val INTEGER;
    v_today DATE;
BEGIN
    -- Canteen operates in IST (UTC+5:30), sequence resets at IST midnight
    v_today := (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE;

    INSERT INTO public.daily_sequences (seq_date, last_value)
    VALUES (v_today, 1)
    ON CONFLICT (seq_date) 
    DO UPDATE SET last_value = public.daily_sequences.last_value + 1
    RETURNING last_value INTO next_val;
    
    RETURN next_val;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_next_daily_order_number() TO authenticated, anon, service_role;

-- 3. Restore column default on public.orders
ALTER TABLE public.orders 
ALTER COLUMN order_number SET DEFAULT public.get_next_daily_order_number();

-- 4. Trigger function to authoritatively assign next daily order number on insert
CREATE OR REPLACE FUNCTION public.trg_assign_order_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    -- Always assign the fresh next daily sequence number for every newly created order
    NEW.order_number := public.get_next_daily_order_number();
    RETURN NEW;
END;
$$;

-- 5. Attach BEFORE INSERT trigger on public.orders
DROP TRIGGER IF EXISTS trg_set_order_number ON public.orders;
CREATE TRIGGER trg_set_order_number
BEFORE INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.trg_assign_order_number();

-- 6. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
