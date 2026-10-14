// Utility for food menu categorization and filtering in SkipTray Canteen

export type FoodCategory = 'Packed Food' | 'Meals' | 'Drinks';

/**
 * Standardizes and classifies a menu item into one of the 3 supported categories:
 * - 'Packed Food'
 * - 'Meals'
 * - 'Drinks'
 *
 * Checks explicit category field first, handling aliases/database variations,
 * and falls back safely to keyword heuristics on item name if category is null or empty.
 */
export const getItemCategory = (item: { category?: string | null; name: string }): FoodCategory => {
  const rawCat = (item.category || '').trim().toLowerCase();
  
  // Explicit category matches & enum aliases
  if (rawCat === 'drinks' || rawCat === 'drink' || rawCat === 'soft_drink' || rawCat === 'beverage') {
    return 'Drinks';
  }
  if (
    rawCat === 'packed food' || 
    rawCat === 'packaged' || 
    rawCat === 'packed' || 
    rawCat === 'snacks' || 
    rawCat === 'snack'
  ) {
    return 'Packed Food';
  }
  if (rawCat === 'meals' || rawCat === 'meal' || rawCat === 'fresh_food') {
    return 'Meals';
  }
  
  // Keyword heuristics fallback based on item name
  const name = (item.name || '').toLowerCase();
  if (/\b(juice|tea|chai|coffee|drink|drinks|soda|beverage|water|lassi|shake|cooler|mojito|coke|pepsi|sprite|fanta|bovonto|maaza|frooti|sting|milk|boost|horlicks)\b/i.test(name)) {
    return 'Drinks';
  }
  if (/\b(chips|biscuit|biscuits|chocolate|cookie|cookies|snack|snacks|puffs|puff|roll|rolls|sandwich|samosa|bar|cake|packaged|lays|kurkure|bingo|oreo|maggi|bun|bread)\b/i.test(name)) {
    return 'Packed Food';
  }
  
  return 'Meals';
};
