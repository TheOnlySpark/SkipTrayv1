// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Verify Authentication Header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized: Missing or invalid Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const jwt = authHeader.replace('Bearer ', '').trim();
    if (!jwt) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized: Bearer token is empty' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Verify Caller Session via Auth API
    const { data: { user: callerUser }, error: callerError } = await adminClient.auth.getUser(jwt);
    if (callerError || !callerUser) {
      console.error('Caller Auth Verification Failed:', callerError);
      return new Response(
        JSON.stringify({ error: `Unauthorized: ${callerError?.message || 'Invalid or expired session token'}` }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Fetch Caller Profile from Trusted Database Records
    const { data: callerProfile, error: profileError } = await adminClient
      .from('profiles')
      .select('id, role, tenant_id, canteen_id, name')
      .eq('id', callerUser.id)
      .single();

    if (profileError || !callerProfile) {
      console.error('Caller Profile Lookup Failed:', profileError);
      return new Response(
        JSON.stringify({ error: 'Forbidden: Caller profile record not found' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Enforce Elevated Administrative Role
    const allowedCallerRoles = ['CANTEEN_ADMIN', 'UNI_ADMIN', 'ADMIN', 'SUPER_ADMIN'];
    if (!allowedCallerRoles.includes(callerProfile.role)) {
      return new Response(
        JSON.stringify({ error: 'Forbidden: Insufficient privileges. Only administrators can provision or manage staff accounts.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 5. Parse Request Payload
    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: 'Bad Request: Invalid JSON payload' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ------------------------------------------------------------------------
    // ACTION: DELETE STAFF / USER
    // ------------------------------------------------------------------------
    if (body.action === 'DELETE') {
      const { user_id } = body;
      if (!user_id) {
        return new Response(
          JSON.stringify({ error: 'Bad Request: Missing required field user_id' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: targetProfile, error: targetError } = await adminClient
        .from('profiles')
        .select('id, role, tenant_id, canteen_id')
        .eq('id', user_id)
        .maybeSingle();

      if (targetError) {
        console.error('Error fetching target profile for deletion:', targetError);
      }

      // Authorization checks for DELETE
      if (targetProfile) {
        if (callerProfile.role === 'CANTEEN_ADMIN') {
          if (!callerProfile.canteen_id) {
            return new Response(
              JSON.stringify({ error: 'Forbidden: Canteen Admin has no assigned cafeteria' }),
              { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          if (targetProfile.role !== 'STAFF') {
            return new Response(
              JSON.stringify({ error: 'Forbidden: Canteen Admins can only delete STAFF accounts' }),
              { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          if (targetProfile.canteen_id !== callerProfile.canteen_id || targetProfile.tenant_id !== callerProfile.tenant_id) {
            return new Response(
              JSON.stringify({ error: 'Forbidden: Cannot delete staff from another cafeteria or university' }),
              { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        } else if (callerProfile.role === 'UNI_ADMIN' || callerProfile.role === 'ADMIN') {
          if (targetProfile.tenant_id !== callerProfile.tenant_id) {
            return new Response(
              JSON.stringify({ error: 'Forbidden: Cannot delete users outside your university scope' }),
              { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          if (targetProfile.role === 'SUPER_ADMIN' || targetProfile.role === 'UNI_ADMIN') {
            return new Response(
              JSON.stringify({ error: 'Forbidden: Cannot delete other University Admins or Super Admins' }),
              { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        }
      }

      // Delete from auth.users (cascades to profiles)
      const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(user_id);
      if (deleteUserError) {
        console.warn('Auth user delete failed, attempting fallback profile deletion:', deleteUserError);
        const { error: delProfileError } = await adminClient.from('profiles').delete().eq('id', user_id);
        if (delProfileError) {
          return new Response(
            JSON.stringify({ error: `Failed to delete user: ${deleteUserError.message}` }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      return new Response(
        JSON.stringify({ success: true, message: 'User deleted successfully' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ------------------------------------------------------------------------
    // ACTION: CREATE STAFF / USER ACCOUNT
    // ------------------------------------------------------------------------
    const { name, email, password, role, canteen_id } = body;

    // Validate presence and basic formats
    if (!name || typeof name !== 'string' || !name.trim()) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid field: name is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!email || typeof email !== 'string' || !email.trim()) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid field: email is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      return new Response(
        JSON.stringify({ error: 'Invalid password: Password must be at least 6 characters long' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!role || typeof role !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid field: role is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();
    const targetRole = role.trim().toUpperCase();

    // 6. Enforce Role Allowlist Based on Caller's Authority
    let resolvedTenantId: string;
    let resolvedCanteenId: string | null = null;

    if (callerProfile.role === 'CANTEEN_ADMIN') {
      // Rule 1: Canteen Admin can ONLY create STAFF role.
      if (targetRole !== 'STAFF') {
        return new Response(
          JSON.stringify({ error: 'Forbidden: Canteen Admins are only authorized to provision STAFF accounts' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Rule 2: Canteen Admin MUST have an authorized canteen assignment in their profile.
      if (!callerProfile.canteen_id) {
        return new Response(
          JSON.stringify({ error: 'Forbidden: Caller has no authorized canteen assignment in their profile' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Rule 3: Do not trust client-supplied canteen_id. If client submitted a canteen_id,
      // verify it strictly matches callerProfile.canteen_id. Reject any cross-canteen assignment attack!
      if (canteen_id && canteen_id !== callerProfile.canteen_id) {
        return new Response(
          JSON.stringify({
            error: 'Forbidden: Cross-canteen assignment rejected. You are not authorized to assign staff to another canteen.'
          }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Derive target canteen directly from trusted caller profile
      resolvedCanteenId = callerProfile.canteen_id;
      resolvedTenantId = callerProfile.tenant_id;

      // Verify that the assigned canteen exists, belongs to caller's tenant, and is active
      const { data: canteenRecord, error: canteenQueryError } = await adminClient
        .from('canteens')
        .select('id, tenant_id, is_active, name')
        .eq('id', resolvedCanteenId)
        .single();

      if (canteenQueryError || !canteenRecord) {
        return new Response(
          JSON.stringify({ error: 'Bad Request: Authorized canteen record could not be found' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (canteenRecord.tenant_id !== resolvedTenantId) {
        return new Response(
          JSON.stringify({ error: 'Forbidden: Tenant mismatch between canteen assignment and caller profile' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!canteenRecord.is_active) {
        return new Response(
          JSON.stringify({ error: 'Bad Request: Cannot assign staff to an inactive canteen' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else if (callerProfile.role === 'UNI_ADMIN' || callerProfile.role === 'ADMIN') {
      // University Admin scope: can create CANTEEN_ADMIN, STAFF, or STUDENT only within their university
      const allowedTargetRoles = ['CANTEEN_ADMIN', 'STAFF', 'STUDENT'];
      if (!allowedTargetRoles.includes(targetRole)) {
        return new Response(
          JSON.stringify({ error: 'Forbidden: University Admins cannot provision University Admin or Super Admin accounts' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      resolvedTenantId = callerProfile.tenant_id;

      if (targetRole === 'CANTEEN_ADMIN' || targetRole === 'STAFF') {
        if (!canteen_id) {
          return new Response(
            JSON.stringify({ error: 'Bad Request: canteen_id is required when creating a canteen administrator or staff member' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Validate the target canteen belongs to the caller's university tenant
        const { data: canteenRecord, error: canteenQueryError } = await adminClient
          .from('canteens')
          .select('id, tenant_id, is_active')
          .eq('id', canteen_id)
          .single();

        if (canteenQueryError || !canteenRecord) {
          return new Response(
            JSON.stringify({ error: 'Bad Request: Target canteen not found' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (canteenRecord.tenant_id !== resolvedTenantId) {
          return new Response(
            JSON.stringify({ error: 'Forbidden: Cross-university assignment rejected. Target canteen belongs to a different university organization.' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (!canteenRecord.is_active) {
          return new Response(
            JSON.stringify({ error: 'Bad Request: Target canteen is currently inactive' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        resolvedCanteenId = canteenRecord.id;
      } else {
        resolvedCanteenId = null;
      }
    } else if (callerProfile.role === 'SUPER_ADMIN') {
      // Super Admin: global authority, validate target canteen if specified
      if (canteen_id) {
        const { data: canteenRecord, error: canteenQueryError } = await adminClient
          .from('canteens')
          .select('id, tenant_id, is_active')
          .eq('id', canteen_id)
          .single();

        if (canteenQueryError || !canteenRecord) {
          return new Response(
            JSON.stringify({ error: 'Bad Request: Target canteen not found' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        resolvedCanteenId = canteenRecord.id;
        resolvedTenantId = canteenRecord.tenant_id;
      } else {
        resolvedTenantId = body.tenant_id || callerProfile.tenant_id;
        resolvedCanteenId = null;
      }
    } else {
      return new Response(
        JSON.stringify({ error: 'Forbidden: Unauthorized to perform this action' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 7. Atomic User & Profile Creation with Cleanup / Rollback Protection
    // Create the authentication user in Supabase Auth.
    // Privileged fields (tenant_id, role, canteen_id) are placed in app_metadata (server-only).
    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email: trimmedEmail,
      password,
      email_confirm: true,
      app_metadata: {
        tenant_id: resolvedTenantId,
        role: targetRole,
        canteen_id: resolvedCanteenId,
      },
      user_metadata: {
        name: trimmedName,
        tenant_id: resolvedTenantId,
      },
    });

    if (createError || !newUser?.user) {
      console.error('Auth User Creation Error:', createError);
      return new Response(
        JSON.stringify({ error: createError?.message || 'Failed to create user authentication account' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const createdUserId = newUser.user.id;

    // 8. Update and Verify Profile Record Atomically
    const updateData: {
      name: string;
      role: string;
      tenant_id: string;
      canteen_id: string | null;
    } = {
      name: trimmedName,
      role: targetRole,
      tenant_id: resolvedTenantId,
      canteen_id: resolvedCanteenId,
    };

    const { data: updatedProfile, error: profileUpdateError } = await adminClient
      .from('profiles')
      .update(updateData)
      .eq('id', createdUserId)
      .select('id, role, tenant_id, canteen_id, name')
      .single();

    // 9. Rollback if profile creation or configuration fails
    if (profileUpdateError || !updatedProfile) {
      console.error('Profile Update Failed after auth user creation:', profileUpdateError);
      console.warn('Initiating rollback: purging orphaned auth user', createdUserId);

      let cleanupSucceeded = false;
      try {
        const { error: rollbackDeleteError } = await adminClient.auth.admin.deleteUser(createdUserId);
        if (!rollbackDeleteError) {
          cleanupSucceeded = true;
          console.log('Rollback succeeded: purged orphaned auth user', createdUserId);
        } else {
          console.error('CRITICAL: Rollback deleteUser failed:', rollbackDeleteError);
        }
      } catch (cleanupEx) {
        console.error('CRITICAL: Exception during rollback cleanup:', cleanupEx);
      }

      // Also ensure profile row is removed if left in inconsistent state
      try {
        await adminClient.from('profiles').delete().eq('id', createdUserId);
      } catch { }

      if (cleanupSucceeded) {
        return new Response(
          JSON.stringify({
            error: `Failed to configure staff profile: ${profileUpdateError?.message || 'Database error'}. Authentication account was safely rolled back.`
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } else {
        return new Response(
          JSON.stringify({
            error: 'Failed to configure staff profile, and automatic rollback cleanup could not be confirmed. Manual reconciliation required.',
            reconciliation: {
              orphaned_user_id: createdUserId,
              email: trimmedEmail,
              status: 'ORPHANED_REQUIRES_CLEANUP'
            }
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // 10. Post-Condition Verification
    if (updatedProfile.role !== targetRole || updatedProfile.canteen_id !== resolvedCanteenId || updatedProfile.tenant_id !== resolvedTenantId) {
      console.error('Integrity check failed: Profile assignments do not match target values!', {
        expected: { role: targetRole, canteen_id: resolvedCanteenId, tenant_id: resolvedTenantId },
        actual: updatedProfile
      });

      // Rollback to prevent inconsistent profile from persisting
      await adminClient.auth.admin.deleteUser(createdUserId);
      await adminClient.from('profiles').delete().eq('id', createdUserId);

      return new Response(
        JSON.stringify({ error: 'Integrity check failed: profile assignment mismatch. Account was rolled back.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 11. Success Response
    return new Response(
      JSON.stringify({
        success: true,
        user_id: createdUserId,
        role: targetRole,
        canteen_id: resolvedCanteenId,
        message: `User ${trimmedEmail} successfully created as ${targetRole}`
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('Unhandled Edge Function Error:', err);
    return new Response(
      JSON.stringify({ error: err.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
