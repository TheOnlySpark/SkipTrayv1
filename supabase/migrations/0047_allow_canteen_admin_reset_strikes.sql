-- ============================================================================
-- MIGRATION 0047: Allow Canteen Admin to Reset Student Strikes in Tenant
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_reset_student_strikes(p_student_id uuid)
RETURNS json AS $$
DECLARE
  v_caller_role   public.user_role;
  v_caller_tenant uuid;
  v_target_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  v_caller_role := public.get_user_role();
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('CANTEEN_ADMIN', 'UNI_ADMIN', 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized: only canteen and organization administrators can reset strikes';
  END IF;

  SELECT tenant_id INTO v_target_tenant
  FROM public.profiles
  WHERE id = p_student_id;

  IF v_target_tenant IS NULL THEN
    RAISE EXCEPTION 'Student not found';
  END IF;

  IF v_caller_role != 'SUPER_ADMIN' THEN
    v_caller_tenant := public.get_my_tenant_id();
    IF v_caller_tenant IS DISTINCT FROM v_target_tenant THEN
      RAISE EXCEPTION 'Student not found in your organization';
    END IF;
  END IF;

  UPDATE public.profiles
  SET strike_count = 0, suspended_until = NULL
  WHERE id = p_student_id;

  RETURN json_build_object('success', true, 'message', 'Strikes and suspension cleared successfully');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.admin_reset_student_strikes(uuid) TO authenticated;
