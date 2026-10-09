-- 0030_zohopay_idempotency.sql

-- 1. Add idempotency_key to orders table (if not exists)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS idempotency_key UUID;
-- We can't do IF NOT EXISTS for ADD CONSTRAINT natively in a clean one-liner across all postgres versions,
-- but since it might exist, we'll wrap it in an anonymous block to avoid errors.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_idempotency_key_key') THEN
        ALTER TABLE public.orders ADD CONSTRAINT orders_idempotency_key_key UNIQUE (idempotency_key);
    END IF;
END $$;

-- 2. Drop the old non-payment RPC functions
DROP FUNCTION IF EXISTS public.place_order_with_otp(TEXT, JSON);
DROP FUNCTION IF EXISTS public.place_order_with_otp(TEXT, JSON, BOOLEAN);
DROP FUNCTION IF EXISTS public.place_order_with_otp(TEXT, JSON, BOOLEAN, UUID);

-- 3. Update the payments table schema to generic/ZohoPay naming instead of Cashfree
ALTER TABLE public.payments RENAME COLUMN cf_order_id TO provider_order_id;
ALTER TABLE public.payments RENAME COLUMN cf_payment_id TO provider_payment_id;
