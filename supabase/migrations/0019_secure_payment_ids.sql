-- Add UNIQUE constraint to razorpay_payment_id to prevent replay attacks
ALTER TABLE public.payments 
ADD CONSTRAINT unique_razorpay_payment_id UNIQUE (razorpay_payment_id);
