export interface OrderLedger {
  food_subtotal: number;
  commission_fee: number;
  target_net: number;
  gross_payable: number;
  gateway_fee: number;
  gw_deduction: number;
  net_settled: number;
  canteen_payable: number;
  platform_net: number;
}

export function calculateOrderLedger(foodSubtotal: number): OrderLedger {
  const round2 = (val: number) => Number((Math.round(val * 100) / 100).toFixed(2));

  const food_subtotal = round2(Number(foodSubtotal) || 0);
  if (food_subtotal <= 0) {
    return {
      food_subtotal: 0,
      commission_fee: 0,
      target_net: 0,
      gross_payable: 0,
      gateway_fee: 0,
      gw_deduction: 0,
      net_settled: 0,
      canteen_payable: 0,
      platform_net: 0
    };
  }

  const commission_fee = 0;
  const target_net = food_subtotal;
  const gross_payable = food_subtotal;
  const gateway_fee = 0;
  const gw_deduction = 0;
  const net_settled = food_subtotal;
  const canteen_payable = food_subtotal;
  const platform_net = 0;

  return {
    food_subtotal,
    commission_fee,
    target_net,
    gross_payable,
    gateway_fee,
    gw_deduction,
    net_settled,
    canteen_payable,
    platform_net
  };
}
