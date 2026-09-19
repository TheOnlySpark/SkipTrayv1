// @ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import * as crypto from "node:crypto"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// @ts-ignore
serve(async (req: any) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature, pickup_time, items } = await req.json()

    // 1. Get user from auth header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error("Missing Authorization header")

    const supabaseAdmin = createClient(
      // @ts-ignore
      Deno.env.get('SUPABASE_URL') ?? '',
      // @ts-ignore
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token)
    
    if (userError || !user) {
      throw new Error("Unauthorized: " + (userError?.message || 'No user found'))
    }

    // 2. Verify Razorpay Signature
    // @ts-ignore
    const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET')
    if (!keySecret) throw new Error("Razorpay secret not configured in Supabase Secrets")

    const signatureBody = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", keySecret)
      .update(signatureBody.toString())
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      throw new Error("Payment signature verification failed. Possible tampering.")
    }

    // 3. Verify Prices and Calculate Totals
    const itemIds = items.map((i: any) => i.menu_item_id)
    const { data: menuItems, error: menuError } = await supabaseAdmin
      .from('menu_items')
      .select('*')
      .in('id', itemIds)

    if (menuError || !menuItems) throw new Error("Could not fetch menu items")

    let baseTotal = 0
    const orderItemsForDb = []

    for (const reqItem of items) {
      const dbItem = menuItems.find((m: any) => m.id === reqItem.menu_item_id)
      if (!dbItem) throw new Error(`Menu item not found: ${reqItem.menu_item_id}`)
      if (dbItem.is_sold_out) throw new Error(`${dbItem.name} is currently sold out`)

      const lineTotal = dbItem.price * reqItem.quantity
      baseTotal += lineTotal
      
      orderItemsForDb.push({
        menu_item_id: dbItem.id,
        quantity: reqItem.quantity,
        price_at_time: dbItem.price
      })
    }

    const gatewayFee = baseTotal * 0.0236
    const finalAmount = baseTotal + gatewayFee

    // 4. Create the Order in the DB
    const { data: order, error: orderInsertError } = await supabaseAdmin
      .from('orders')
      .insert({
        user_id: user.id,
        pickup_time: pickup_time,
        total_amount: finalAmount,
        status: 'PLACED'
      })
      .select()
      .single()

    if (orderInsertError || !order) {
      throw new Error("Failed to create order: " + orderInsertError?.message)
    }

    // 5. Insert Order Items
    const { error: itemsInsertError } = await supabaseAdmin
      .from('order_items')
      .insert(
        orderItemsForDb.map(item => ({
          order_id: order.id,
          ...item
        }))
      )

    if (itemsInsertError) {
      throw new Error("Failed to save order items: " + itemsInsertError.message)
    }

    // 6. Record Payment
    const { error: paymentError } = await supabaseAdmin
      .from('payments')
      .insert({
        order_id: order.id,
        user_id: user.id,
        razorpay_payment_id: razorpay_payment_id,
        razorpay_order_id: razorpay_order_id,
        amount: finalAmount,
        currency: 'INR',
        status: 'CAPTURED'
      })

    if (paymentError) {
      console.error("Warning: Order succeeded but payment record failed:", paymentError)
      // We don't fail the order here because money was captured and order is placed, 
      // but we log it.
    }

    return new Response(JSON.stringify({ success: true, order }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error: any) {
    console.error('Verify Payment Error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
