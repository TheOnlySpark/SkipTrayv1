-- ============================================
-- Migration: Razorpay → Cashfree
-- Purges all existing payment data and renames columns
-- ============================================

-- 1. Clear all existing payment data (Razorpay test data)
--    Must clear orders FK first due to constraint (orders.payment_id → payments.id)
UPDATE public.orders SET payment_id = NULL WHERE payment_id IS NOT NULL;
DELETE FROM public.payments;

-- 2. Drop the old unique constraint
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS unique_razorpay_payment_id;

-- 3. Rename columns from razorpay_* to cf_*
ALTER TABLE public.payments RENAME COLUMN razorpay_order_id TO cf_order_id;
ALTER TABLE public.payments RENAME COLUMN razorpay_payment_id TO cf_payment_id;

-- 4. Drop the signature column (Cashfree uses server-side API verification, no client signature)
ALTER TABLE public.payments DROP COLUMN IF EXISTS razorpay_signature;

-- 5. Add new unique constraint on cf_payment_id to prevent replay attacks
ALTER TABLE public.payments ADD CONSTRAINT unique_cf_payment_id UNIQUE (cf_payment_id);
