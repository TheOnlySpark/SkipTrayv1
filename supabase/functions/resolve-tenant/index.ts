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
    const url = new URL(req.url);
    const slug = url.searchParams.get('slug');

    if (!slug) {
      return new Response(JSON.stringify({ error: 'Missing slug query parameter' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Use service role to bypass RLS for public slug lookup
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: tenant, error } = await adminClient
      .from('tenants')
      .select(`
        id,
        slug,
        name,
        is_active,
        tenant_settings (
          display_name,
          logo_url,
          primary_color,
          timezone
        )
      `)
      .eq('slug', slug)
      .single();

    if (error || !tenant) {
      return new Response(JSON.stringify({ error: 'Tenant not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const settings = Array.isArray(tenant.tenant_settings)
      ? tenant.tenant_settings[0]
      : tenant.tenant_settings;

    return new Response(
      JSON.stringify({
        tenant_id:    tenant.id,
        slug:         tenant.slug,
        name:         settings?.display_name ?? tenant.name,
        is_active:    tenant.is_active,
        settings: {
          display_name:  settings?.display_name  ?? tenant.name,
          logo_url:      settings?.logo_url      ?? null,
          primary_color: settings?.primary_color ?? '#4f46e5',
          timezone:      settings?.timezone      ?? 'Asia/Kolkata',
        },
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
