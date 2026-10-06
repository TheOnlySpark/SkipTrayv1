-- ============================================================================
-- MIGRATION 0023: Tenant-Scoped RLS Policies
-- Drops all existing policies and replaces with tenant-scoped versions.
-- ============================================================================

-- -----------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER to avoid RLS recursion on profiles)
-- -----------------------------------------------------------------------

-- Returns the current user's tenant_id
CREATE OR REPLACE FUNCTION public.get_my_tenant_id()
RETURNS uuid AS $$
  SELECT tenant_id FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE;

-- Replaces existing get_user_role() — now STABLE for query inlining
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS public.user_role AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE;


-- -----------------------------------------------------------------------
-- TENANTS table policies
-- -----------------------------------------------------------------------

-- anon: can SELECT active tenants to resolve slug → tenant_id at login time
CREATE POLICY "Public slug lookup"
  ON public.tenants FOR SELECT
  TO anon
  USING (is_active = true);

-- authenticated: can read their own tenant row
CREATE POLICY "Users can read own tenant"
  ON public.tenants FOR SELECT
  TO authenticated
  USING (id = public.get_my_tenant_id());

-- SUPER_ADMIN: full access across all tenants
CREATE POLICY "SUPER_ADMIN full access on tenants"
  ON public.tenants FOR ALL
  TO authenticated
  USING (public.get_user_role() = 'SUPER_ADMIN')
  WITH CHECK (public.get_user_role() = 'SUPER_ADMIN');


-- -----------------------------------------------------------------------
-- TENANT_SETTINGS table policies
-- -----------------------------------------------------------------------

CREATE POLICY "Users can read own tenant settings"
  ON public.tenant_settings FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_my_tenant_id());

CREATE POLICY "Admin can update own tenant settings"
  ON public.tenant_settings FOR UPDATE
  TO authenticated
  USING (
    tenant_id = public.get_my_tenant_id()
    AND public.get_user_role() IN ('ADMIN', 'SUPER_ADMIN')
  )
  WITH CHECK (
    tenant_id = public.get_my_tenant_id()
    AND public.get_user_role() IN ('ADMIN', 'SUPER_ADMIN')
  );

CREATE POLICY "SUPER_ADMIN full access on tenant_settings"
  ON public.tenant_settings FOR ALL
  TO authenticated
  USING (public.get_user_role() = 'SUPER_ADMIN')
  WITH CHECK (public.get_user_role() = 'SUPER_ADMIN');


-- -----------------------------------------------------------------------
-- PROFILES policies
-- -----------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own profile"        ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile"      ON public.profiles;
DROP POLICY IF EXISTS "Staff/Admin can view all profiles" ON public.profiles;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "Staff and Admin can view tenant profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.get_my_tenant_id()
    AND public.get_user_role() IN ('STAFF', 'ADMIN')
  );

CREATE POLICY "SUPER_ADMIN full access on profiles"
  ON public.profiles FOR ALL
  TO authenticated
  USING (public.get_user_role() = 'SUPER_ADMIN')
  WITH CHECK (public.get_user_role() = 'SUPER_ADMIN');


-- -----------------------------------------------------------------------
-- MENU_ITEMS policies
-- -----------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view menu items"  ON public.menu_items;
DROP POLICY IF EXISTS "Admin can insert menu items" ON public.menu_items;
DROP POLICY IF EXISTS "Admin can update menu items" ON public.menu_items;
DROP POLICY IF EXISTS "Admin can delete menu items" ON public.menu_items;

CREATE POLICY "Tenant users can view menu items"
  ON public.menu_items FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_my_tenant_id());

CREATE POLICY "Tenant Admin can insert menu items"
  ON public.menu_items FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = public.get_my_tenant_id()
    AND public.get_user_role() IN ('ADMIN', 'SUPER_ADMIN')
  );

CREATE POLICY "Tenant Admin can update menu items"
  ON public.menu_items FOR UPDATE
  TO authenticated
  USING (
    tenant_id = public.get_my_tenant_id()
    AND public.get_user_role() IN ('ADMIN', 'SUPER_ADMIN')
  )
  WITH CHECK (tenant_id = public.get_my_tenant_id());

CREATE POLICY "Tenant Admin can delete menu items"
  ON public.menu_items FOR DELETE
  TO authenticated
  USING (
    tenant_id = public.get_my_tenant_id()
    AND public.get_user_role() IN ('ADMIN', 'SUPER_ADMIN')
  );

CREATE POLICY "SUPER_ADMIN full access on menu_items"
  ON public.menu_items FOR ALL
  TO authenticated
  USING (public.get_user_role() = 'SUPER_ADMIN')
  WITH CHECK (public.get_user_role() = 'SUPER_ADMIN');


-- -----------------------------------------------------------------------
-- ORDERS policies
-- -----------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own orders"         ON public.orders;
DROP POLICY IF EXISTS "Users can insert own orders"       ON public.orders;
DROP POLICY IF EXISTS "Staff/Admin can view all orders"   ON public.orders;
DROP POLICY IF EXISTS "Staff/Admin can update all orders" ON public.orders;

CREATE POLICY "Users can view own orders"
  ON public.orders FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() AND tenant_id = public.get_my_tenant_id());

CREATE POLICY "Users can insert own orders"
  ON public.orders FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() AND tenant_id = public.get_my_tenant_id());

