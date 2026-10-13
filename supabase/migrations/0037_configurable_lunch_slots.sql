-- 0037_configurable_lunch_slots.sql
-- Admin-configurable lunch pickup time slots management

CREATE TABLE IF NOT EXISTS public.lunch_slot_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canteen_id UUID REFERENCES public.canteens(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  service_start_time TEXT NOT NULL DEFAULT '12:00',
  service_end_time TEXT NOT NULL DEFAULT '14:00',
  slot_duration_minutes INTEGER NOT NULL DEFAULT 15,
  min_notice_minutes INTEGER NOT NULL DEFAULT 30,
  is_lunch_enabled BOOLEAN NOT NULL DEFAULT true,
  disabled_slots JSONB NOT NULL DEFAULT '[]'::jsonb,
  slot_capacities JSONB NOT NULL DEFAULT '{}'::jsonb,
  custom_slots JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT unique_canteen_lunch_slot_config UNIQUE (canteen_id)
);

-- Enable RLS
ALTER TABLE public.lunch_slot_configs ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view lunch slot configs
DROP POLICY IF EXISTS "Anyone can view lunch slot configs" ON public.lunch_slot_configs;
CREATE POLICY "Anyone can view lunch slot configs"
  ON public.lunch_slot_configs
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow canteen staff and admins to update or insert slot configs
DROP POLICY IF EXISTS "Admins and staff can manage lunch slot configs" ON public.lunch_slot_configs;
CREATE POLICY "Admins and staff can manage lunch slot configs"
  ON public.lunch_slot_configs
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('CANTEEN_ADMIN', 'STAFF', 'UNI_ADMIN', 'SUPER_ADMIN')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('CANTEEN_ADMIN', 'STAFF', 'UNI_ADMIN', 'SUPER_ADMIN')
    )
  );

-- Function to touch updated_at
CREATE OR REPLACE FUNCTION public.handle_lunch_slot_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_lunch_slot_config_updated_at ON public.lunch_slot_configs;
CREATE TRIGGER trigger_lunch_slot_config_updated_at
  BEFORE UPDATE ON public.lunch_slot_configs
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_lunch_slot_config_updated_at();

-- Seed default configuration for existing canteens if any
INSERT INTO public.lunch_slot_configs (canteen_id, tenant_id, service_start_time, service_end_time, slot_duration_minutes, min_notice_minutes, is_lunch_enabled)
SELECT id, tenant_id, '12:00', '14:00', 15, 30, true
FROM public.canteens
ON CONFLICT (canteen_id) DO NOTHING;
