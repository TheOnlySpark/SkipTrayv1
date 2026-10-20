-- ============================================================================
-- MIGRATION 0042: Allow Canteen Admin to delete menu items cleanly
-- Drops and recreates the foreign key constraint with ON DELETE CASCADE,
-- and creates an RPC function for secure deletion.
-- ============================================================================

-- 1. Update foreign key on order_items to ON DELETE CASCADE so menu items can be deleted
DO $$
BEGIN
  ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_menu_item_id_fkey;
  ALTER TABLE public.order_items
    ADD CONSTRAINT order_items_menu_item_id_fkey
    FOREIGN KEY (menu_item_id)
    REFERENCES public.menu_items(id)
    ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- 2. Setup RLS Delete Policy for menu_items if not present
DROP POLICY IF EXISTS "Canteen Admins can delete own menu items" ON public.menu_items;

CREATE POLICY "Canteen Admins can delete own menu items"
  ON public.menu_items FOR DELETE
  TO authenticated
  USING (
    public.get_user_role() IN ('CANTEEN_ADMIN', 'SUPER_ADMIN')
    AND canteen_id = public.get_my_canteen_id()
  );

-- 3. Secure RPC function for Canteen Admins to delete menu items
CREATE OR REPLACE FUNCTION public.canteen_admin_delete_menu_item(p_item_id uuid)
RETURNS json AS $$
DECLARE
  v_caller_role public.user_role;
  v_caller_canteen uuid;
  v_item_canteen uuid;
BEGIN
  v_caller_role := public.get_user_role();
  IF v_caller_role NOT IN ('CANTEEN_ADMIN', 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized: Only Canteen Admins can delete menu items';
  END IF;

  v_caller_canteen := public.get_my_canteen_id();

  SELECT canteen_id INTO v_item_canteen
  FROM public.menu_items
  WHERE id = p_item_id;

  IF v_item_canteen IS NULL THEN
    RETURN json_build_object('success', true, 'message', 'Item already deleted');
  END IF;

  IF v_caller_role = 'CANTEEN_ADMIN' AND v_item_canteen IS DISTINCT FROM v_caller_canteen THEN
    RAISE EXCEPTION 'Unauthorized: Can only delete items from your own canteen';
  END IF;

  DELETE FROM public.order_items WHERE menu_item_id = p_item_id;
  DELETE FROM public.item_reviews WHERE menu_item_id = p_item_id;
  DELETE FROM public.menu_items WHERE id = p_item_id;

  RETURN json_build_object('success', true, 'message', 'Menu item permanently deleted');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Clean up any leftover test items that were marked [ARCHIVED] or [DELETED]
DELETE FROM public.order_items WHERE menu_item_id IN (
  SELECT id FROM public.menu_items WHERE name ILIKE '%[archived]%' OR name ILIKE '%[deleted]%'
);
DELETE FROM public.item_reviews WHERE menu_item_id IN (
  SELECT id FROM public.menu_items WHERE name ILIKE '%[archived]%' OR name ILIKE '%[deleted]%'
);
DELETE FROM public.menu_items WHERE name ILIKE '%[archived]%' OR name ILIKE '%[deleted]%';

