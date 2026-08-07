CREATE TABLE IF NOT EXISTS public.daily_sequences (
    seq_date DATE PRIMARY KEY,
    last_value INTEGER NOT NULL DEFAULT 999
);

ALTER TABLE public.daily_sequences ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.get_next_daily_order_number()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    next_val INTEGER;
BEGIN
    INSERT INTO public.daily_sequences (seq_date, last_value)
    VALUES (CURRENT_DATE, 1000)
    ON CONFLICT (seq_date) 
    DO UPDATE SET last_value = daily_sequences.last_value + 1
    RETURNING last_value INTO next_val;
    
    RETURN next_val;
END;
$$;

ALTER TABLE public.orders 
ADD COLUMN order_number INTEGER DEFAULT public.get_next_daily_order_number() NOT NULL;
