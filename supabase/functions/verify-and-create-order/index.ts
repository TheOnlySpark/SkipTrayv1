// @ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: any) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      // @ts-ignore
      Deno.env.get('SUPABASE_URL') ?? '',
      // @ts-ignore
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    const supabaseAdmin = createClient(
      // @ts-ignore
      Deno.env.get('SUPABASE_URL') ?? '',
      // @ts-ignore
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const {
      order_id,       // The order_id we generated when creating the Cashfree order
      pickup_time,
      items           // Array of { menu_item_id, quantity }
    } = await req.json()

    // @ts-ignore
    const appId = Deno.env.get('CASHFREE_APP_ID')
    // @ts-ignore
    const secretKey = Deno.env.get('CASHFREE_SECRET_KEY')
    if (!appId || !secretKey) throw new Error("Cashfree keys not configured")

    // @ts-ignore
    const baseUrl = (Deno.env.get('CASHFREE_ENV') === 'production')
      ? 'https://api.cashfree.com'
      : 'https://sandbox.cashfree.com'

    // 1. Verify payment by fetching from Cashfree API (server-side, no client signatures needed)
    const paymentResponse = await fetch(`${baseUrl}/pg/orders/${order_id}/payments`, {
      headers: {
        'x-client-id': appId,
        'x-client-secret': secretKey,
        'x-api-version': '2025-01-01',
      }
    })
    const payments = await paymentResponse.json()

    if (!Array.isArray(payments) || payments.length === 0) {
      throw new Error("No payments found for this order")
    }

    // Find the successful payment
    const successfulPayment = payments.find((p: any) => p.payment_status === 'SUCCESS')
    if (!successfulPayment) {
      throw new Error("Payment not successful")
    }

    const cfPaymentId = String(successfulPayment.cf_payment_id)
    const amountPaid = successfulPayment.payment_amount

    // 2. Prevent Replay Attacks: Check if cf_payment_id already exists
    const { data: existingPayment } = await supabaseAdmin
      .from('payments')
      .select('id')
      .eq('cf_payment_id', cfPaymentId)
      .maybeSingle()

    if (existingPayment) {
      throw new Error("Payment already processed (Replay attack detected)")
    }

    // 3. Validate exact item cost from database to prevent Cart Tampering
    const itemIds = items.map((i: any) => i.menu_item_id)
    const { data: menuItems, error: menuError } = await supabaseAdmin
      .from('menu_items')
      .select('id, price')
      .in('id', itemIds)

    if (menuError || !menuItems) {
      throw new Error("Could not fetch menu items for validation")
    }

    let calculatedTotal = 0;
    items.forEach((reqItem: any) => {
      const dbItem = menuItems.find((m: any) => m.id === reqItem.menu_item_id);
      if (dbItem && typeof dbItem.price === 'number') {
        calculatedTotal += dbItem.price * reqItem.quantity;
      }
    });

    const gatewayFee = calculatedTotal * 0.025;
    const expectedAmountPaid = Math.round((calculatedTotal + gatewayFee + 4) * 100) / 100;

    // Allow for a small rounding difference
    if (Math.abs(expectedAmountPaid - amountPaid) > 0.02) {
      console.error(`Tampering detected! Paid: ${amountPaid}, Expected: ${expectedAmountPaid} (Cart: ${calculatedTotal})`)
      throw new Error("Payment amount mismatch. Order rejected.")
    }

    // 4. Get User ID
    const authHeader = req.headers.get('Authorization');
    const jwt = authHeader?.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(jwt)
    if (userError || !user) throw new Error("Unauthorized: " + (userError?.message || "No user found") + " | Token: " + (authHeader ? "Present" : "Missing"))

    // 5. Create Payment Record
    const { data: paymentRecord, error: paymentError } = await supabaseAdmin
      .from('payments')
      .insert({
        user_id: user.id,
        cf_order_id: order_id,
        cf_payment_id: cfPaymentId,
        amount: Math.round(Number(amountPaid) * 100),
        status: 'SUCCESS'
      })
      .select()
      .single()

    if (paymentError) throw new Error("Failed to record payment: " + paymentError.message)

    // 6. Create Order
    const otp_code = Math.floor(100000 + Math.random() * 900000).toString();

    const { data: orderRecord, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert({
        user_id: user.id,
        pickup_time,
        otp_code,
        payment_id: paymentRecord.id,
        status: 'PLACED'
      })
      .select()
      .single()

    if (orderError) throw new Error("Failed to create order: " + orderError.message)

    // 7. Insert order items
    const orderItemsToInsert = items.map((item: any) => ({
      order_id: orderRecord.id,
      menu_item_id: item.menu_item_id,
      quantity: item.quantity
    }))

    const { error: itemsError } = await supabaseAdmin
      .from('order_items')
      .insert(orderItemsToInsert)

    if (itemsError) throw new Error("Failed to insert order items: " + itemsError.message)

    return new Response(JSON.stringify({ success: true, order: orderRecord }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error: any) {
    console.error('Error verifying payment:', error)
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  }
})
