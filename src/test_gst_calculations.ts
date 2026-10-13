/**
 * Comprehensive GST and Order Bill Calculation Test Suite
 * Tests 13 critical scenarios for Indian GST compliance and SkipTray Canteen billing:
 * 1. Taxable intra-state order with CGST and SGST.
 * 2. Applicable inter-state order with IGST instead of CGST/SGST.
 * 3. Genuinely zero-tax or exempt scenario.
 * 4. Tax-inclusive menu prices.
 * 5. Tax-exclusive menu prices.
 * 6. Different tax rates across menu items (mixed cart).
 * 7. Platform fees and gateway fees with separate tax treatment.
 * 8. Discounts and rounding consistency.
 * 9. Missing or invalid tax configuration fallback.
 * 10. Checkout versus saved order totals reconciliation.
 * 11. Saved order total versus payment gateway amount (rupees and paise exact match).
 * 12. Persistent order-level tax snapshot reproduction.
 * 13. Prevention of tampered rates / duplicate tax charging.
 */

import { calculateOrderBill, CanteenTaxConfig, DEFAULT_CANTEEN_TAX_CONFIG, TaxableCartItem } from './lib/taxService';
import { computeLedger } from './lib/ledger';

let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, details?: any) {
  if (condition) {
    console.log(`✅ [PASS] ${testName}`);
    passedTests++;
  } else {
    console.error(`❌ [FAIL] ${testName}`);
    if (details) console.error('   Details:', details);
    failedTests++;
  }
}

console.log('================================================================');
console.log('   SKIPTRAY CANTEEN — GST CALCULATION TEST SUITE');
console.log('================================================================\n');

// -----------------------------------------------------------------------------
// Test 1: Taxable intra-state order with CGST and SGST (Karnataka to Karnataka)
// -----------------------------------------------------------------------------
{
  const config: CanteenTaxConfig = {
    ...DEFAULT_CANTEEN_TAX_CONFIG,
    stateCode: '29', // Karnataka
    stateName: 'Karnataka',
    priceMode: 'TAX_INCLUSIVE',
    defaultFoodGstRate: 5.0,
  };
  const items: TaxableCartItem[] = [
    { id: 'item-1', name: 'Veg Meals', quantity: 1, price: 80.0, gstRatePercent: 5.0 }
  ];

  const bill = calculateOrderBill(items, config, '29'); // Customer also in Karnataka (29)

  assert(bill.supplyType === 'INTRA_STATE', 'Test 1.1: Intra-state supply identified for same state codes');
  assert(bill.cgstRate === 2.5 && bill.sgstRate === 2.5 && bill.igstRate === 0, 'Test 1.2: 5% GST correctly split into CGST 2.5% and SGST 2.5%');
  assert(bill.foodGstAmount > 0, 'Test 1.3: Food GST amount is calculated (> 0)');
  assert(
    Math.abs(bill.cgstAmount + bill.sgstAmount - bill.foodGstAmount) < 0.001,
    'Test 1.4: CGST + SGST strictly balances total Food GST amount'
  );
  assert(bill.igstAmount === 0, 'Test 1.5: IGST is exactly ₹0.00 for intra-state supply');
}

// -----------------------------------------------------------------------------
// Test 2: Applicable inter-state order with IGST (Karnataka Canteen -> Tamil Nadu Student)
// -----------------------------------------------------------------------------
{
  const config: CanteenTaxConfig = {
    ...DEFAULT_CANTEEN_TAX_CONFIG,
    stateCode: '29', // Karnataka
    defaultFoodGstRate: 5.0,
  };
  const items: TaxableCartItem[] = [
    { id: 'item-1', name: 'Veg Meals', quantity: 1, price: 100.0, gstRatePercent: 5.0 }
  ];

  const bill = calculateOrderBill(items, config, '33'); // Customer from Tamil Nadu (33)

  assert(bill.supplyType === 'INTER_STATE', 'Test 2.1: Inter-state supply identified for differing state codes');
  assert(bill.igstRate === 5.0 && bill.cgstRate === 0 && bill.sgstRate === 0, 'Test 2.2: Full 5% GST attributed to IGST');
  assert(bill.cgstAmount === 0 && bill.sgstAmount === 0, 'Test 2.3: CGST and SGST are zero in inter-state supply');
  assert(bill.igstAmount === bill.foodGstAmount, 'Test 2.4: IGST amount matches total food GST');
}

