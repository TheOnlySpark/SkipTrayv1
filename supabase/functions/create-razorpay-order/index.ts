// @ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: any) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { items } = await req.json()

    if (!items || !Array.isArray(items) || items.length === 0) {
      return new Response(JSON.stringify({ error: 'Invalid or empty cart' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }

    const supabaseAdmin = createClient(
      // @ts-ignore
      Deno.env.get('SUPABASE_URL') ?? '',
      // @ts-ignore
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Calculate strict amount from DB
    const itemIds = items.map((i: any) => i.menu_item_id)
    const { data: menuItems, error: menuError } = await supabaseAdmin
      .from('menu_items')
      .select('id, price')
      .in('id', itemIds)

    if (menuError || !menuItems) {
      throw new Error("Could not fetch menu items for price calculation")
    }

    let calculatedTotal = 0;
    items.forEach((reqItem: any) => {
      const dbItem = menuItems.find((m: any) => m.id === reqItem.menu_item_id);
      if (dbItem && typeof dbItem.price === 'number') {
        calculatedTotal += dbItem.price * reqItem.quantity;
      }
    });

    if (calculatedTotal <= 0) {
      throw new Error("Cart total must be greater than zero")
    }
    
    // Exact Gross-Up formula to cover 2.36% Razorpay commission exactly
    // grossTotal - (grossTotal * 0.0236) = calculatedTotal -> grossTotal * 0.9764 = calculatedTotal
    const grossTotal = Math.ceil((calculatedTotal / 0.9764) * 100) / 100;
    const amountToCharge = grossTotal;

    // @ts-ignore
    const keyId = Deno.env.get('RAZORPAY_KEY_ID')
    // @ts-ignore
    const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET')

    if (!keyId || !keySecret) {
      throw new Error("Razorpay keys not configured")
    }

    // Call Razorpay API to create an order
    const authHeader = `Basic ${btoa(`${keyId}:${keySecret}`)}`
    
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: Math.round(amountToCharge * 100), // Razorpay expects amount in paise (smallest currency unit), rounded to nearest integer
        currency: 'INR',
        receipt: `receipt_${Date.now()}`
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      console.error('Razorpay Error:', data)
      throw new Error(data.error?.description || 'Failed to create Razorpay order')
    }

    return new Response(JSON.stringify({ order_id: data.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error: any) {
    console.error('Error creating order:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
