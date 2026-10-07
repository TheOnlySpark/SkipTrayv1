-- ============================================================================
-- MIGRATION 0029: Multi-Location Support (Multiple Cafeterias & Canteens)
-- Adds canteens table, canteen_id to menu_items, orders, and profiles (staff).
-- Backfills default "Ground Floor Canteen" (GFC) for existing data.
-- Enforces:
--   1. Only one active order per profile across all canteens
--   2. Staff lockdown strictly to their assigned canteen
-- ============================================================================

-- 1. Create canteens table
CREATE TABLE IF NOT EXISTS public.canteens (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   uuid REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  name        text NOT NULL,       -- e.g. "Ground Floor Canteen", "Engineering Cafeteria"
  code        text,                -- e.g. "GFC", "ENGG"
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.canteens ENABLE ROW LEVEL SECURITY;

-- 2. Add canteen_id to profiles, menu_items, and orders
ALTER TABLE public.profiles   ADD COLUMN IF NOT EXISTS canteen_id uuid REFERENCES public.canteens(id) ON DELETE SET NULL;
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS canteen_id uuid REFERENCES public.canteens(id) ON DELETE CASCADE;
ALTER TABLE public.orders     ADD COLUMN IF NOT EXISTS canteen_id uuid REFERENCES public.canteens(id) ON DELETE RESTRICT;

-- 3. Seed deterministic Ground Floor Canteen for default tenant
INSERT INTO public.canteens (id, tenant_id, name, code, is_active)
VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Ground Floor Canteen', 'GFC', true)
ON CONFLICT (id) DO NOTHING;

-- 4. Seed Ground Floor Canteen for any other existing tenants
INSERT INTO public.canteens (tenant_id, name, code, is_active)
SELECT t.id, 'Ground Floor Canteen', 'GFC', true
FROM public.tenants t
WHERE t.id NOT IN (SELECT c.tenant_id FROM public.canteens c);

-- 5. Backfill existing menu_items, orders, and staff profiles
UPDATE public.menu_items m
SET canteen_id = (SELECT c.id FROM public.canteens c WHERE c.tenant_id = m.tenant_id ORDER BY c.created_at ASC LIMIT 1)
WHERE canteen_id IS NULL;

UPDATE public.orders o
SET canteen_id = (SELECT c.id FROM public.canteens c WHERE c.tenant_id = o.tenant_id ORDER BY c.created_at ASC LIMIT 1)
WHERE canteen_id IS NULL;

UPDATE public.profiles p
SET canteen_id = (SELECT c.id FROM public.canteens c WHERE c.tenant_id = p.tenant_id ORDER BY c.created_at ASC LIMIT 1)
WHERE p.role = 'STAFF' AND p.canteen_id IS NULL;

-- 6. Enforce NOT NULL on menu_items and orders
ALTER TABLE public.menu_items ALTER COLUMN canteen_id SET NOT NULL;
ALTER TABLE public.orders     ALTER COLUMN canteen_id SET NOT NULL;

-- 7. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_canteens_tenant      ON public.canteens(tenant_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_canteen   ON public.menu_items(canteen_id);
CREATE INDEX IF NOT EXISTS idx_orders_canteen       ON public.orders(canteen_id);
CREATE INDEX IF NOT EXISTS idx_profiles_canteen     ON public.profiles(canteen_id);

-- 8. RLS Policies for canteens table
CREATE POLICY "Tenant users can view active canteens"
  ON public.canteens FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND is_active = true);

CREATE POLICY "Tenant Admins can view all canteens"
  ON public.canteens FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.get_my_tenant_id()
    AND public.get_user_role() IN ('ADMIN', 'SUPER_ADMIN')
  );

CREATE POLICY "Tenant Admins can manage canteens"
  ON public.canteens FOR ALL
  TO authenticated
  USING (
    tenant_id = public.get_my_tenant_id()
    AND public.get_user_role() IN ('ADMIN', 'SUPER_ADMIN')
  )
  WITH CHECK (
    tenant_id = public.get_my_tenant_id()
    AND public.get_user_role() IN ('ADMIN', 'SUPER_ADMIN')
  );

CREATE POLICY "SUPER_ADMIN full access on canteens"
  ON public.canteens FOR ALL
  TO authenticated
  USING (public.get_user_role() = 'SUPER_ADMIN')
  WITH CHECK (public.get_user_role() = 'SUPER_ADMIN');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.canteens TO authenticated;

-- 9. Update orders policies for strict staff lockdown by canteen
DROP POLICY IF EXISTS "Staff and Admin can view tenant orders"   ON public.orders;
DROP POLICY IF EXISTS "Staff and Admin can update tenant orders" ON public.orders;

