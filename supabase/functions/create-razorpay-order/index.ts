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
    const { items } = await req.json()

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error("Invalid or empty cart")
    }

    const supabaseAdmin = createClient(
      // @ts-ignore
      Deno.env.get('SUPABASE_URL') ?? '',
      // @ts-ignore
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Fetch exact prices from DB to prevent tampering
    const itemIds = items.map((i: any) => i.menu_item_id)
    const { data: menuItems, error: menuError } = await supabaseAdmin
      .from('menu_items')
      .select('id, price')
      .in('id', itemIds)

    if (menuError || !menuItems) {
      throw new Error("Failed to fetch menu items")
    }

    // 2. Calculate the total base price
    let baseTotal = 0;
    items.forEach((reqItem: any) => {
      const dbItem = menuItems.find((m: any) => m.id === reqItem.menu_item_id);
      if (dbItem && typeof dbItem.price === 'number') {
        baseTotal += dbItem.price * reqItem.quantity;
      }
    });

    if (baseTotal <= 0) {
      throw new Error("Order total must be greater than zero")
    }
    
    // 3. Add Gateway Fee (2.36%)
    const gatewayFee = baseTotal * 0.0236;
    const finalAmount = baseTotal + gatewayFee;
    
    // Convert to paise (Razorpay expects smallest currency unit, rounded)
    const amountInPaise = Math.round(finalAmount * 100);

    // 4. Get Razorpay Credentials
    // @ts-ignore
    const keyId = Deno.env.get('RAZORPAY_KEY_ID')
    // @ts-ignore
    const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET')

    if (!keyId || !keySecret) {
      throw new Error("Razorpay credentials are not configured in Supabase Secrets")
    }

    // 5. Create order with Razorpay
    const authHeader = `Basic ${btoa(`${keyId}:${keySecret}`)}`
    const razorpayResponse = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amountInPaise,
        currency: 'INR',
        receipt: `rcpt_${Date.now()}`
      }),
    })

    const razorpayData = await razorpayResponse.json()

    if (!razorpayResponse.ok) {
      console.error('Razorpay API Error:', razorpayData)
      throw new Error(razorpayData.error?.description || 'Failed to create Razorpay order')
    }

    // 6. Return the Razorpay Order ID to the frontend
    return new Response(JSON.stringify({ order_id: razorpayData.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error: any) {
    console.error('Create Order Error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
