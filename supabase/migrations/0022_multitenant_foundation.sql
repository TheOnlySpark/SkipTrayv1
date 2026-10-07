-- ============================================================================
-- MIGRATION 0022: Multitenant Foundation
-- Adds tenants table, tenant_settings, tenant_id to all data tables,
-- seeds a default tenant and backfills all existing rows.
-- ============================================================================

-- 1. Extend user_role enum with SUPER_ADMIN
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';

-- 2. Create tenants table
CREATE TABLE public.tenants (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  slug        text NOT NULL UNIQUE,     -- e.g. "acme" → acme.skiptray.com
  name        text NOT NULL,            -- e.g. "Acme Corp Cafeteria"
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz DEFAULT now() NOT NULL
);

-- Slug must be lowercase alphanumeric + hyphens, 3–40 chars
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_slug_format
  CHECK (slug ~ '^[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]$');

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- 3. Create tenant_settings table (per-tenant branding & config)
CREATE TABLE public.tenant_settings (
  tenant_id     uuid REFERENCES public.tenants(id) ON DELETE CASCADE PRIMARY KEY,
  display_name  text,                   -- overrides tenants.name for display
  logo_url      text,                   -- URL of the tenant logo
  primary_color text DEFAULT '#4f46e5', -- brand color (hex)
  timezone      text DEFAULT 'Asia/Kolkata',
  updated_at    timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.tenant_settings ENABLE ROW LEVEL SECURITY;

-- 4. Add tenant_id FK to all data tables (nullable first, for safe backfill)
ALTER TABLE public.profiles     ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);
ALTER TABLE public.menu_items   ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);
ALTER TABLE public.orders       ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);
ALTER TABLE public.item_reviews ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);
ALTER TABLE public.payments     ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);

-- 5. Seed the "default" tenant (for all pre-existing data)
INSERT INTO public.tenants (id, slug, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'default', 'Default Organization')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tenant_settings (tenant_id, display_name)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Organization')
ON CONFLICT (tenant_id) DO NOTHING;

-- 6. Backfill all existing rows with the default tenant_id
UPDATE public.profiles     SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE public.menu_items   SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE public.orders       SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE public.item_reviews SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE public.payments     SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;

-- 7. Enforce NOT NULL after backfill
ALTER TABLE public.profiles     ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.menu_items   ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.orders       ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.item_reviews ALTER COLUMN tenant_id SET NOT NULL;
-- payments left nullable (historical rows may be partial)

-- 8. Performance indexes on tenant_id
CREATE INDEX IF NOT EXISTS idx_profiles_tenant     ON public.profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_tenant   ON public.menu_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_orders_tenant       ON public.orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_item_reviews_tenant ON public.item_reviews(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payments_tenant     ON public.payments(tenant_id);

-- 9. Allow anon to read tenants (needed for slug → tenant_id resolution before login)
GRANT SELECT ON public.tenants TO anon, authenticated;
GRANT SELECT ON public.tenant_settings TO authenticated;
