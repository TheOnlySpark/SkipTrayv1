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

  const food_subtotal = round2(foodSubtotal);
  const commission_fee = round2(food_subtotal * 0.03);
  const target_net = round2(food_subtotal + commission_fee);
  const gross_payable = round2(target_net / 0.9941);
  const gateway_fee = round2(gross_payable - target_net);
  const gw_deduction = round2(gross_payable * 0.0059);
  const net_settled = round2(gross_payable - gw_deduction);
  const canteen_payable = food_subtotal;
  const platform_net = round2(net_settled - canteen_payable);

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
