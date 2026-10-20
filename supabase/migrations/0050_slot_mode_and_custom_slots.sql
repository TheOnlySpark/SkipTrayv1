-- ============================================================================
-- MIGRATION 0050: Add slot_mode and custom_slots to lunch_slot_configs
-- Enables switching between 'FIXED' interval slots and 'CUSTOM' specific slots.
-- Compares with existing 0037_configurable_lunch_slots and ensures no contradictions.
-- ============================================================================

DO $$
BEGIN
  -- Add slot_mode column ('FIXED' or 'CUSTOM')
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'lunch_slot_configs'
      AND column_name = 'slot_mode'
  ) THEN
    ALTER TABLE public.lunch_slot_configs
      ADD COLUMN slot_mode TEXT NOT NULL DEFAULT 'FIXED';
  END IF;

  -- Ensure custom_slots JSONB column exists (first defined in 0037)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'lunch_slot_configs'
      AND column_name = 'custom_slots'
  ) THEN
    ALTER TABLE public.lunch_slot_configs
      ADD COLUMN custom_slots JSONB NOT NULL DEFAULT '[]'::jsonb;
  END IF;
END $$;

-- Reload schema cache
NOTIFY pgrst, 'reload schema';
