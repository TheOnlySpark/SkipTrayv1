// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const jwt = authHeader.replace('Bearer ', '').trim();

    // Verify the caller's session using the admin client
    const { data: { user: callerUser }, error: callerError } = await adminClient.auth.getUser(jwt);
    if (callerError || !callerUser) {
      console.error('Auth Error:', callerError);
      return new Response(JSON.stringify({ error: `Unauthorized: ${callerError?.message || 'Invalid token'}` }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: callerProfile, error: profileError } = await adminClient
      .from('profiles')
      .select('role, tenant_id')
      .eq('id', callerUser.id)
      .single();

    if (profileError || !callerProfile) {
      console.error('Profile Error:', profileError);
      return new Response(JSON.stringify({ error: 'Profile not found' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!['UNI_ADMIN', 'CANTEEN_ADMIN', 'ADMIN', 'SUPER_ADMIN'].includes(callerProfile.role)) {
      return new Response(JSON.stringify({ error: 'Forbidden: Requires elevated role' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { name, email, password, role, canteen_id } = await req.json();

    if (!name || !email || !password || !role) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    
    const targetRole = role.toUpperCase();
    if (!['STAFF', 'STUDENT', 'CANTEEN_ADMIN'].includes(targetRole)) {
       return new Response(JSON.stringify({ error: 'Invalid role.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (callerProfile.role === 'CANTEEN_ADMIN' && targetRole !== 'STAFF') {
      return new Response(JSON.stringify({ error: 'Canteen Admins can only create STAFF.' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name,
        tenant_id: callerProfile.tenant_id,
      },
    });

    if (createError) {
      console.error('Create Error:', createError);
      return new Response(JSON.stringify({ error: createError.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const updateData: any = { role: targetRole, name: name };
    if (canteen_id) updateData.canteen_id = canteen_id;

    const { error: profileUpdateError } = await adminClient
      .from('profiles')
      .update(updateData)
      .eq('id', newUser.user.id);

    if (profileUpdateError) {
      console.error('Profile Update Error:', profileUpdateError);
      return new Response(JSON.stringify({ error: profileUpdateError.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ success: true, message: `User ${email} created as ${targetRole}` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (err: any) {
    console.error('Unhandled Error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
