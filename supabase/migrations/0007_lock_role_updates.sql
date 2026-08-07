-- SECURITY FIX: Prevent users from modifying their own role via profile updates.
-- Staff and Admin roles must be assigned via direct DB access or admin-only RPC.

-- Drop the existing permissive update policy
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

-- Create a restrictive policy: users can update their own profile,
-- but the role column must remain unchanged (prevents privilege escalation).
CREATE POLICY "Users can update own profile safely" ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    role = (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid())
  );
