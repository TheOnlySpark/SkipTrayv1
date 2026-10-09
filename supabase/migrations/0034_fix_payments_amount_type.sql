-- Alter payments amount to support decimals (fees added decimal values)
ALTER TABLE public.payments ALTER COLUMN amount TYPE numeric(10, 2);
