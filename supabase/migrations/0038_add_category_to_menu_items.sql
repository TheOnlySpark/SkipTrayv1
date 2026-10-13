-- Migration 0038: Add category column to menu_items with classification backfill

ALTER TABLE public.menu_items 
ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Meals';

-- Backfill existing items based on food name heuristics into the 3 standardized categories:
-- 'Drinks', 'Packed Food', 'Meals'

UPDATE public.menu_items
SET category = 'Drinks'
WHERE (category IS NULL OR category = 'Meals') AND (
  LOWER(name) ~* '(juice|tea|chai|coffee|drink|soda|beverage|water|lassi|shake|cooler|mojito|coke|pepsi|sprite|fanta|bovonto|maaza|frooti|sting|milk|boost|horlicks)'
);

UPDATE public.menu_items
SET category = 'Packed Food'
WHERE (category IS NULL OR category = 'Meals') AND (
  LOWER(name) ~* '(chips|biscuit|chocolate|cookie|snack|puffs|puff|roll|sandwich|samosa|bar|cake|packaged|lays|kurkure|bingo|oreo|maggi|bun|bread)'
);

UPDATE public.menu_items
SET category = 'Meals'
WHERE category IS NULL;