CREATE POLICY "Staff and Admin can view tenant orders"
  ON public.orders FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.get_my_tenant_id()
    AND public.get_user_role() IN ('STAFF', 'ADMIN')
  );

CREATE POLICY "Staff and Admin can update tenant orders"
  ON public.orders FOR UPDATE
  TO authenticated
  USING (
    tenant_id = public.get_my_tenant_id()
    AND public.get_user_role() IN ('STAFF', 'ADMIN')
  )
  WITH CHECK (tenant_id = public.get_my_tenant_id());

CREATE POLICY "SUPER_ADMIN full access on orders"
  ON public.orders FOR ALL
  TO authenticated
  USING (public.get_user_role() = 'SUPER_ADMIN')
  WITH CHECK (public.get_user_role() = 'SUPER_ADMIN');


-- -----------------------------------------------------------------------
-- ORDER_ITEMS policies
-- -----------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own order items"       ON public.order_items;
DROP POLICY IF EXISTS "Users can insert own order items"     ON public.order_items;
DROP POLICY IF EXISTS "Staff/Admin can view all order items" ON public.order_items;

CREATE POLICY "Users can view own order items"
  ON public.order_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders
      WHERE id = order_items.order_id
        AND user_id = auth.uid()
        AND tenant_id = public.get_my_tenant_id()
    )
  );

CREATE POLICY "Users can insert own order items"
  ON public.order_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.orders
      WHERE id = order_items.order_id
        AND user_id = auth.uid()
        AND tenant_id = public.get_my_tenant_id()
    )
  );

CREATE POLICY "Staff and Admin can view tenant order items"
  ON public.order_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders
      WHERE id = order_items.order_id
        AND tenant_id = public.get_my_tenant_id()
        AND public.get_user_role() IN ('STAFF', 'ADMIN')
    )
  );


-- -----------------------------------------------------------------------
-- ITEM_REVIEWS policies
-- -----------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view their own reviews"                    ON public.item_reviews;
DROP POLICY IF EXISTS "Admins can view all reviews"                         ON public.item_reviews;
DROP POLICY IF EXISTS "Users can insert reviews for their collected orders" ON public.item_reviews;
DROP POLICY IF EXISTS "Users can update their own reviews"                  ON public.item_reviews;
DROP POLICY IF EXISTS "Admins can update reviews"                           ON public.item_reviews;
DROP POLICY IF EXISTS "Users can delete their own reviews"                  ON public.item_reviews;
DROP POLICY IF EXISTS "Admins can delete reviews"                           ON public.item_reviews;

CREATE POLICY "Users can view own reviews"
  ON public.item_reviews FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() AND tenant_id = public.get_my_tenant_id());

CREATE POLICY "Admin can view tenant reviews"
  ON public.item_reviews FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.get_my_tenant_id()
    AND public.get_user_role() IN ('ADMIN', 'SUPER_ADMIN')
  );

CREATE POLICY "Users can insert reviews for collected orders"
  ON public.item_reviews FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND tenant_id = public.get_my_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.orders
      WHERE id = item_reviews.order_id
        AND user_id = auth.uid()
        AND status = 'COLLECTED'
        AND tenant_id = public.get_my_tenant_id()
    )
  );

-- Users cannot self-update reviews (admin-only reply via RPC, per 0008 hardening)
CREATE POLICY "Admin can update tenant reviews"
  ON public.item_reviews FOR UPDATE
  TO authenticated
  USING (
    tenant_id = public.get_my_tenant_id()
    AND public.get_user_role() IN ('ADMIN', 'SUPER_ADMIN')
  )
  WITH CHECK (tenant_id = public.get_my_tenant_id());

CREATE POLICY "Users can delete own reviews"
  ON public.item_reviews FOR DELETE
  TO authenticated
  USING (user_id = auth.uid() AND tenant_id = public.get_my_tenant_id());

CREATE POLICY "Admin can delete tenant reviews"
  ON public.item_reviews FOR DELETE
  TO authenticated
  USING (
    tenant_id = public.get_my_tenant_id()
    AND public.get_user_role() IN ('ADMIN', 'SUPER_ADMIN')
  );


-- -----------------------------------------------------------------------
-- PAYMENTS policies
-- -----------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own payments"       ON public.payments;
DROP POLICY IF EXISTS "Users can update own payments"     ON public.payments;
DROP POLICY IF EXISTS "Users can insert own payments"     ON public.payments;
DROP POLICY IF EXISTS "Staff/Admin can view all payments" ON public.payments;

CREATE POLICY "Users can view own payments"
  ON public.payments FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() AND tenant_id = public.get_my_tenant_id());

CREATE POLICY "Users can insert own payments"
  ON public.payments FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() AND tenant_id = public.get_my_tenant_id());

CREATE POLICY "Users can update own payments"
  ON public.payments FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() AND tenant_id = public.get_my_tenant_id())
  WITH CHECK (tenant_id = public.get_my_tenant_id());

CREATE POLICY "Admin can view tenant payments"
  ON public.payments FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.get_my_tenant_id()
    AND public.get_user_role() IN ('STAFF', 'ADMIN')
  );

CREATE POLICY "SUPER_ADMIN full access on payments"
  ON public.payments FOR ALL
  TO authenticated
  USING (public.get_user_role() = 'SUPER_ADMIN')
  WITH CHECK (public.get_user_role() = 'SUPER_ADMIN');
