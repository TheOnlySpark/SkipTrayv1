import {
  calculateOrderBill,
  BillBreakdown,
  CanteenTaxConfig,
  TaxableCartItem,
  DEFAULT_CANTEEN_TAX_CONFIG,
  round2,
} from './taxService';

export interface OrderLedger {
  // Existing financial ledger properties (100% backward-compatible)
  food_subtotal: number;
  commission_fee: number;
  target_net: number;
  gross_payable: number;
  gateway_fee: number;
  gw_deduction: number;
  net_settled: number;
  canteen_payable: number;
  platform_net: number;

  // Enriched GST & Tax Breakdown Properties
  tax_mode?: string;
  supply_type?: string;
  taxable_food_amount?: number;
  food_gst_rate?: number;
  food_gst_amount?: number;
  cgst_rate?: number;
  cgst_amount?: number;
  sgst_rate?: number;
  sgst_amount?: number;
  igst_rate?: number;
  igst_amount?: number;
  total_tax_amount?: number;
  tax_snapshot?: Record<string, any>;
  taxBreakdown?: BillBreakdown;
}

/**
 * Calculates complete order ledger with precise GST tax accounting.
 * Supports legacy single-subtotal calls while providing full itemized tax breakdowns.
 */
export function calculateOrderLedger(
  foodSubtotal: number,
  items?: TaxableCartItem[],
  taxConfig: CanteenTaxConfig = DEFAULT_CANTEEN_TAX_CONFIG,
  customerStateCode: string = '33'
): OrderLedger {
  const roundedSubtotal = round2(Number(foodSubtotal) || 0);

  if (roundedSubtotal <= 0) {
    return {
      food_subtotal: 0,
      commission_fee: 0,
      target_net: 0,
      gross_payable: 0,
      gateway_fee: 0,
      gw_deduction: 0,
      net_settled: 0,
      canteen_payable: 0,
      platform_net: 0,
      tax_mode: taxConfig.priceMode,
      supply_type: 'INTRA_STATE',
      taxable_food_amount: 0,
      food_gst_rate: taxConfig.defaultFoodGstRate,
      food_gst_amount: 0,
      cgst_rate: taxConfig.defaultFoodGstRate / 2,
      cgst_amount: 0,
      sgst_rate: taxConfig.defaultFoodGstRate / 2,
      sgst_amount: 0,
      igst_rate: 0,
      igst_amount: 0,
      total_tax_amount: 0,
    };
  }

  // If specific items were not provided, synthesize a synthetic item from the subtotal
  const calculationItems: TaxableCartItem[] = items && items.length > 0
    ? items
    : [{
        id: 'generic_order_items',
        name: 'Food Order',
        quantity: 1,
        price: roundedSubtotal,
        gstRatePercent: taxConfig.defaultFoodGstRate,
      }];

  const bill = calculateOrderBill(calculationItems, taxConfig, customerStateCode);

  const gw_deduction = round2(bill.grossPayable * 0.0059);
  const net_settled = round2(bill.grossPayable - gw_deduction);

  return {
    food_subtotal: bill.foodSubtotal,
    commission_fee: bill.commissionFee,
    target_net: bill.targetNet,
    gross_payable: bill.grossPayable,
    gateway_fee: bill.gatewayFee,
    gw_deduction,
    net_settled,
    canteen_payable: bill.canteenPayable,
    platform_net: bill.platformNet,

    // GST Breakdown
    tax_mode: bill.priceMode,
    supply_type: bill.supplyType,
    taxable_food_amount: bill.taxableFoodAmount,
    food_gst_rate: bill.effectiveGstRate,
    food_gst_amount: bill.foodGstAmount,
    cgst_rate: bill.cgstRate,
    cgst_amount: bill.cgstAmount,
    sgst_rate: bill.sgstRate,
    sgst_amount: bill.sgstAmount,
    igst_rate: bill.igstRate,
    igst_amount: bill.igstAmount,
    total_tax_amount: bill.totalTaxAmount,
    tax_snapshot: bill.taxSnapshot,
    taxBreakdown: bill,
  };
}

export const computeLedger = calculateOrderLedger;
