CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  -- First try to get tenant_id from user_metadata (used by frontend signups)
  v_tenant_id := (new.raw_user_meta_data->>'tenant_id')::uuid;

  -- If not found, try app_metadata (used by edge functions or server-side admin client)
  IF v_tenant_id IS NULL THEN
    v_tenant_id := (new.raw_app_meta_data->>'tenant_id')::uuid;
  END IF;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id is required in either user_metadata or app_metadata for new user signup';
  END IF;

  INSERT INTO public.profiles (id, role, tenant_id)
  VALUES (new.id, 'STUDENT', v_tenant_id);

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
