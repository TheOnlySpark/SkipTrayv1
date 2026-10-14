-- ============================================================================
-- FIX: Add prep_time_minutes & Missing Columns to Database & Reload Schema Cache
-- INSTRUCTIONS: Run this directly in your Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================================

-- 1. Add preparation time and category to menu_items
ALTER TABLE public.menu_items 
ADD COLUMN IF NOT EXISTS prep_time_minutes INTEGER DEFAULT 10;

ALTER TABLE public.menu_items 
ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Meals';

ALTER TABLE public.menu_items 
ADD COLUMN IF NOT EXISTS gst_rate_percent NUMERIC(5,2) DEFAULT NULL;

ALTER TABLE public.menu_items 
ADD COLUMN IF NOT EXISTS hsn_code TEXT DEFAULT '996331';

-- 2. Add preparation and scheduling columns to orders
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS requested_pickup_time TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS estimated_prep_duration_minutes INTEGER DEFAULT 12,
ADD COLUMN IF NOT EXISTS planned_prep_start_time TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS target_ready_by_time TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS preparation_started_at TIMESTAMPTZ;

-- 3. Add kitchen capacity and scheduling configuration to lunch_slot_configs
ALTER TABLE public.lunch_slot_configs
ADD COLUMN IF NOT EXISTS max_concurrent_orders INTEGER DEFAULT 15,
ADD COLUMN IF NOT EXISTS default_prep_time_minutes INTEGER DEFAULT 10,
ADD COLUMN IF NOT EXISTS order_cutoff_minutes INTEGER DEFAULT 15;

-- 4. Reload PostgREST schema cache so Supabase immediately recognizes the new columns
NOTIFY pgrst, 'reload schema';
