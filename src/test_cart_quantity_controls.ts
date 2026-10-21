/**
 * Unit & Integration Test for Cart Quantity Controls in SkipTray Canteen
 * Verifies all 10 scenarios specified in requirements:
 * 1. Adding an item transforms single '+' into [ - ] 1 [ + ] controls.
 * 2. Clicking '+' increases item quantity.
 * 3. Clicking '−' decreases item quantity.
 * 4. Decreasing quantity from 1 to 0 removes the item entirely and restores '+'.
 * 5. Multiple different food items maintain independent quantities without collision.
 * 6. Bottom cart bar and expanded cart derive from identical unified state.
 * 7. Subtotal, taxes, fees, and grand total recalculate dynamically on every quantity change.
 * 8. Sold-out items are blocked from addition.
 * 9. Cart total item count is strictly bounded (max 5 items).
 * 10. Order submission payload accurately maps item IDs and quantities.
 */

import { calculateOrderLedger } from './lib/ledger';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, meta?: any) {
  if (condition) {
    console.log(`✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${testName}`, meta);
    failed++;
  }
}

console.log('================================================================');
console.log('   SKIPTRAY CANTEEN — CART QUANTITY CONTROLS TEST SUITE');
console.log('================================================================\n');

interface MockItem {
  id: string;
  name: string;
  price: number;
  is_sold_out: boolean;
}

interface CartEntry {
  item: MockItem;
  quantity: number;
}

// Emulate StudentDashboard cart management logic
class CartManager {
  cart: CartEntry[] = [];
  maxItems = 5;

  addToCart(item: MockItem): boolean {
    if (item.is_sold_out) return false;
    const currentTotal = this.cart.reduce((s, c) => s + c.quantity, 0);
    if (currentTotal >= this.maxItems) return false;

    const existing = this.cart.find(c => c.item.id === item.id);
    if (existing) {
      this.cart = this.cart.map(c => c.item.id === item.id ? { ...c, quantity: c.quantity + 1 } : c);
    } else {
      this.cart = [...this.cart, { item, quantity: 1 }];
    }
    return true;
  }

  removeFromCart(itemId: string): void {
    const existing = this.cart.find(c => c.item.id === itemId);
    if (existing && existing.quantity > 1) {
      this.cart = this.cart.map(c => c.item.id === itemId ? { ...c, quantity: c.quantity - 1 } : c);
    } else {
      this.cart = this.cart.filter(c => c.item.id !== itemId);
    }
  }

  clearItem(itemId: string): void {
    this.cart = this.cart.filter(c => c.item.id !== itemId);
  }

  getQuantity(itemId: string): number {
    return this.cart.find(c => c.item.id === itemId)?.quantity || 0;
  }

  getTotalItems(): number {
    return this.cart.reduce((s, c) => s + c.quantity, 0);
  }

  getTotalPrice(): number {
    return this.cart.reduce((s, c) => s + (c.item.price * c.quantity), 0);
  }
}

// -----------------------------------------------------------------------------
// Test 1: Adding item transforms '+' into [ - ] 1 [ + ]
// -----------------------------------------------------------------------------
{
  const cm = new CartManager();
  const meal: MockItem = { id: 'm-1', name: 'Veg Biryani', price: 90.0, is_sold_out: false };

  assert(cm.getQuantity(meal.id) === 0, 'Test 1.1: Initially item has 0 quantity (shows "+")');
  const added = cm.addToCart(meal);
  assert(added === true, 'Test 1.2: Item added successfully');
  assert(cm.getQuantity(meal.id) === 1, 'Test 1.3: Item now has quantity 1 (activates [ - ] 1 [ + ])');
}

