-- Drop the old verify_pickup_otp function signature to prevent PostgREST ambiguity errors
DROP FUNCTION IF EXISTS public.verify_pickup_otp(uuid, text);
