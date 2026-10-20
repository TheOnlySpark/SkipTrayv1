-- 0043_add_stock_quantity_and_category.sql
-- Add category, prep_time_minutes, and stock_quantity to menu_items

ALTER TABLE public.menu_items
ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Meals',
ADD COLUMN IF NOT EXISTS prep_time_minutes INTEGER DEFAULT 10,
ADD COLUMN IF NOT EXISTS stock_quantity INTEGER DEFAULT NULL;