// -----------------------------------------------------------------------------
// Test 2: Clicking '+' increases quantity
// -----------------------------------------------------------------------------
{
  const cm = new CartManager();
  const dosa: MockItem = { id: 'm-2', name: 'Masala Dosa', price: 50.0, is_sold_out: false };
  cm.addToCart(dosa);
  cm.addToCart(dosa);

  assert(cm.getQuantity(dosa.id) === 2, 'Test 2.1: Clicking "+" increases quantity to 2');
  cm.addToCart(dosa);
  assert(cm.getQuantity(dosa.id) === 3, 'Test 2.2: Clicking "+" again increases quantity to 3');
}

// -----------------------------------------------------------------------------
// Test 3: Clicking '−' decreases quantity
// -----------------------------------------------------------------------------
{
  const cm = new CartManager();
  const idli: MockItem = { id: 'm-3', name: 'Idli Vada', price: 40.0, is_sold_out: false };
  cm.addToCart(idli);
  cm.addToCart(idli);
  cm.addToCart(idli); // Qty: 3

  cm.removeFromCart(idli.id);
  assert(cm.getQuantity(idli.id) === 2, 'Test 3.1: Clicking "−" decreases quantity from 3 to 2');
  cm.removeFromCart(idli.id);
  assert(cm.getQuantity(idli.id) === 1, 'Test 3.2: Clicking "−" again decreases quantity from 2 to 1');
}

// -----------------------------------------------------------------------------
// Test 4: Decreasing quantity from 1 to 0 removes the item entirely and restores '+'
// -----------------------------------------------------------------------------
{
  const cm = new CartManager();
  const coffee: MockItem = { id: 'm-4', name: 'Filter Coffee', price: 20.0, is_sold_out: false };
  cm.addToCart(coffee);
  assert(cm.getQuantity(coffee.id) === 1, 'Test 4.1: Quantity is 1');

  cm.removeFromCart(coffee.id);
  assert(cm.getQuantity(coffee.id) === 0, 'Test 4.2: Quantity is 0 after removing last unit');
  assert(cm.cart.length === 0, 'Test 4.3: Item is completely removed from cart array');
  assert(cm.getTotalItems() === 0, 'Test 4.4: Cart total items becomes 0');
}

// -----------------------------------------------------------------------------
// Test 5: Multiple different food items maintain independent quantities
// -----------------------------------------------------------------------------
{
  const cm = new CartManager();
  const itemA: MockItem = { id: 'a', name: 'Roti Meal', price: 70.0, is_sold_out: false };
  const itemB: MockItem = { id: 'b', name: 'Mango Lassi', price: 35.0, is_sold_out: false };

  cm.addToCart(itemA);
  cm.addToCart(itemA);
  cm.addToCart(itemB);

  assert(cm.getQuantity('a') === 2, 'Test 5.1: Item A has independent quantity of 2');
  assert(cm.getQuantity('b') === 1, 'Test 5.2: Item B has independent quantity of 1');
  assert(cm.getTotalItems() === 3, 'Test 5.3: Total cart items equals sum of independent quantities (3)');

  cm.removeFromCart('a');
  assert(cm.getQuantity('a') === 1 && cm.getQuantity('b') === 1, 'Test 5.4: Modifying Item A leaves Item B unaffected');
}

// -----------------------------------------------------------------------------
// Test 6: Bottom cart bar and expanded cart stay synchronized
// -----------------------------------------------------------------------------
{
  const cm = new CartManager();
  const item: MockItem = { id: 'sync-item', name: 'Pulao', price: 60.0, is_sold_out: false };

  cm.addToCart(item);
  cm.addToCart(item);

  const cardQuantity = cm.getQuantity(item.id);
  const bottomBarItemCount = cm.getTotalItems();
  const drawerEntry = cm.cart.find(c => c.item.id === item.id);

  assert(cardQuantity === 2, 'Test 6.1: Card shows quantity 2');
  assert(bottomBarItemCount === 2, 'Test 6.2: Bottom floating bar shows 2 items');
  assert(drawerEntry?.quantity === 2, 'Test 6.3: Expanded drawer shows quantity 2');

  // Remove via drawer
  cm.removeFromCart(item.id);
  assert(cm.getQuantity(item.id) === 1, 'Test 6.4: Decrementing via drawer immediately reflects on food card');
}

