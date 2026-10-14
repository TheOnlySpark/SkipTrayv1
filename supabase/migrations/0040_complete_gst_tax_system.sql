-- Migration 0040: Complete GST Calculation, CGST/SGST/IGST Breakdown, and Tax Persistence
-- Supports Canteen Food Tax (5%), Packaged Goods (12%/18%), Exemption (0%),
-- Inclusive/Exclusive Pricing, and Service Fee GST (18%).

-- 1. Create canteen_tax_configs table
CREATE TABLE IF NOT EXISTS public.canteen_tax_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canteen_id UUID REFERENCES public.canteens(id) ON DELETE CASCADE UNIQUE,
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    gstin TEXT,
    legal_business_name TEXT,
    state_code TEXT NOT NULL DEFAULT '33', -- 33 = Tamil Nadu
    state_name TEXT NOT NULL DEFAULT 'Tamil Nadu',
    price_mode TEXT NOT NULL DEFAULT 'TAX_INCLUSIVE', -- 'TAX_INCLUSIVE' or 'TAX_EXCLUSIVE'
    default_food_gst_rate NUMERIC(5,2) NOT NULL DEFAULT 5.00,
    service_fee_gst_rate NUMERIC(5,2) NOT NULL DEFAULT 18.00,
    is_gst_registered BOOLEAN NOT NULL DEFAULT true,
    is_composition_scheme BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.canteen_tax_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view canteen tax config" ON public.canteen_tax_configs
    FOR SELECT USING (true);

CREATE POLICY "Admins can manage canteen tax config" ON public.canteen_tax_configs
    FOR ALL USING (
        public.get_user_role() IN ('SUPER_ADMIN', 'UNI_ADMIN', 'CANTEEN_ADMIN')
    );

-- 2. Add tax rate and HSN code to menu_items if not exists
ALTER TABLE public.menu_items
    ADD COLUMN IF NOT EXISTS gst_rate_percent NUMERIC(5,2) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS hsn_code TEXT DEFAULT '996331'; -- SAC 996331 for Canteen & Restaurant Services

-- 3. Add tax columns and snapshot to order_ledger
ALTER TABLE public.order_ledger
    ADD COLUMN IF NOT EXISTS tax_mode TEXT DEFAULT 'TAX_INCLUSIVE',
    ADD COLUMN IF NOT EXISTS supply_type TEXT DEFAULT 'INTRA_STATE',
    ADD COLUMN IF NOT EXISTS taxable_food_amount NUMERIC(10,2) DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS food_gst_rate NUMERIC(5,2) DEFAULT 5.00,
    ADD COLUMN IF NOT EXISTS food_gst_amount NUMERIC(10,2) DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS cgst_rate NUMERIC(5,2) DEFAULT 2.50,
    ADD COLUMN IF NOT EXISTS cgst_amount NUMERIC(10,2) DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS sgst_rate NUMERIC(5,2) DEFAULT 2.50,
    ADD COLUMN IF NOT EXISTS sgst_amount NUMERIC(10,2) DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS igst_rate NUMERIC(5,2) DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS igst_amount NUMERIC(10,2) DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS fee_gst_amount NUMERIC(10,2) DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS total_tax_amount NUMERIC(10,2) DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS tax_snapshot JSONB DEFAULT '{}'::jsonb;

-- 4. Add tax snapshot to orders table for persistent customer bill reproduction
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS total_tax_amount NUMERIC(10,2) DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS tax_snapshot JSONB DEFAULT '{}'::jsonb;
