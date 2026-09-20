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
    const { items, customer_id, customer_phone } = await req.json()

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

    // 2.5% gateway fee + 4 INR platform fee
    const gatewayFee = calculatedTotal * 0.025;
    const amountToCharge = Math.round((calculatedTotal + gatewayFee + 4) * 100) / 100;

    // @ts-ignore
    const appId = Deno.env.get('CASHFREE_APP_ID')
    // @ts-ignore
    const secretKey = Deno.env.get('CASHFREE_SECRET_KEY')

    if (!appId || !secretKey) {
      throw new Error("Cashfree keys not configured")
    }

    // Determine environment URL
    // @ts-ignore
    const baseUrl = (Deno.env.get('CASHFREE_ENV') === 'production')
      ? 'https://api.cashfree.com'
      : 'https://sandbox.cashfree.com'

    const orderId = `order_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    const response = await fetch(`${baseUrl}/pg/orders`, {
      method: 'POST',
      headers: {
        'x-client-id': appId,
        'x-client-secret': secretKey,
        'x-api-version': '2025-01-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        order_id: orderId,
        order_amount: amountToCharge,
        order_currency: 'INR',
        customer_details: {
          customer_id: customer_id || `cust_${Date.now()}`,
          customer_phone: customer_phone || '9999999999',
        },
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      console.error('Cashfree Error:', data)
      throw new Error(data.message || 'Failed to create Cashfree order')
    }

    return new Response(JSON.stringify({
      payment_session_id: data.payment_session_id,
      cf_order_id: data.cf_order_id,
      order_id: data.order_id,
    }), {
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