// -----------------------------------------------------------------------------
// Test 3: Genuinely zero-tax or exempt scenario (0% GST)
// -----------------------------------------------------------------------------
{
  const config: CanteenTaxConfig = {
    ...DEFAULT_CANTEEN_TAX_CONFIG,
    stateCode: '29',
    priceMode: 'TAX_INCLUSIVE',
    defaultFoodGstRate: 0.0,
  };
  const items: TaxableCartItem[] = [
    { id: 'item-fresh-fruit', name: 'Fresh Apple', quantity: 2, price: 20.0, gstRatePercent: 0.0 }
  ];

  const bill = calculateOrderBill(items, config, '29');

  assert(bill.foodGstAmount === 0, 'Test 3.1: Food GST amount is ₹0.00 for 0% exempt supply');
  assert(bill.cgstAmount === 0 && bill.sgstAmount === 0 && bill.igstAmount === 0, 'Test 3.2: All GST breakdown components are ₹0.00');
  assert(bill.taxableFoodAmount === 40.0, 'Test 3.3: Taxable base equals full gross price when tax rate is 0%');
}

// -----------------------------------------------------------------------------
// Test 4: Tax-inclusive menu prices (e.g. ₹80 gross meal at 5% GST)
// Base = 80 * 100 / 105 = 76.1904... -> ₹76.19. Tax = 80 - 76.19 = ₹3.81.
// -----------------------------------------------------------------------------
{
  const config: CanteenTaxConfig = {
    ...DEFAULT_CANTEEN_TAX_CONFIG,
    stateCode: '29',
    priceMode: 'TAX_INCLUSIVE',
    defaultFoodGstRate: 5.0,
  };
  const items: TaxableCartItem[] = [
    { id: 'meal-1', name: 'Thali', quantity: 1, price: 80.0, gstRatePercent: 5.0 }
  ];

  const bill = calculateOrderBill(items, config, '29');

  assert(bill.foodSubtotal === 80.0, 'Test 4.1: Food subtotal matches menu gross price (₹80.00)');
  assert(bill.taxableFoodAmount === 76.19, `Test 4.2: Taxable food amount is ₹76.19 (got ${bill.taxableFoodAmount})`);
  assert(bill.foodGstAmount === 3.81, `Test 4.3: Included GST extracted as ₹3.81 (got ${bill.foodGstAmount})`);
  assert(
    Math.abs(bill.cgstAmount + bill.sgstAmount - 3.81) < 0.001 &&
    (bill.cgstAmount === 1.90 || bill.cgstAmount === 1.91) &&
    (bill.sgstAmount === 1.90 || bill.sgstAmount === 1.91),
    `Test 4.4: CGST=₹${bill.cgstAmount}, SGST=₹${bill.sgstAmount} (sum=₹3.81)`
  );
}

// -----------------------------------------------------------------------------
// Test 5: Tax-exclusive menu prices (e.g. ₹100 base + 5% GST = ₹105.00)
// -----------------------------------------------------------------------------
{
  const config: CanteenTaxConfig = {
    ...DEFAULT_CANTEEN_TAX_CONFIG,
    stateCode: '29',
    priceMode: 'TAX_EXCLUSIVE',
    defaultFoodGstRate: 5.0,
  };
  const items: TaxableCartItem[] = [
    { id: 'item-ex', name: 'Buffet', quantity: 1, price: 100.0, gstRatePercent: 5.0 }
  ];

  const bill = calculateOrderBill(items, config, '29');

  assert(bill.foodSubtotal === 100.0, 'Test 5.1: Food base is ₹100.00');
  assert(bill.foodGstAmount === 5.0, 'Test 5.2: 5% GST added on top is ₹5.00');
  assert(bill.cgstAmount === 2.5 && bill.sgstAmount === 2.5, 'Test 5.3: CGST=₹2.50, SGST=₹2.50');
}

