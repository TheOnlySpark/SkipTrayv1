-- ============================================
-- Migration: Cashfree → ZohoPay
-- Renames columns
-- ============================================

-- 1. Drop the old unique constraint
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS unique_cf_payment_id;

-- 2. Rename columns from cf_* to zohopay_*
ALTER TABLE public.payments RENAME COLUMN cf_order_id TO zohopay_order_id;
ALTER TABLE public.payments RENAME COLUMN cf_payment_id TO zohopay_payment_id;

-- 3. Add new unique constraint on zohopay_payment_id to prevent replay attacks
ALTER TABLE public.payments ADD CONSTRAINT unique_zohopay_payment_id UNIQUE (zohopay_payment_id);
