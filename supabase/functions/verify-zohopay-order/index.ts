import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0"

serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } })
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) throw new Error("Unauthorized")

    const { orderId, paymentSessionId, cart, pickupTime } = await req.json()
    
    // TODO: Verify payment with Zoho Payments API using paymentSessionId
    // If successful, proceed to create order in Supabase
    
    // For now, mock success
    
    // 2. Place order in database using rpc
    const { data: placeOrderResult, error: placeOrderError } = await supabaseClient.rpc(
      'place_order_with_otp',
      {
        p_user_id: user.id,
        p_cart_items: cart,
        p_pickup_time: pickupTime,
        p_payment_method: 'ZOHOPAY',
        p_cf_order_id: orderId, // using this for zohopay order id
        p_cf_payment_id: paymentSessionId // using this for zohopay payment id
      }
    )

    if (placeOrderError) throw placeOrderError

    return new Response(
      JSON.stringify({ success: true, order: placeOrderResult }),
      { headers: { "Content-Type": "application/json", 'Access-Control-Allow-Origin': '*' } }
    )
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { "Content-Type": "application/json", 'Access-Control-Allow-Origin': '*' } }
    )
  }
})