CREATE POLICY "Staff can view assigned canteen orders and Admin can view tenant orders"
  ON public.orders FOR SELECT
  TO authenticated
  USING (
    (public.get_user_role() = 'STAFF' AND canteen_id = (SELECT canteen_id FROM public.profiles WHERE id = auth.uid()))
    OR
    (public.get_user_role() IN ('ADMIN', 'SUPER_ADMIN') AND tenant_id = public.get_my_tenant_id())
  );

CREATE POLICY "Staff can update assigned canteen orders and Admin can update tenant orders"
  ON public.orders FOR UPDATE
  TO authenticated
  USING (
    (public.get_user_role() = 'STAFF' AND canteen_id = (SELECT canteen_id FROM public.profiles WHERE id = auth.uid()))
    OR
    (public.get_user_role() IN ('ADMIN', 'SUPER_ADMIN') AND tenant_id = public.get_my_tenant_id())
  )
  WITH CHECK (
    (public.get_user_role() = 'STAFF' AND canteen_id = (SELECT canteen_id FROM public.profiles WHERE id = auth.uid()))
    OR
    (public.get_user_role() IN ('ADMIN', 'SUPER_ADMIN') AND tenant_id = public.get_my_tenant_id())
  );

-- 10. Update place_order_with_otp RPC with single active order rule & canteen scoping
DROP FUNCTION IF EXISTS public.place_order_with_otp(TEXT, JSON);
DROP FUNCTION IF EXISTS public.place_order_with_otp(TEXT, JSON, BOOLEAN);
DROP FUNCTION IF EXISTS public.place_order_with_otp(TEXT, JSON, BOOLEAN, UUID);