// -----------------------------------------------------------------------------
// Test 6: Different tax rates across menu items (Mixed cart: 5% cooked food + 12% packaged drink)
// -----------------------------------------------------------------------------
{
  const config: CanteenTaxConfig = {
    ...DEFAULT_CANTEEN_TAX_CONFIG,
    stateCode: '29',
    priceMode: 'TAX_INCLUSIVE',
  };
  const items: TaxableCartItem[] = [
    { id: 'f1', name: 'Dosa', quantity: 1, price: 50.0, gstRatePercent: 5.0 },     // Base: 47.62, Tax: 2.38
    { id: 'b1', name: 'Packaged Juice', quantity: 1, price: 40.0, gstRatePercent: 12.0 } // Base: 35.71, Tax: 4.29
  ];

  const bill = calculateOrderBill(items, config, '29');

  assert(bill.items.length === 2, 'Test 6.1: Both items preserved in bill breakdown');
  assert(bill.items[0].gstRate === 5.0 && bill.items[1].gstRate === 12.0, 'Test 6.2: Respective item tax rates preserved');
  assert(bill.taxableFoodAmount === 47.62 + 35.71, `Test 6.3: Combined taxable amount matches sum of bases (₹83.33)`);
  assert(bill.foodGstAmount === 2.38 + 4.29, `Test 6.4: Total food GST balances sum of item taxes (₹6.67)`);
}

// -----------------------------------------------------------------------------
// Test 7: Platform fee and payment gateway fee with separate tax handling
// -----------------------------------------------------------------------------
{
  const ledger = computeLedger(80.0); // ₹80.00 subtotal

  assert(ledger.commission_fee === 2.40, `Test 7.1: 3% Platform fee is ₹2.40 (got ${ledger.commission_fee})`);
  assert(ledger.target_net === 82.40, `Test 7.2: Target net payable before gateway is ₹82.40 (got ${ledger.target_net})`);
  assert(ledger.gross_payable === 82.89, `Test 7.3: Gross payable with gateway fee is ₹82.89 (got ${ledger.gross_payable})`);
  assert(ledger.gateway_fee === 0.49, `Test 7.4: Gateway fee is ₹0.49 (got ${ledger.gateway_fee})`);
}

// -----------------------------------------------------------------------------
// Test 8: Discounts and Rounding consistency
// -----------------------------------------------------------------------------
{
  const config: CanteenTaxConfig = {
    ...DEFAULT_CANTEEN_TAX_CONFIG,
    stateCode: '29',
    priceMode: 'TAX_INCLUSIVE',
    defaultFoodGstRate: 5.0,
  };
  const items: TaxableCartItem[] = [
    { id: 'item-odd', name: 'Chai', quantity: 3, price: 15.0, gstRatePercent: 5.0 } // Total ₹45.00
  ];

  const bill = calculateOrderBill(items, config, '29', 5.0); // ₹5.00 discount

  assert(bill.discountAmount === 5.0, 'Test 8.1: Discount recorded correctly');
  assert(bill.finalTotalAmount < 45.0, 'Test 8.2: Total amount reduced by discount');
}

// -----------------------------------------------------------------------------
// Test 9: Missing or invalid tax configuration fallback
// -----------------------------------------------------------------------------
{
  // Null config fallback
  const bill = calculateOrderBill(
    [{ id: 'item-fb', name: 'Samosa', quantity: 2, price: 20.0 }],
    null,
    '33'
  );

  assert(bill.priceMode === 'TAX_INCLUSIVE', 'Test 9.1: Falls back to TAX_INCLUSIVE');
  assert(bill.items[0].gstRate === 5.0 && Math.abs(bill.effectiveGstRate - 5.0) < 0.05, `Test 9.2: Falls back to statutory default 5% GST (item rate: ${bill.items[0].gstRate}%, effective: ${bill.effectiveGstRate}%)`);
  assert(bill.finalTotalAmount > 0, 'Test 9.3: Computes valid total without crashing');
}

