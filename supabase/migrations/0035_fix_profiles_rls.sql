-- Allow CANTEEN_ADMIN and STAFF to view profiles in their canteen, and allow them to view tenant profiles for orders context
DROP POLICY IF EXISTS "Elevated roles can view relevant profiles" ON public.profiles;

CREATE POLICY "Elevated roles can view relevant profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    (public.get_user_role() = 'SUPER_ADMIN')
    OR
    (public.get_user_role() = 'UNI_ADMIN' AND tenant_id = public.get_my_tenant_id())
    OR
    (public.get_user_role() IN ('CANTEEN_ADMIN', 'STAFF') AND tenant_id = public.get_my_tenant_id())
  );
