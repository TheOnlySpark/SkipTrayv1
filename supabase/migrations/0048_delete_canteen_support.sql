-- ============================================================================
-- MIGRATION 0048: Secure Canteen Deletion with Complete Cascade Cleanup
-- Allows UNI_ADMIN and SUPER_ADMIN to cleanly delete a canteen along with all
-- associated operational and historical child entities in a safe transactional flow.
-- ============================================================================

-- 1. Ensure foreign key constraint on orders allows ON DELETE CASCADE or clean handling
DO $$
BEGIN
  -- Drop existing restrict constraint on orders.canteen_id if present
  ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_canteen_id_fkey;
  ALTER TABLE public.orders
    ADD CONSTRAINT orders_canteen_id_fkey
    FOREIGN KEY (canteen_id)
    REFERENCES public.canteens(id)
    ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- 2. Ensure foreign key on order_ledger has ON DELETE CASCADE if present
DO $$
BEGIN
  ALTER TABLE public.order_ledger DROP CONSTRAINT IF EXISTS order_ledger_canteen_id_fkey;
  ALTER TABLE public.order_ledger
    ADD CONSTRAINT order_ledger_canteen_id_fkey
    FOREIGN KEY (canteen_id)
    REFERENCES public.canteens(id)
    ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- 3. Create or replace RLS delete policy on canteens for UNI_ADMIN & SUPER_ADMIN
DROP POLICY IF EXISTS "Admins can delete canteens" ON public.canteens;

CREATE POLICY "Admins can delete canteens"
  ON public.canteens FOR DELETE
  TO authenticated
  USING (
    (
      public.get_user_role() = 'UNI_ADMIN'
      AND tenant_id = public.get_my_tenant_id()
    )
    OR public.get_user_role() = 'SUPER_ADMIN'
  );

-- 4. Create secure RPC function to delete canteen and all associated records
CREATE OR REPLACE FUNCTION public.delete_canteen(p_canteen_id uuid)
RETURNS json AS $$
DECLARE
  v_caller_role public.user_role;
  v_caller_tenant uuid;
  v_target_tenant uuid;
  v_canteen_name text;
BEGIN
  -- Verify caller role
  v_caller_role := public.get_user_role();
  IF v_caller_role NOT IN ('UNI_ADMIN', 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized: Only University Admins or Super Admins can delete canteens.';
  END IF;

  -- Check if canteen exists and retrieve tenant information
  SELECT tenant_id, name INTO v_target_tenant, v_canteen_name
  FROM public.canteens
  WHERE id = p_canteen_id;

  IF v_target_tenant IS NULL THEN
    RETURN json_build_object(
      'success', true,
      'message', 'Canteen already deleted or does not exist.'
    );
  END IF;

  -- Verify tenant isolation for UNI_ADMIN
  IF v_caller_role = 'UNI_ADMIN' THEN
    v_caller_tenant := public.get_my_tenant_id();
    IF v_target_tenant IS DISTINCT FROM v_caller_tenant THEN
      RAISE EXCEPTION 'Unauthorized: You can only delete canteens belonging to your university tenant.';
    END IF;
  END IF;

  -- 1. Remove order items & order challenges belonging to this canteen's orders
  DELETE FROM public.order_items
  WHERE order_id IN (SELECT id FROM public.orders WHERE canteen_id = p_canteen_id);

  DELETE FROM public.order_otp_challenges
  WHERE order_id IN (SELECT id FROM public.orders WHERE canteen_id = p_canteen_id);

  -- 2. Remove reviews associated with this canteen's menu items
  DELETE FROM public.item_reviews
  WHERE menu_item_id IN (SELECT id FROM public.menu_items WHERE canteen_id = p_canteen_id);

  -- 3. Remove order ledger entries for this canteen
  DELETE FROM public.order_ledger
  WHERE canteen_id = p_canteen_id;

  -- 4. Nullify or clean up payments linked to this canteen
  UPDATE public.payments
  SET canteen_id = NULL
  WHERE canteen_id = p_canteen_id;

  -- 5. Remove orders for this canteen
  DELETE FROM public.orders
  WHERE canteen_id = p_canteen_id;

  -- 6. Remove menu items for this canteen
  DELETE FROM public.menu_items
  WHERE canteen_id = p_canteen_id;

  -- 7. Remove lunch slots and tax configs for this canteen
  DELETE FROM public.lunch_slot_configs
  WHERE canteen_id = p_canteen_id;

  DELETE FROM public.canteen_tax_configs
  WHERE canteen_id = p_canteen_id;

  -- 8. Detach staff and canteen admins from this canteen
  UPDATE public.profiles
  SET canteen_id = NULL
  WHERE canteen_id = p_canteen_id;

  -- 9. Delete the canteen record itself
  DELETE FROM public.canteens
  WHERE id = p_canteen_id;

  RETURN json_build_object(
    'success', true,
    'message', format('Canteen "%s" and all its associated data were permanently deleted.', v_canteen_name)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execution to authenticated users (function self-enforces role & tenant checks)
GRANT EXECUTE ON FUNCTION public.delete_canteen(uuid) TO authenticated;