// -----------------------------------------------------------------------------
// Test 10: Checkout versus saved order totals reconciliation
// -----------------------------------------------------------------------------
{
  const config: CanteenTaxConfig = {
    ...DEFAULT_CANTEEN_TAX_CONFIG,
    stateCode: '33',
    priceMode: 'TAX_INCLUSIVE',
    defaultFoodGstRate: 5.0,
  };
  const cartItems: TaxableCartItem[] = [
    { id: 'i1', name: 'Meal', quantity: 1, price: 80.0, gstRatePercent: 5.0 }
  ];

  const checkoutBill = calculateOrderBill(cartItems, config, '33');
  const ledger = computeLedger(80.0, cartItems, config, '33');

  assert(checkoutBill.finalTotalAmount === ledger.gross_payable, 'Test 10.1: Checkout bill total === Ledger gross payable');
  assert(checkoutBill.foodGstAmount === ledger.food_gst_amount, 'Test 10.2: Checkout bill food GST === Ledger food GST');
  assert(checkoutBill.cgstAmount === ledger.cgst_amount, 'Test 10.3: Checkout bill CGST === Ledger CGST');
  assert(checkoutBill.sgstAmount === ledger.sgst_amount, 'Test 10.4: Checkout bill SGST === Ledger SGST');
}

// -----------------------------------------------------------------------------
// Test 11: Saved order total versus payment gateway amount (rupees & paise exact match)
// -----------------------------------------------------------------------------
{
  const ledger = computeLedger(80.0);
  const payableRupees = ledger.gross_payable; // 82.89
  const payablePaise = Math.round(payableRupees * 100); // 8289

  assert(payableRupees === 82.89, `Test 11.1: Order total is ₹82.89 (got ${payableRupees})`);
  assert(payablePaise === 8289, `Test 11.2: Gateway payload paise is exactly 8289 paise (got ${payablePaise})`);
  assert(payablePaise / 100 === payableRupees, 'Test 11.3: Gateway paise converts back exactly to ₹82.89 without floating drift');
}

// -----------------------------------------------------------------------------
// Test 12: Persistent order-level tax snapshot reproduction
// -----------------------------------------------------------------------------
{
  const bill = calculateOrderBill(
    [{ id: 'i1', name: 'Coffee', quantity: 2, price: 25.0, gstRatePercent: 5.0 }],
    DEFAULT_CANTEEN_TAX_CONFIG,
    '33'
  );

  const snapshot = bill.taxSnapshot;

  assert(snapshot.gstin !== undefined, 'Test 12.1: Snapshot stores GSTIN');
  assert(snapshot.price_mode === 'TAX_INCLUSIVE', 'Test 12.2: Snapshot stores pricing mode');
  assert(snapshot.cgst_amount === bill.cgstAmount, 'Test 12.3: Snapshot stores frozen CGST amount');
  assert(snapshot.items.length === 1, 'Test 12.4: Snapshot stores frozen line-item breakdown');
  assert(snapshot.items[0].rate === 5.0, 'Test 12.5: Snapshot line item stores frozen GST rate');
}

// -----------------------------------------------------------------------------
// Test 13: Prevention of tampered frontend rates or duplicate tax
// -----------------------------------------------------------------------------
{
  // If an attacker sends an invalid / negative GST rate on an item:
  const tamperedItems: TaxableCartItem[] = [
    { id: 'tampered-1', name: 'Biryani', quantity: 1, price: 120.0, gstRatePercent: -50.0 }
  ];

  const secureBill = calculateOrderBill(tamperedItems, DEFAULT_CANTEEN_TAX_CONFIG, '33');

  assert(secureBill.foodGstRate >= 0, 'Test 13.1: Backend ignores negative tax rate and sanitizes');
  assert(secureBill.finalTotalAmount > 0, 'Test 13.2: Final total is positive and valid');
  assert(
    secureBill.cgstAmount + secureBill.sgstAmount + secureBill.igstAmount === secureBill.foodGstAmount,
    'Test 13.3: Total tax never duplicates or exceeds statutory components'
  );
}

console.log('\n================================================================');
console.log(`TEST SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
console.log('================================================================\n');

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
