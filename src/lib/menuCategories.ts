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
  const name = (item.name || '').toLowerCase();

  // Check explicit 'Packed Food' or 'Drinks' first
  if (
    rawCat === 'packed food' || 
    rawCat === 'packaged' || 
    rawCat === 'packed' || 
    rawCat === 'snacks' || 
    rawCat === 'snack' ||
    rawCat.includes('pack')
  ) {
    return 'Packed Food';
  }
  if (rawCat === 'drinks' || rawCat === 'drink' || rawCat === 'soft_drink' || rawCat === 'beverage') {
    return 'Drinks';
  }

  // Keyword heuristics based on item name (takes precedence over generic 'meals' column default)
  if (/\b(juice|tea|chai|coffee|drink|drinks|soda|beverage|water|lassi|shake|cooler|mojito|coke|pepsi|sprite|fanta|bovonto|maaza|frooti|sting|milk|boost|horlicks)\b/i.test(name)) {
    return 'Drinks';
  }
  if (/\b(chips|biscuit|biscuits|chocolate|cookie|cookies|snack|snacks|puffs|puff|roll|rolls|sandwich|samosa|bar|cake|packaged|lays|kurkure|bingo|oreo|maggi|bun|bread|wafer|wafers|namkeen|mixture)\b/i.test(name)) {
    return 'Packed Food';
  }

  if (rawCat === 'meals' || rawCat === 'meal' || rawCat === 'fresh_food') {
    return 'Meals';
  }

  return 'Meals';
};
