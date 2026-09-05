-- 0017_daily_order_numbers_start_from_1.sql
-- Restores daily resetting sequence for order numbers starting from 1
-- This reverses the global sequence introduced in 0010 and restores daily resets from 0005.

-- 1. Ensure the table exists (it was created in 0005, but just in case)
CREATE TABLE IF NOT EXISTS public.daily_sequences (
    seq_date DATE PRIMARY KEY,
    last_value INTEGER NOT NULL DEFAULT 1
);

ALTER TABLE public.daily_sequences ENABLE ROW LEVEL SECURITY;

-- 2. Create function that resets daily at midnight IST and starts from 1
CREATE OR REPLACE FUNCTION public.get_next_daily_order_number()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    next_val INTEGER;
    v_today DATE;
BEGIN
    -- Canteen operates in IST, so date change should happen at IST midnight
    v_today := (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE;

    INSERT INTO public.daily_sequences (seq_date, last_value)
    VALUES (v_today, 1)
    ON CONFLICT (seq_date) 
    DO UPDATE SET last_value = daily_sequences.last_value + 1
    RETURNING last_value INTO next_val;
    
    RETURN next_val;
END;
$$;

-- 3. Restore the default for order_number in orders to use our function
ALTER TABLE public.orders 
ALTER COLUMN order_number SET DEFAULT public.get_next_daily_order_number();

-- 4. (Optional) Cleanup the global sequence
DROP SEQUENCE IF EXISTS public.order_number_seq CASCADE;
