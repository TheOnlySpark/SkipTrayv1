import { load } from '@cashfreepayments/cashfree-js';

let cashfreeInstance: any = null;

export const loadCashfree = async (): Promise<any> => {
  if (cashfreeInstance) return cashfreeInstance;

  const mode = import.meta.env.VITE_CASHFREE_MODE || 'sandbox';
  cashfreeInstance = await load({ mode });
  return cashfreeInstance;
};