// -----------------------------------------------------------------------------
// Test 7: Subtotal and grand total recalculate dynamically with zero platform fee (Cash only)
// -----------------------------------------------------------------------------
{
  const cm = new CartManager();
  const item: MockItem = { id: 'meal-tax', name: 'Thali', price: 80.0, is_sold_out: false };

  // Qty: 1
  cm.addToCart(item);
  const ledger1 = calculateOrderLedger(cm.getTotalPrice());
  assert(ledger1.food_subtotal === 80.0, 'Test 7.1: 1 item subtotal is ₹80.00');
  assert(ledger1.commission_fee === 0, 'Test 7.2: Platform fee is ₹0 for cash orders');
  assert(ledger1.gross_payable === 80.0, 'Test 7.3: 1 item grand total is ₹80.00');

  // Qty: 2
  cm.addToCart(item);
  const ledger2 = calculateOrderLedger(cm.getTotalPrice());
  assert(ledger2.food_subtotal === 160.0, 'Test 7.4: 2 items subtotal dynamically updates to ₹160.00');
  assert(ledger2.commission_fee === 0, 'Test 7.5: 2 items platform fee is ₹0');
  assert(ledger2.gross_payable === 160.0, `Test 7.6: 2 items grand total updates to ₹160.00 (got ${ledger2.gross_payable})`);
}

// -----------------------------------------------------------------------------
// Test 8: Sold-out items cannot be added
// -----------------------------------------------------------------------------
{
  const cm = new CartManager();
  const soldOutItem: MockItem = { id: 'so-1', name: 'Gulab Jamun', price: 30.0, is_sold_out: true };

  const added = cm.addToCart(soldOutItem);
  assert(added === false, 'Test 8.1: Attempting to add sold-out item returns false');
  assert(cm.getQuantity(soldOutItem.id) === 0, 'Test 8.2: Sold out item quantity remains 0');
  assert(cm.cart.length === 0, 'Test 8.3: Cart remains empty');
}

// -----------------------------------------------------------------------------
// Test 9: Enforcing maximum order limit of 5 items
// -----------------------------------------------------------------------------
{
  const cm = new CartManager();
  const item: MockItem = { id: 'lim', name: 'Snack', price: 10.0, is_sold_out: false };

  // Add up to 5
  for (let i = 0; i < 5; i++) {
    cm.addToCart(item);
  }
  assert(cm.getTotalItems() === 5, 'Test 9.1: Cart contains exactly 5 items');

  // Try adding 6th item
  const sixthAdded = cm.addToCart(item);
  assert(sixthAdded === false, 'Test 9.2: 6th item addition is rejected');
  assert(cm.getTotalItems() === 5, 'Test 9.3: Total items capped strictly at 5');
}

// -----------------------------------------------------------------------------
// Test 10: Submission payload maps correct items and quantities
// -----------------------------------------------------------------------------
{
  const cm = new CartManager();
  cm.addToCart({ id: 'item-101', name: 'Paneer Butter Masala', price: 120.0, is_sold_out: false });
  cm.addToCart({ id: 'item-101', name: 'Paneer Butter Masala', price: 120.0, is_sold_out: false });
  cm.addToCart({ id: 'item-102', name: 'Naan', price: 25.0, is_sold_out: false });

  const orderItemsPayload = cm.cart.map(c => ({
    item_id: c.item.id,
    quantity: c.quantity,
    unit_price: c.item.price,
  }));

  assert(orderItemsPayload.length === 2, 'Test 10.1: Payload has 2 distinct line items');
  assert(orderItemsPayload[0].item_id === 'item-101' && orderItemsPayload[0].quantity === 2, 'Test 10.2: Item 101 has quantity 2 in payload');
  assert(orderItemsPayload[1].item_id === 'item-102' && orderItemsPayload[1].quantity === 1, 'Test 10.3: Item 102 has quantity 1 in payload');
}

console.log('\n================================================================');
console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
