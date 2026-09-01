-- Add price column to menu_items table
ALTER TABLE public.menu_items 
ADD COLUMN IF NOT EXISTS price NUMERIC(10, 2) DEFAULT 0 NOT NULL CHECK (price >= 0);
