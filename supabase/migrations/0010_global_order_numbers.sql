-- Migration: Global unique incrementing order numbers across all orders
-- Replaces daily-resetting sequence with a continuous global sequence so every order gets a unique incrementing number (Order #1, #2, #3...)

-- 1. Create a global sequence for orders
CREATE SEQUENCE IF NOT EXISTS public.order_number_seq START WITH 1 INCREMENT BY 1;

-- 2. Backfill existing orders in public.orders chronologically by created_at so past orders have distinct sequential numbers
DO $$
DECLARE
    r RECORD;
    i INT := 1;
BEGIN
    FOR r IN (SELECT id FROM public.orders ORDER BY created_at ASC) LOOP
        UPDATE public.orders SET order_number = i WHERE id = r.id;
        i := i + 1;
    END LOOP;
    
    -- Sync sequence with the current max order_number
    IF (SELECT COUNT(*) FROM public.orders) > 0 THEN
        PERFORM setval('public.order_number_seq', (SELECT MAX(order_number) FROM public.orders), true);
    ELSE
        PERFORM setval('public.order_number_seq', 1, false);
    END IF;
END $$;

-- 3. Update the function for backward compatibility
CREATE OR REPLACE FUNCTION public.get_next_daily_order_number()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN nextval('public.order_number_seq');
END;
$$;

-- 4. Set the default for order_number in orders to directly use the global sequence
ALTER TABLE public.orders 
ALTER COLUMN order_number SET DEFAULT nextval('public.order_number_seq'::regclass);

-- 5. Grant permissions to roles
GRANT USAGE, SELECT ON SEQUENCE public.order_number_seq TO authenticated, anon, service_role;
