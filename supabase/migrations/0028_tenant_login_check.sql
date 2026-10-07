-- Check if an email belongs to a specific tenant before allowing password verification
CREATE OR REPLACE FUNCTION public.check_user_tenant_access(p_email text, p_tenant_id uuid)
RETURNS boolean AS $$
DECLARE
  v_user_id uuid;
  v_user_tenant_id uuid;
  v_role public.user_role;
BEGIN
  -- Look up the user by email in auth.users
  SELECT id INTO v_user_id FROM auth.users WHERE email = p_email;
  
  -- If email doesn't exist, return true to let signInWithPassword handle the "Invalid credentials" error normally
  -- This prevents email enumeration attacks! If we returned false, hackers could brute-force which emails exist.
  IF v_user_id IS NULL THEN
    RETURN true; 
  END IF;

  -- Get their profile info
  SELECT tenant_id, role INTO v_user_tenant_id, v_role FROM public.profiles WHERE id = v_user_id;

  -- Super admins can log in anywhere
  IF v_role = 'SUPER_ADMIN' THEN
    RETURN true;
  END IF;

  -- Otherwise, they must match the tenant
  RETURN v_user_tenant_id = p_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
