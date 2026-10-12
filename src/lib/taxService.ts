// Centralized GST Calculation and Tax Audit Service for SkipTray Canteen
// Supports Indian GST rules: Restaurant/Canteen supply (5%), Packaged/Other goods (0%, 12%, 18%),
// Intra-state (CGST + SGST) vs Inter-state (IGST), and Tax-Inclusive vs Tax-Exclusive pricing.

import { supabase } from './supabase';

export type PriceMode = 'TAX_INCLUSIVE' | 'TAX_EXCLUSIVE';
export type SupplyType = 'INTRA_STATE' | 'INTER_STATE';

export interface CanteenTaxConfig {
  id?: string;
  canteenId?: string;
  tenantId?: string;
  gstin?: string | null;
  legalBusinessName?: string | null;
  stateCode: string; // e.g. '33' for Tamil Nadu
  stateName: string; // e.g. 'Tamil Nadu'
  priceMode: PriceMode; // 'TAX_INCLUSIVE' (default) or 'TAX_EXCLUSIVE'
  defaultFoodGstRate: number; // default 5.00 (%)
  serviceFeeGstRate: number; // default 18.00 (%)
  isGstRegistered: boolean;
  isCompositionScheme: boolean;
}

export const DEFAULT_CANTEEN_TAX_CONFIG: CanteenTaxConfig = {
  stateCode: '33', // Tamil Nadu default
  stateName: 'Tamil Nadu',
  priceMode: 'TAX_INCLUSIVE', // Canteens show all-inclusive prices on menu
  defaultFoodGstRate: 5.00, // Notification 11/2017-CT(R) for food & beverages in canteen
  serviceFeeGstRate: 18.00, // SAC 9985 for platform / technology service fee
  isGstRegistered: true,
  isCompositionScheme: false,
};

export interface TaxableCartItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
  gstRatePercent?: number | null; // Item-level override (e.g. 0%, 5%, 12%, 18%)
  hsnCode?: string | null;
}

export interface ItemTaxDetail {
  itemId: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
  totalGross: number;
  taxableAmount: number;
  gstRate: number;
  taxAmount: number;
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  igstRate: number;
  igstAmount: number;
  hsnCode: string;
}

export interface BillBreakdown {
  priceMode: PriceMode;
  supplyType: SupplyType;
  canteenStateCode: string;
  customerStateCode: string;
  isGstRegistered: boolean;
  
  // Food Components
  foodSubtotal: number; // What customer sees as Food Subtotal
  taxableFoodAmount: number; // Base on which GST is levied
  foodGstAmount: number; // Total GST on food
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  igstRate: number;
  igstAmount: number;
  effectiveGstRate: number; // Weighted average rate if mixed
  foodGstRate?: number; // Convenient alias for effectiveGstRate

  // Platform & Gateway Fees
  commissionFee: number; // 3% platform fee
  gatewayFee: number; // Payment gateway pass-through fee
  targetNet: number; // Amount needed before gateway deduction
  grossPayable: number; // Exact total amount charged to customer
  finalTotalAmount: number; // Final payable amount (alias for grossPayable)
  discountAmount: number; // Any applied discount
  
  // Grand Totals & Accounting
  totalTaxAmount: number; // Total taxes included/levied
  canteenPayable: number; // Canteen revenue
  platformNet: number; // Platform profit after gateway
  
  // Line-Item Details & Snapshot
  items: ItemTaxDetail[];
  taxSnapshot: Record<string, any>;
}

/**
 * 2-decimal banker's rounding to eliminate IEEE floating point discrepancies.
 */
export const round2 = (val: number): number => {
  return Number((Math.round(val * 100) / 100).toFixed(2));
};

/**
 * Determines whether a transaction is Intra-State or Inter-State.
 * Intra-State (Same State Code) -> CGST + SGST
 * Inter-State (Different State Code) -> IGST
 */
export function determineSupplyType(
  canteenStateCode: string = '33',
  customerStateCode: string = '33'
): SupplyType {
  const canteenClean = (canteenStateCode || '33').trim();
  const customerClean = (customerStateCode || '33').trim();
  return canteenClean === customerClean ? 'INTRA_STATE' : 'INTER_STATE';
}

/**
 * Centralized, authoritative calculation of Order Taxes, Fees, and Final Bill.
 */
