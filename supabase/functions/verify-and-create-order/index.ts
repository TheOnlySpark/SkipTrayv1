// @ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import crypto from "node:crypto"

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
      razorpay_payment_id, 
      razorpay_order_id, 
      razorpay_signature,
      pickup_time,
      items // Array of { menu_item_id, quantity }
    } = await req.json()

    // @ts-ignore
    const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET')
    if (!keySecret) throw new Error("Razorpay secret not configured")

    // 1. Verify Signature
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", keySecret)
      .update(body.toString())
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      throw new Error("Invalid payment signature")
    }

    // 2. Calculate amount from DB to be safe (or fetch payment details from Razorpay)
    // For simplicity, let's fetch the payment amount from Razorpay using API
    // @ts-ignore
    const keyId = Deno.env.get('RAZORPAY_KEY_ID')
    const authHeader = `Basic ${btoa(`${keyId}:${keySecret}`)}`
    
    const paymentResponse = await fetch(`https://api.razorpay.com/v1/payments/${razorpay_payment_id}`, {
      headers: { 'Authorization': authHeader }
    })
    const paymentData = await paymentResponse.json()
    
    if (paymentData.error) {
      throw new Error("Could not fetch payment details from Razorpay")
    }

    if (paymentData.status !== 'captured' && paymentData.status !== 'authorized') {
      throw new Error("Payment not captured")
    }

    const amountPaid = paymentData.amount / 100 // Convert from paise

    // 3. Prevent Replay Attacks: Check if payment ID already exists
    const { data: existingPayment } = await supabaseAdmin
      .from('payments')
      .select('id')
      .eq('razorpay_payment_id', razorpay_payment_id)
      .maybeSingle()

    if (existingPayment) {
      throw new Error("Payment already processed (Replay attack detected)")
    }

    // 4. Validate exact item cost from database to prevent Cart Tampering
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

    const gatewayFee = calculatedTotal * 0.0236;
    const expectedAmountPaid = Math.round((calculatedTotal + gatewayFee) * 100) / 100;

    // Allow for a 1 paisa rounding difference just in case
    if (Math.abs(expectedAmountPaid - amountPaid) > 0.02) {
      console.error(`Tampering detected! Paid: ${amountPaid}, Expected: ${expectedAmountPaid} (Cart: ${calculatedTotal})`)
      throw new Error("Payment amount mismatch. Order rejected.")
    }

    // 5. Get User ID
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) throw new Error("Unauthorized")

    // 6. Create Payment Record
    const { data: paymentRecord, error: paymentError } = await supabaseAdmin
      .from('payments')
      .insert({
        user_id: user.id,
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        amount: amountPaid,
        status: 'SUCCESS'
      })
      .select()
      .single()

    if (paymentError) throw new Error("Failed to record payment: " + paymentError.message)

    // 7. Create Order
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

    // 8. Insert order items
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
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
