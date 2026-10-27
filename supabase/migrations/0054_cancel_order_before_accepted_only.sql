-- ============================================================================
-- MIGRATION 0054: Cancel Order Before Accepted Only & Restock Inventory
-- ============================================================================
-- Business Rules:
-- 1. Orders can ONLY be cancelled while in 'PLACED' status (before kitchen staff accepts).
-- 2. Once accepted (or in any later stage: PREPARING, READY, COLLECTED, REJECTED), cancellation is strictly prohibited.
-- 3. The previous 5-minute cancellation window is REMOVED.
-- 4. Ensures cancellation_reason column exists on public.orders.
-- 5. Restocks inventory: increments stock_quantity for tracked menu items and clears is_sold_out.
-- 6. Invalidates active OTP challenges and logs event to order_security_audit_log.
-- ============================================================================

-- 1. Ensure cancellation_reason column exists on public.orders
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS cancellation_reason TEXT DEFAULT NULL;

-- 2. Drop existing function signatures to avoid ambiguity
DROP FUNCTION IF EXISTS public.cancel_order(uuid);
DROP FUNCTION IF EXISTS public.cancel_order(uuid, text);

-- 3. Create hardened cancel_order RPC
CREATE OR REPLACE FUNCTION public.cancel_order(
  p_order_id uuid,
  p_reason   text DEFAULT 'USER_CANCELLED'
) RETURNS json AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_item  RECORD;
BEGIN
  -- Authenticate caller
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Lock target order row for update
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Ownership check: caller must be the customer who placed the order
  IF v_order.user_id != auth.uid() THEN
    RAISE EXCEPTION 'Access denied: cannot cancel order belonging to another customer';
  END IF;

  -- Status check: orders can only be cancelled while in PLACED status (before kitchen accepts)
  IF v_order.status != 'PLACED' THEN
    RAISE EXCEPTION 'Order cannot be cancelled once accepted by the kitchen (current status: %)', v_order.status;
  END IF;

  -- Restock any items that track stock_quantity
  FOR v_item IN
    SELECT oi.menu_item_id, oi.quantity
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
  LOOP
    UPDATE public.menu_items
    SET stock_quantity = stock_quantity + v_item.quantity,
        is_sold_out = CASE WHEN (stock_quantity + v_item.quantity) > 0 THEN false ELSE is_sold_out END
    WHERE id = v_item.menu_item_id
      AND stock_quantity IS NOT NULL;
  END LOOP;

  -- Transition order status to REJECTED with cancellation reason
  UPDATE public.orders
  SET status = 'REJECTED',
      cancellation_reason = COALESCE(p_reason, 'USER_CANCELLED')
  WHERE id = p_order_id;

  -- Invalidate any active OTP challenge
  UPDATE public.order_otp_challenges
  SET status = 'SUPERSEDED'
  WHERE order_id = p_order_id AND status = 'ACTIVE';

  -- Record audit log
  BEGIN
    INSERT INTO public.order_security_audit_log (
      order_id, actor_id, actor_role, event_type, previous_status, new_status, details
    ) VALUES (
      p_order_id, auth.uid(), 'STUDENT', 'ORDER_CANCELLED', v_order.status::text, 'REJECTED',
      json_build_object('reason', COALESCE(p_reason, 'USER_CANCELLED'))
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN json_build_object(
    'success', true,
    'order_id', p_order_id,
    'status', 'REJECTED',
    'cancellation_reason', COALESCE(p_reason, 'USER_CANCELLED'),
    'message', 'Order cancelled successfully.'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

-- 4. Set execution permissions
REVOKE EXECUTE ON FUNCTION public.cancel_order(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid, text) TO authenticated;

-- 5. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