export function calculateOrderBill(
  items: TaxableCartItem[],
  taxConfig: CanteenTaxConfig | null = DEFAULT_CANTEEN_TAX_CONFIG,
  customerStateCode: string = '33',
  discount: number = 0
): BillBreakdown {
  const config = taxConfig || DEFAULT_CANTEEN_TAX_CONFIG;
  const priceMode: PriceMode = config.priceMode || 'TAX_INCLUSIVE';
  const supplyType = determineSupplyType(config.stateCode, customerStateCode);
  const defaultRate = Math.max(0, Number(config.defaultFoodGstRate ?? 5.00));
  const discountAmount = round2(Math.max(0, Number(discount) || 0));

  let totalFoodBase = 0;
  let totalTaxableFood = 0;
  let totalFoodTax = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;

  const itemDetails: ItemTaxDetail[] = [];

  for (const item of items) {
    const qty = Math.max(1, Number(item.quantity) || 1);
    const unitPrice = round2(Number(item.price) || 0);
    const lineTotal = round2(unitPrice * qty);

    if (lineTotal <= 0) continue;

    // Use item-specific rate if present, else fallback to canteen default
    const rawRate = item.gstRatePercent !== undefined && item.gstRatePercent !== null
      ? Number(item.gstRatePercent)
      : defaultRate;
    const itemRate = Math.max(0, isNaN(rawRate) ? defaultRate : rawRate);

    let taxableAmount = 0;
    let taxAmount = 0;
    let cgstRate = 0;
    let sgstRate = 0;
    let igstRate = 0;
    let cgstAmount = 0;
    let sgstAmount = 0;
    let igstAmount = 0;

    if (supplyType === 'INTRA_STATE') {
      cgstRate = round2(itemRate / 2);
      sgstRate = round2(itemRate / 2);
    } else {
      igstRate = round2(itemRate);
    }

    if (priceMode === 'TAX_INCLUSIVE') {
      // Formula: Taxable Base = Total Inclusive Price * 100 / (100 + Rate)
      if (itemRate > 0) {
        taxableAmount = round2((lineTotal * 100) / (100 + itemRate));
        taxAmount = round2(lineTotal - taxableAmount);
        
        if (supplyType === 'INTRA_STATE') {
          cgstAmount = round2(taxAmount / 2);
          sgstAmount = round2(taxAmount - cgstAmount); // Avoid 1-paisa rounding mismatch
        } else {
          igstAmount = taxAmount;
        }
      } else {
        // Zero-rated / exempt
        taxableAmount = lineTotal;
        taxAmount = 0;
      }
      totalFoodBase += lineTotal;
    } else {
      // TAX_EXCLUSIVE
      taxableAmount = lineTotal;
      if (itemRate > 0) {
        if (supplyType === 'INTRA_STATE') {
          cgstAmount = round2(taxableAmount * (cgstRate / 100));
          sgstAmount = round2(taxableAmount * (sgstRate / 100));
          taxAmount = round2(cgstAmount + sgstAmount);
        } else {
          igstAmount = round2(taxableAmount * (igstRate / 100));
          taxAmount = igstAmount;
        }
      }
      totalFoodBase += lineTotal;
    }

    totalTaxableFood += taxableAmount;
    totalFoodTax += taxAmount;
    totalCgst += cgstAmount;
    totalSgst += sgstAmount;
    totalIgst += igstAmount;

    itemDetails.push({
      itemId: item.id,
      itemName: item.name,
      quantity: qty,
      unitPrice,
      totalGross: priceMode === 'TAX_INCLUSIVE' ? lineTotal : round2(lineTotal + taxAmount),
      taxableAmount,
      gstRate: itemRate,
      taxAmount,
      cgstRate,
      cgstAmount,
      sgstRate,
      sgstAmount,
      igstRate,
      igstAmount,
      hsnCode: item.hsnCode || '996331',
    });
  }

  totalFoodBase = round2(totalFoodBase);
  totalTaxableFood = round2(totalTaxableFood);
  totalFoodTax = round2(totalFoodTax);
  totalCgst = round2(totalCgst);
  totalSgst = round2(totalSgst);
  totalIgst = round2(totalIgst);

  // In Tax-Inclusive: foodSubtotal is the retail amount (taxes included).
  // In Tax-Exclusive: foodSubtotal is the net base amount, and total food charge is foodSubtotal + totalFoodTax.
  const displayedFoodSubtotal = totalFoodBase;
  const foodTotalWithTax = priceMode === 'TAX_INCLUSIVE'
    ? totalFoodBase
    : round2(totalFoodBase + totalFoodTax);

  // Platform & Gateway Fees Calculation
  // 1. Platform Fee (3% of food total with tax)
  const commissionFee = round2(foodTotalWithTax * 0.03);
  // 2. Target Net (Food + Platform Fee - Discount)
  const targetNet = Math.max(0, round2(foodTotalWithTax + commissionFee - discountAmount));
  // 3. Gross Payable (Reverse engineered for 0.59% ZohoPay deduction)
  const grossPayable = targetNet > 0 ? round2(targetNet / 0.9941) : 0;
  // 4. Gateway Fee
  const gatewayFee = round2(grossPayable - targetNet);
  // 5. Gateway Deduction (0.59%)
  const gwDeduction = round2(grossPayable * 0.0059);
  const netSettled = round2(grossPayable - gwDeduction);
  const canteenPayable = foodTotalWithTax;
  const platformNet = round2(netSettled - canteenPayable);

  const effectiveGstRate = totalTaxableFood > 0
    ? round2((totalFoodTax / totalTaxableFood) * 100)
    : defaultRate;

  const taxSnapshot = {
    version: '1.0',
    calculated_at: new Date().toISOString(),
    gstin: config.gstin || null,
    legal_name: config.legalBusinessName || null,
    price_mode: priceMode,
    supply_type: supplyType,
    canteen_state: config.stateCode,
    customer_state: customerStateCode,
    is_gst_registered: config.isGstRegistered,
    food_subtotal: displayedFoodSubtotal,
    taxable_food_amount: totalTaxableFood,
    food_gst_amount: totalFoodTax,
    effective_food_gst_rate: effectiveGstRate,
    cgst_rate: supplyType === 'INTRA_STATE' ? round2(effectiveGstRate / 2) : 0,
    cgst_amount: totalCgst,
    sgst_rate: supplyType === 'INTRA_STATE' ? round2(effectiveGstRate / 2) : 0,
    sgst_amount: totalSgst,
    igst_rate: supplyType === 'INTER_STATE' ? effectiveGstRate : 0,
    igst_amount: totalIgst,
    commission_fee: commissionFee,
    gateway_fee: gatewayFee,
    discount_amount: discountAmount,
    gross_payable: grossPayable,
    items: itemDetails.map(i => ({
      item_id: i.itemId,
      name: i.itemName,
      qty: i.quantity,
      price: i.unitPrice,
      taxable: i.taxableAmount,
      tax: i.taxAmount,
      rate: i.gstRate,
      hsn_code: i.hsnCode
    })),
    items_summary: itemDetails.map(i => ({
      name: i.itemName,
      qty: i.quantity,
      price: i.unitPrice,
      taxable: i.taxableAmount,
      tax: i.taxAmount,
      rate: i.gstRate
    }))
  };

  return {
    priceMode,
    supplyType,
    canteenStateCode: config.stateCode,
    customerStateCode,
    isGstRegistered: config.isGstRegistered,
    foodSubtotal: displayedFoodSubtotal,
    taxableFoodAmount: totalTaxableFood,
    foodGstAmount: totalFoodTax,
    foodGstRate: effectiveGstRate,
    cgstRate: supplyType === 'INTRA_STATE' ? round2(effectiveGstRate / 2) : 0,
    cgstAmount: totalCgst,
    sgstRate: supplyType === 'INTRA_STATE' ? round2(effectiveGstRate / 2) : 0,
    sgstAmount: totalSgst,
    igstRate: supplyType === 'INTER_STATE' ? effectiveGstRate : 0,
    igstAmount: totalIgst,
    effectiveGstRate,
    commissionFee,
    gatewayFee,
    targetNet,
    grossPayable,
    finalTotalAmount: grossPayable,
    discountAmount,
    totalTaxAmount: totalFoodTax,
    canteenPayable,
    platformNet,
    items: itemDetails,
    taxSnapshot,
  };
}