CREATE OR REPLACE FUNCTION public.place_order_with_otp(
  p_pickup_time TEXT,
  p_items JSON,
  p_is_takeaway BOOLEAN DEFAULT false,
  p_canteen_id UUID DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
  v_order_id        uuid;
  v_otp             text;
  v_user_id         uuid;
  v_tenant_id       uuid;
  v_canteen_id      uuid := p_canteen_id;
  v_item            json;
  v_total_quantity  int := 0;
  v_suspended_until timestamptz;
  v_now_ist         timestamptz;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_tenant_id := public.get_my_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'User has no tenant association';
  END IF;

  -- RULE: Strictly only ONE active order in progress per profile regardless of canteens
  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE user_id = v_user_id
      AND status IN ('PLACED', 'ACCEPTED', 'PREPARING', 'READY')
  ) THEN
    RAISE EXCEPTION 'You already have an active order in progress. You can only place one active order at a time.';
  END IF;

  -- Check suspension
  SELECT suspended_until INTO v_suspended_until
  FROM public.profiles WHERE id = v_user_id;

  IF v_suspended_until IS NOT NULL AND v_suspended_until > NOW() THEN
    RAISE EXCEPTION 'Your account is deactivated until % due to repeated order no-shows (2 strikes).',
      to_char(v_suspended_until AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH:MI AM (IST)');
  END IF;

  v_now_ist := NOW() AT TIME ZONE 'Asia/Kolkata';

  IF EXTRACT(DOW FROM v_now_ist) = 0 THEN
    RAISE EXCEPTION 'Orders cannot be placed on Sundays. The cafeteria is closed.';
  END IF;

  IF v_now_ist::time < TIME '09:30:00' THEN
    RAISE EXCEPTION 'Lunch booking opens at 9:30 AM in the morning.';
  END IF;

  IF p_pickup_time !~ '^\d{2}:\d{2}$' THEN
    RAISE EXCEPTION 'Invalid pickup time format. Use HH:MM.';
  END IF;

  IF p_pickup_time NOT IN ('11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30') THEN
    RAISE EXCEPTION 'Invalid pickup slot. Lunch pickup slots are available only between 11:30 AM and 2:30 PM in 30-minute intervals.';
  END IF;

  IF (v_now_ist::date + p_pickup_time::time) < (v_now_ist + INTERVAL '29 minutes') THEN
    RAISE EXCEPTION 'Orders must be placed at least 30 minutes in advance of the pickup slot.';
  END IF;

  IF p_items IS NULL OR json_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must contain at least one item';
  END IF;

  IF json_array_length(p_items) > 5 THEN
    RAISE EXCEPTION 'Maximum 5 distinct items per order';
  END IF;

  -- Resolve default canteen if not provided
  IF v_canteen_id IS NULL THEN
    SELECT id INTO v_canteen_id
    FROM public.canteens
    WHERE tenant_id = v_tenant_id AND is_active = true
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_canteen_id IS NULL THEN
    RAISE EXCEPTION 'No active cafeteria/canteen found for this organization.';
  END IF;

  -- Validate canteen belongs to this tenant and is active
  IF NOT EXISTS (
    SELECT 1 FROM public.canteens
    WHERE id = v_canteen_id AND tenant_id = v_tenant_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Selected cafeteria/canteen is not available.';
  END IF;

  FOR v_item IN SELECT * FROM json_array_elements(p_items) LOOP
    IF (v_item->>'quantity')::int < 1 THEN
      RAISE EXCEPTION 'Item quantity must be at least 1';
    END IF;
    IF (v_item->>'quantity')::int > 10 THEN
      RAISE EXCEPTION 'Maximum quantity per item is 10';
    END IF;

    v_total_quantity := v_total_quantity + (v_item->>'quantity')::int;

    -- Validate menu item belongs to THIS tenant and THIS canteen
    IF NOT EXISTS (
      SELECT 1 FROM public.menu_items
      WHERE id = (v_item->>'menu_item_id')::uuid 
        AND tenant_id = v_tenant_id
        AND canteen_id = v_canteen_id
    ) THEN
      RAISE EXCEPTION 'Menu item not found in the selected cafeteria.';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.menu_items
      WHERE id = (v_item->>'menu_item_id')::uuid
        AND tenant_id = v_tenant_id
        AND canteen_id = v_canteen_id
        AND is_sold_out = true
    ) THEN
      RAISE EXCEPTION 'An item in your order is sold out';
    END IF;
  END LOOP;

  IF v_total_quantity > 15 THEN
    RAISE EXCEPTION 'Total quantity across all items cannot exceed 15';
  END IF;

  v_otp := lpad(floor(random() * 1000000)::text, 6, '0');

  -- OTP uniqueness scoped to THIS tenant
  WHILE EXISTS (
    SELECT 1 FROM public.orders
    WHERE otp_code = v_otp
      AND tenant_id = v_tenant_id
      AND status IN ('PLACED', 'ACCEPTED', 'PREPARING', 'READY')
  ) LOOP
    v_otp := lpad(floor(random() * 1000000)::text, 6, '0');
  END LOOP;

  -- Insert order with canteen_id
  INSERT INTO public.orders (user_id, status, pickup_time, otp_code, is_takeaway, tenant_id, canteen_id)
  VALUES (v_user_id, 'PLACED', p_pickup_time, v_otp, p_is_takeaway, v_tenant_id, v_canteen_id)
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM json_array_elements(p_items) LOOP
    INSERT INTO public.order_items (order_id, menu_item_id, quantity)
    VALUES (v_order_id, (v_item->>'menu_item_id')::uuid, (v_item->>'quantity')::int);
  END LOOP;

  RETURN v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.place_order_with_otp(TEXT, JSON, BOOLEAN, UUID) TO authenticated;

-- 11. Update update_order_status RPC with staff canteen lockdown
CREATE OR REPLACE FUNCTION public.update_order_status(
  p_order_id uuid,
  p_status   public.order_status
) RETURNS void AS $$
DECLARE
  v_caller_role public.user_role;
  v_caller_tenant uuid;
  v_caller_canteen uuid;
  v_order_tenant uuid;
  v_order_canteen uuid;
BEGIN
  v_caller_role := public.get_user_role();
  IF v_caller_role NOT IN ('STAFF', 'ADMIN', 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT tenant_id, canteen_id INTO v_order_tenant, v_order_canteen
  FROM public.orders
  WHERE id = p_order_id;

  IF v_order_tenant IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_caller_role != 'SUPER_ADMIN' THEN
    v_caller_tenant := public.get_my_tenant_id();
    IF v_caller_tenant IS DISTINCT FROM v_order_tenant THEN
      RAISE EXCEPTION 'Access denied: order belongs to another organization';
    END IF;

    -- Staff lockdown check
    IF v_caller_role = 'STAFF' THEN
      SELECT canteen_id INTO v_caller_canteen
      FROM public.profiles
      WHERE id = auth.uid();

      IF v_caller_canteen IS NULL OR v_caller_canteen IS DISTINCT FROM v_order_canteen THEN
        RAISE EXCEPTION 'Access denied: You are only authorized to manage orders for your assigned cafeteria.';
      END IF;
    END IF;
  END IF;

  UPDATE public.orders
  SET
    status       = p_status,
    accepted_at  = CASE WHEN p_status = 'ACCEPTED'  THEN NOW() ELSE accepted_at  END,
    ready_at     = CASE WHEN p_status = 'READY'     THEN NOW() ELSE ready_at     END,
    collected_at = CASE WHEN p_status = 'COLLECTED' THEN NOW() ELSE collected_at END
  WHERE id = p_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

NOTIFY pgrst, 'reload schema';
