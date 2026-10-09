// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Create a client with the caller's JWT to check their role
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization');

    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify caller is SUPER_ADMIN using their JWT
    const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: profile, error: profileError } = await callerClient
      .from('profiles')
      .select('role')
      .eq('id', (await callerClient.auth.getUser()).data.user?.id ?? '')
      .single();

    if (profileError || profile?.role !== 'SUPER_ADMIN') {
      return new Response(JSON.stringify({ error: 'Unauthorized — SUPER_ADMIN role required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { slug, name, admin_email, admin_name, admin_password } = await req.json();

    if (!slug || !name || !admin_email || !admin_name || !admin_password) {
      return new Response(JSON.stringify({ error: 'Missing required fields: slug, name, admin_email, admin_name, admin_password' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use service role client for privileged operations
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Create the tenant record via RPC
    // We MUST use callerClient here so that the SQL function's internal public.get_user_role()
    // check passes (since it relies on auth.uid(), which adminClient lacks).
    const { data: tenantId, error: tenantError } = await callerClient
      .rpc('create_tenant', { p_slug: slug, p_name: name });

    if (tenantError) {
      return new Response(JSON.stringify({ error: tenantError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Create the first Admin user for this tenant via Admin Auth API
    //    tenant_id goes in app_metadata (server-only, not user-editable)
    const { data: newUser, error: userError } = await adminClient.auth.admin.createUser({
      email: admin_email,
      password: admin_password,
      email_confirm: true,
      user_metadata: {
        name: admin_name,
        tenant_id: tenantId,
      },
    });

    if (userError) {
      // Rollback: delete the tenant we just created
      await adminClient.from('tenants').delete().eq('id', tenantId);
      return new Response(JSON.stringify({ error: userError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Set profile role to UNI_ADMIN and name
    const { error: profileUpdateError } = await adminClient
      .from('profiles')
      .update({ role: 'UNI_ADMIN', name: admin_name })
      .eq('id', newUser.user.id);

    if (profileUpdateError) {
      return new Response(JSON.stringify({ error: profileUpdateError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        tenant_id: tenantId,
        admin_user_id: newUser.user.id,
        message: `Tenant "${name}" created with the provided admin password.`,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