/**
 * Fetches configured tax settings for a canteen from database, or returns safe defaults.
 */
export async function fetchCanteenTaxConfig(canteenId?: string): Promise<CanteenTaxConfig> {
  if (!canteenId) return DEFAULT_CANTEEN_TAX_CONFIG;

  try {
    const { data, error } = await supabase
      .from('canteen_tax_configs')
      .select('*')
      .eq('canteen_id', canteenId)
      .maybeSingle();

    if (error || !data) {
      return DEFAULT_CANTEEN_TAX_CONFIG;
    }

    return {
      id: data.id,
      canteenId: data.canteen_id,
      tenantId: data.tenant_id,
      gstin: data.gstin,
      legalBusinessName: data.legal_business_name,
      stateCode: data.state_code || '33',
      stateName: data.state_name || 'Tamil Nadu',
      priceMode: (data.price_mode as PriceMode) || 'TAX_INCLUSIVE',
      defaultFoodGstRate: Number(data.default_food_gst_rate ?? 5.00),
      serviceFeeGstRate: Number(data.service_fee_gst_rate ?? 18.00),
      isGstRegistered: data.is_gst_registered ?? true,
      isCompositionScheme: data.is_composition_scheme ?? false,
    };
  } catch {
    return DEFAULT_CANTEEN_TAX_CONFIG;
  }
}

/**
 * Saves or updates canteen tax configuration.
 */
export async function saveCanteenTaxConfig(
  canteenId: string,
  tenantId: string,
  config: Partial<CanteenTaxConfig>
): Promise<{ success: boolean; error?: string }> {
  try {
    const payload = {
      canteen_id: canteenId,
      tenant_id: tenantId,
      gstin: config.gstin || null,
      legal_business_name: config.legalBusinessName || null,
      state_code: config.stateCode || '33',
      state_name: config.stateName || 'Tamil Nadu',
      price_mode: config.priceMode || 'TAX_INCLUSIVE',
      default_food_gst_rate: config.defaultFoodGstRate ?? 5.00,
      service_fee_gst_rate: config.serviceFeeGstRate ?? 18.00,
      is_gst_registered: config.isGstRegistered ?? true,
      is_composition_scheme: config.isCompositionScheme ?? false,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('canteen_tax_configs')
      .upsert(payload, { onConflict: 'canteen_id' });

    if (error) throw error;
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to save tax config' };
  }
}
