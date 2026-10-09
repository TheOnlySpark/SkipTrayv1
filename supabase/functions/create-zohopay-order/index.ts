import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get("Authorization")!;
    const jwt = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);

    if (authError || !user) {
      throw new Error("Unauthorized");
    }

    const { items, total_amount, idempotency_key, is_takeaway } = await req.json();

    if (!idempotency_key) {
      throw new Error("Missing idempotency key");
    }

    // Call ZohoPay API to create a session
    // Replace this with actual ZohoPay endpoint and logic
    const zohoPaySecret = Deno.env.get("ZOHOPAY_SECRET_KEY");
    
    // Example fetch to ZohoPay (Modify according to their docs)
    const zohoRes = await fetch("https://payments.zoho.in/api/v1/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${zohoPaySecret}`,
        "Idempotency-Key": idempotency_key
      },
      body: JSON.stringify({
        amount: total_amount,
        currency: "INR",
        reference_id: idempotency_key,
        customer: { email: user.email }
      })
    });

    if (!zohoRes.ok) {
      const errorData = await zohoRes.json();
      throw new Error(errorData.message || "Failed to create ZohoPay session");
    }

    const zohoData = await zohoRes.json();

    return new Response(JSON.stringify({ session_id: zohoData.session_id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
