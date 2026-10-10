-- Update daily order numbers to start from 1 and end at 1000.

-- Reset today's sequence so the next order starts from 1.
UPDATE public.daily_sequences SET last_value = 0 WHERE seq_date = CURRENT_DATE;

CREATE OR REPLACE FUNCTION public.get_next_daily_order_number()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    next_val INTEGER;
BEGIN
    INSERT INTO public.daily_sequences (seq_date, last_value)
    VALUES (CURRENT_DATE, 1)
    ON CONFLICT (seq_date) 
    DO UPDATE SET last_value = daily_sequences.last_value + 1
    RETURNING last_value INTO next_val;
    
    IF next_val > 1000 THEN
        RAISE EXCEPTION 'Daily order limit of 1000 reached';
    END IF;

    RETURN next_val;
END;
$$;
