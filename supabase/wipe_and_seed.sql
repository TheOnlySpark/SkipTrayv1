-- ============================================================================
-- SCRIPT: System Initialization & Safe Seed (Sanitized — No Hardcoded Accounts)
-- ============================================================================
-- SECURITY NOTICE:
-- Hardcoded administrator accounts, passwords, and destructive table wipes
-- have been permanently removed from this script (remediation of MEDIUM-02).
--
-- To provision a Super Admin account securely:
-- Run the server-side provisioning CLI:
--   npm run provision:super-admin -- --email admin@yourdomain.com
--
-- This script only ensures the non-sensitive System Tenant exists for initial setup.
-- ============================================================================

-- 1. Ensure schema columns exist and reload PostgREST schema cache
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS prep_time_minutes INTEGER DEFAULT 10;
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Meals';
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS gst_rate_percent NUMERIC(5,2) DEFAULT NULL;
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS hsn_code TEXT DEFAULT '996331';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS requested_pickup_time TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS estimated_prep_duration_minutes INTEGER DEFAULT 12;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS planned_prep_start_time TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS target_ready_by_time TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS preparation_started_at TIMESTAMPTZ;
ALTER TABLE public.lunch_slot_configs ADD COLUMN IF NOT EXISTS max_concurrent_orders INTEGER DEFAULT 15;
ALTER TABLE public.lunch_slot_configs ADD COLUMN IF NOT EXISTS default_prep_time_minutes INTEGER DEFAULT 10;
ALTER TABLE public.lunch_slot_configs ADD COLUMN IF NOT EXISTS order_cutoff_minutes INTEGER DEFAULT 15;
ALTER TABLE public.lunch_slot_configs ADD COLUMN IF NOT EXISTS slot_mode TEXT DEFAULT 'FIXED';
ALTER TABLE public.lunch_slot_configs ADD COLUMN IF NOT EXISTS custom_slots JSONB DEFAULT '[]'::jsonb;
NOTIFY pgrst, 'reload schema';

-- 2. Ensure the System Tenant exists (Required for Super Admins)
INSERT INTO public.tenants (id, slug, name, is_active)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'system',
    'System Administration',
    true
)
ON CONFLICT (id) DO UPDATE
SET name = 'System Administration', is_active = true;

-- 2. Ensure System Tenant Settings exist
INSERT INTO public.tenant_settings (tenant_id, display_name)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'System Administration'
)
ON CONFLICT (tenant_id) DO UPDATE
SET display_name = 'System Administration';

-- End of safe seed script.
-- DO NOT insert user credentials, passwords, or authentication secrets into SQL files.
