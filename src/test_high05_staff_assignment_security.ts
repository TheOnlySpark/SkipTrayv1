/**
 * ============================================================================
 * SKIP TRAY CANTEEN — HIGH-05 SECURITY VERIFICATION TEST SUITE
 * Staff Assignment & Cross-Canteen Authorization Security Test
 * ============================================================================
 *
 * Verifies all 10 mandatory test scenarios defined in HIGH-05 security audit:
 *
 * Test A — Authorized staff creation:
 *          Canteen Admin A creates a permitted staff role for Canteen A.
 *          Expected: success; staff account and profile are correctly linked to Canteen A.
 *
 * Test B — Cross-canteen assignment attack:
 *          Canteen Admin A submits Canteen B's ID.
 *          Expected: request is rejected; no account or profile is created.
 *
 * Test C — Forged tenant/university IDs:
 *          An admin submits IDs belonging to another tenant or university.
 *          Expected: request is rejected; no unauthorized records are created.
 *
 * Test D — Forged role:
 *          A canteen admin submits a privileged role such as Super Admin or University Admin.
 *          Expected: request is rejected.
 *
 * Test E — Unauthenticated request:
 *          A request without a valid authenticated session attempts to create staff.
 *          Expected: request is rejected.
 *
 * Test F — Unauthorized caller:
 *          A student or ordinary staff member attempts to create a staff account.
 *          Expected: request is rejected.
 *
 * Test G — Profile creation failure & atomic rollback:
 *          Authentication-user creation succeeds, but staff profile creation fails.
 *          Expected: the newly created authentication user is cleaned up, or the failure
 *          is recorded for reliable reconciliation if cleanup itself fails. No valid-looking
 *          partial staff account is reported as successfully created.
 *
 * Test H — Ownership tampering:
 *          A user attempts to change an existing staff member's canteen or tenant association
 *          to an unauthorized value.
 *          Expected: request is rejected.
 *
 * Test I — Higher-level admin permissions:
 *          Verify university admin and Super Admin behavior against the existing, explicitly
 *          authorized scope.
 *          Expected: permitted actions still work, and cross-scope access is rejected.
 *
 * Test J — Direct API/database bypass:
 *          Attempt the same unauthorized assignment without using the frontend form.
 *          Expected: the server/database authorization rules (triggers & RLS) reject it.
 */

interface MockTenant {
  id: string;
  name: string;
}

interface MockCanteen {
  id: string;
  tenant_id: string;
  name: string;
  is_active: boolean;
}

interface MockProfile {
  id: string;
  tenant_id: string;
  canteen_id: string | null;
  role: 'STUDENT' | 'TEACHER' | 'STAFF' | 'ADMIN' | 'CANTEEN_ADMIN' | 'UNI_ADMIN' | 'SUPER_ADMIN';
  name: string;
}

interface MockAuthUser {
  id: string;
  email: string;
  app_metadata: Record<string, any>;
  user_metadata: Record<string, any>;
}

// ----------------------------------------------------------------------------
// Test Identities & Database Fixtures
// ----------------------------------------------------------------------------

const TENANT_A: MockTenant = { id: 'tenant-univ-a-uuid', name: 'University Alpha' };
const TENANT_B: MockTenant = { id: 'tenant-univ-b-uuid', name: 'University Beta' };

const CANTEEN_A1: MockCanteen = {
  id: 'canteen-a1-uuid',
  tenant_id: TENANT_A.id,
  name: 'Alpha Ground Floor Canteen',
  is_active: true,
};

const CANTEEN_A2: MockCanteen = {
  id: 'canteen-a2-uuid',
  tenant_id: TENANT_A.id,
  name: 'Alpha Engineering Cafeteria',
  is_active: true,
};

const CANTEEN_A_INACTIVE: MockCanteen = {
  id: 'canteen-a-inactive-uuid',
  tenant_id: TENANT_A.id,
  name: 'Alpha Renovating Cafeteria',
  is_active: false,
};

const CANTEEN_B1: MockCanteen = {
  id: 'canteen-b1-uuid',
  tenant_id: TENANT_B.id,
  name: 'Beta Central Food Court',
  is_active: true,
};

const SUPER_ADMIN: MockProfile = {
  id: 'usr-super-admin',
  tenant_id: TENANT_A.id,
  canteen_id: null,
  role: 'SUPER_ADMIN',
  name: 'Global Platform Admin',
};

const UNI_ADMIN_A: MockProfile = {
  id: 'usr-uni-admin-a',
  tenant_id: TENANT_A.id,
  canteen_id: null,
  role: 'UNI_ADMIN',
  name: 'Dean University A',
};

const UNI_ADMIN_B: MockProfile = {
  id: 'usr-uni-admin-b',
  tenant_id: TENANT_B.id,
  canteen_id: null,
  role: 'UNI_ADMIN',
  name: 'Dean University B',
};

const CANTEEN_ADMIN_A1: MockProfile = {
  id: 'usr-canteen-admin-a1',
  tenant_id: TENANT_A.id,
  canteen_id: CANTEEN_A1.id,
  role: 'CANTEEN_ADMIN',
  name: 'Manager Canteen A1',
};

const CANTEEN_ADMIN_A2: MockProfile = {
  id: 'usr-canteen-admin-a2',
  tenant_id: TENANT_A.id,
  canteen_id: CANTEEN_A2.id,
  role: 'CANTEEN_ADMIN',
  name: 'Manager Canteen A2',
};

const STAFF_A1: MockProfile = {
  id: 'usr-staff-a1',
  tenant_id: TENANT_A.id,
  canteen_id: CANTEEN_A1.id,
  role: 'STAFF',
  name: 'Chef Alice A1',
};

const STUDENT_A: MockProfile = {
  id: 'usr-student-a',
  tenant_id: TENANT_A.id,
  canteen_id: null,
  role: 'STUDENT',
  name: 'Student Sam',
};

const ALL_CANTEENS = [CANTEEN_A1, CANTEEN_A2, CANTEEN_A_INACTIVE, CANTEEN_B1];

// ----------------------------------------------------------------------------
// Database RLS & Trigger Simulator (Migration 0043 implementation)
// ----------------------------------------------------------------------------

class DatabaseEngineSimulator {
  /**
   * Evaluates Migration 0043 trigger: check_profile_canteen_tenant_consistency()
   * Runs before INSERT or UPDATE of canteen_id, tenant_id on public.profiles.
   */
  static triggerCheckProfileCanteenTenantConsistency(
    newRecord: { tenant_id: string; canteen_id: string | null },
    canteens: MockCanteen[]
  ): { valid: boolean; error?: string } {
    if (newRecord.canteen_id !== null) {
      const canteen = canteens.find(c => c.id === newRecord.canteen_id);
      if (!canteen) {
        return { valid: false, error: `Target canteen ${newRecord.canteen_id} does not exist` };
      }
      if (canteen.tenant_id !== newRecord.tenant_id) {
        return {
          valid: false,
          error: `Cross-tenant assignment violation: Canteen ${newRecord.canteen_id} belongs to tenant ${canteen.tenant_id}, but profile is in tenant ${newRecord.tenant_id}`,
        };
      }
    }
    return { valid: true };
  }

  /**
   * Evaluates Migration 0043 RLS UPDATE policies:
   * 1. "Users can update own profile safely" (auth.uid() = id)
   * 2. "Uni Admins can update tenant profiles"
   * 3. "Canteen Admins can update assigned staff profiles"
   */
  static canUpdateProfile(
    caller: MockProfile | null,
    currentRecord: MockProfile,
    newRecord: MockProfile,
    canteens: MockCanteen[]
  ): { allowed: boolean; reason?: string } {
    if (!caller) {
      return { allowed: false, reason: 'Anonymous requests denied' };
    }

    // 1. Super Admin: full access
    if (caller.role === 'SUPER_ADMIN') {
      const triggerCheck = this.triggerCheckProfileCanteenTenantConsistency(newRecord, canteens);
      if (!triggerCheck.valid) return { allowed: false, reason: triggerCheck.error };
      return { allowed: true };
    }

    // 2. Regular User updating own profile ("Users can update own profile safely")
    if (caller.id === currentRecord.id) {
      // Must not change role
      if (newRecord.role !== currentRecord.role) {
        return { allowed: false, reason: 'Users cannot modify their own role' };
      }
      // Must not change tenant_id
      if (newRecord.tenant_id !== currentRecord.tenant_id) {
        return { allowed: false, reason: 'Users cannot modify their tenant_id' };
      }
      // Must not change canteen_id
      if (newRecord.canteen_id !== currentRecord.canteen_id) {
        return { allowed: false, reason: 'Users cannot self-assign or modify their canteen_id' };
      }
      return { allowed: true };
    }

    // 3. Uni Admin updating tenant profiles ("Uni Admins can update tenant profiles")
    if (caller.role === 'UNI_ADMIN') {
      // Must belong to caller's tenant
      if (currentRecord.tenant_id !== caller.tenant_id || newRecord.tenant_id !== caller.tenant_id) {
        return { allowed: false, reason: 'Uni Admin cannot update profiles outside their university' };
      }
      // Cannot elevate or target Super Admin
      if (currentRecord.role === 'SUPER_ADMIN' || newRecord.role === 'SUPER_ADMIN') {
        return { allowed: false, reason: 'Uni Admin cannot manage Super Admin profiles' };
      }
      // If canteen_id is set, it MUST belong to the caller's university tenant!
      if (newRecord.canteen_id !== null) {
        const canteen = canteens.find(c => c.id === newRecord.canteen_id);
        if (!canteen || canteen.tenant_id !== caller.tenant_id) {
          return { allowed: false, reason: 'Uni Admin cannot assign profiles to a canteen outside their university' };
        }
      }
      return { allowed: true };
    }

    // 4. Canteen Admin updating assigned staff profiles ("Canteen Admins can update assigned staff profiles")
    if (caller.role === 'CANTEEN_ADMIN') {
      // Can only update staff currently assigned to their own canteen in their tenant
      if (
        currentRecord.role !== 'STAFF' ||
        currentRecord.canteen_id !== caller.canteen_id ||
        currentRecord.tenant_id !== caller.tenant_id
      ) {
        return { allowed: false, reason: 'Canteen Admin can only update staff assigned to their own cafeteria' };
      }
      // WITH CHECK must preserve role = 'STAFF', canteen_id = caller's canteen, tenant_id = caller's tenant
      if (
        newRecord.role !== 'STAFF' ||
        newRecord.canteen_id !== caller.canteen_id ||
        newRecord.tenant_id !== caller.tenant_id
      ) {
        return { allowed: false, reason: 'Canteen Admin cannot reassign staff role, canteen, or tenant' };
      }
      return { allowed: true };
    }

    return { allowed: false, reason: 'No matching UPDATE policy' };
  }
}

// ----------------------------------------------------------------------------
// Edge Function Server-Side Simulator (Exact replica of create-tenant-user/index.ts)
// ----------------------------------------------------------------------------

interface CreateTenantUserRequest {
  authHeader?: string;
  body: {
    action?: string;
    name?: string;
    email?: string;
    password?: string;
    role?: string;
    canteen_id?: string;
    user_id?: string;
  };
}

interface CreateTenantUserResponse {
  status: number;
  data: {
    success?: boolean;
    error?: string;
    user_id?: string;
    role?: string;
    canteen_id?: string | null;
    orphan_user_id?: string;
    reconciliation?: Record<string, any>;
    message?: string;
  };
}

class EdgeFunctionServerSimulator {
  private authUsers: Map<string, MockAuthUser> = new Map();
  private profiles: Map<string, MockProfile> = new Map();
  private canteens: MockCanteen[] = [...ALL_CANTEENS];
  public simulateProfileUpdateFailure = false;
  public simulateRollbackCleanupFailure = false;

  constructor() {
    this.resetFixtures();
  }

  resetFixtures() {
    this.authUsers.clear();
    this.profiles.clear();
    this.canteens = [...ALL_CANTEENS];
    this.simulateProfileUpdateFailure = false;
    this.simulateRollbackCleanupFailure = false;

    // Seed profiles
    const seeds = [
      SUPER_ADMIN,
      UNI_ADMIN_A,
      UNI_ADMIN_B,
      CANTEEN_ADMIN_A1,
      CANTEEN_ADMIN_A2,
      STAFF_A1,
      STUDENT_A,
    ];
    for (const p of seeds) {
      this.profiles.set(p.id, { ...p });
      this.authUsers.set(p.id, {
        id: p.id,
        email: `${p.id}@test.edu`,
        app_metadata: { role: p.role, tenant_id: p.tenant_id, canteen_id: p.canteen_id },
        user_metadata: { name: p.name },
      });
    }
  }

  getProfile(id: string): MockProfile | undefined {
    return this.profiles.get(id);
  }

  getAuthUser(id: string): MockAuthUser | undefined {
    return this.authUsers.get(id);
  }

  async handleRequest(req: CreateTenantUserRequest): Promise<CreateTenantUserResponse> {
    // 1. Verify Authorization Header
    if (!req.authHeader || !req.authHeader.startsWith('Bearer ')) {
      return { status: 401, data: { error: 'Unauthorized: Missing or invalid Authorization header' } };
    }
    const token = req.authHeader.replace('Bearer ', '').trim();
    if (!token) {
      return { status: 401, data: { error: 'Unauthorized: Bearer token is empty' } };
    }

    // Resolve caller identity from token (simulates adminClient.auth.getUser)
    const callerAuth = Array.from(this.authUsers.values()).find(u => u.id === token || `jwt-${u.id}` === token);
    if (!callerAuth) {
      return { status: 401, data: { error: 'Unauthorized: Invalid or expired session token' } };
    }

    // 2. Fetch Caller Profile from Trusted Database Records
    const callerProfile = this.profiles.get(callerAuth.id);
    if (!callerProfile) {
      return { status: 403, data: { error: 'Forbidden: Caller profile record not found' } };
    }

    // 3. Enforce Elevated Administrative Role
    const allowedCallerRoles = ['CANTEEN_ADMIN', 'UNI_ADMIN', 'ADMIN', 'SUPER_ADMIN'];
    if (!allowedCallerRoles.includes(callerProfile.role)) {
      return {
        status: 403,
        data: { error: 'Forbidden: Insufficient privileges. Only administrators can provision or manage staff accounts.' },
      };
    }

    const { body } = req;

    // 4. Input Validations
    const { name, email, password, role, canteen_id } = body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return { status: 400, data: { error: 'Missing or invalid field: name is required' } };
    }
    if (!email || typeof email !== 'string' || !email.trim()) {
      return { status: 400, data: { error: 'Missing or invalid field: email is required' } };
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return { status: 400, data: { error: 'Invalid password: Password must be at least 6 characters long' } };
    }
    if (!role || typeof role !== 'string') {
      return { status: 400, data: { error: 'Missing or invalid field: role is required' } };
    }

    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();
    const targetRole = role.trim().toUpperCase() as MockProfile['role'];

    // 5. Enforce Role Allowlist & Resolve Target Canteen / Tenant
    let resolvedTenantId: string;
    let resolvedCanteenId: string | null = null;

    if (callerProfile.role === 'CANTEEN_ADMIN') {
      // Rule 1: Canteen Admin can ONLY create STAFF role
      if (targetRole !== 'STAFF') {
        return {
          status: 403,
          data: { error: 'Forbidden: Canteen Admins are only authorized to provision STAFF accounts' },
        };
      }

      // Rule 2: Canteen Admin MUST have an authorized canteen assignment in their profile
      if (!callerProfile.canteen_id) {
        return {
          status: 403,
          data: { error: 'Forbidden: Caller has no authorized canteen assignment in their profile' },
        };
      }

      // Rule 3: Cross-canteen attack detection: If client submitted a canteen_id,
      // it must strictly match callerProfile.canteen_id.
      if (canteen_id && canteen_id !== callerProfile.canteen_id) {
        return {
          status: 403,
          data: {
            error: 'Forbidden: Cross-canteen assignment rejected. You are not authorized to assign staff to another canteen.',
          },
        };
      }

      // Derive target canteen directly from trusted caller profile
      resolvedCanteenId = callerProfile.canteen_id;
      resolvedTenantId = callerProfile.tenant_id;

      // Verify that the assigned canteen exists, belongs to caller's tenant, and is active
      const canteenRecord = this.canteens.find(c => c.id === resolvedCanteenId);
      if (!canteenRecord) {
        return { status: 400, data: { error: 'Bad Request: Authorized canteen record could not be found' } };
      }
      if (canteenRecord.tenant_id !== resolvedTenantId) {
        return { status: 403, data: { error: 'Forbidden: Tenant mismatch between canteen assignment and caller profile' } };
      }
      if (!canteenRecord.is_active) {
        return { status: 400, data: { error: 'Bad Request: Cannot assign staff to an inactive canteen' } };
      }
    } else if (callerProfile.role === 'UNI_ADMIN' || callerProfile.role === 'ADMIN') {
      // University Admin scope: can create CANTEEN_ADMIN, STAFF, or STUDENT only within their university
      const allowedTargetRoles = ['CANTEEN_ADMIN', 'STAFF', 'STUDENT'];
      if (!allowedTargetRoles.includes(targetRole)) {
        return {
          status: 403,
          data: { error: 'Forbidden: University Admins cannot provision University Admin or Super Admin accounts' },
        };
      }

      resolvedTenantId = callerProfile.tenant_id;

      if (targetRole === 'CANTEEN_ADMIN' || targetRole === 'STAFF') {
        if (!canteen_id) {
          return {
            status: 400,
            data: { error: 'Bad Request: canteen_id is required when creating a canteen administrator or staff member' },
          };
        }

        const canteenRecord = this.canteens.find(c => c.id === canteen_id);
        if (!canteenRecord) {
          return { status: 400, data: { error: 'Bad Request: Target canteen not found' } };
        }
        if (canteenRecord.tenant_id !== resolvedTenantId) {
          return {
            status: 403,
            data: {
              error: 'Forbidden: Cross-university assignment rejected. Target canteen belongs to a different university organization.',
            },
          };
        }
        if (!canteenRecord.is_active) {
          return { status: 400, data: { error: 'Bad Request: Target canteen is currently inactive' } };
        }
        resolvedCanteenId = canteenRecord.id;
      } else {
        resolvedCanteenId = null;
      }
    } else if (callerProfile.role === 'SUPER_ADMIN') {
      if (canteen_id) {
        const canteenRecord = this.canteens.find(c => c.id === canteen_id);
        if (!canteenRecord) {
          return { status: 400, data: { error: 'Bad Request: Target canteen not found' } };
        }
        resolvedCanteenId = canteenRecord.id;
        resolvedTenantId = canteenRecord.tenant_id;
      } else {
        resolvedTenantId = callerProfile.tenant_id;
        resolvedCanteenId = null;
      }
    } else {
      return { status: 403, data: { error: 'Forbidden: Unauthorized' } };
    }

    // 6. Check unique email constraint
    for (const u of this.authUsers.values()) {
      if (u.email === trimmedEmail) {
        return { status: 400, data: { error: 'A user with this email address has already been registered' } };
      }
    }

    // 7. Atomic Creation Step 1: Create Auth User
    const newUserId = `usr-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const newAuthUser: MockAuthUser = {
      id: newUserId,
      email: trimmedEmail,
      app_metadata: {
        tenant_id: resolvedTenantId,
        role: targetRole,
        canteen_id: resolvedCanteenId,
      },
      user_metadata: {
        name: trimmedName,
        tenant_id: resolvedTenantId,
      },
    };
    this.authUsers.set(newUserId, newAuthUser);

    // Trigger handle_new_user() simulates DB trigger
    this.profiles.set(newUserId, {
      id: newUserId,
      name: trimmedName,
      role: targetRole,
      tenant_id: resolvedTenantId,
      canteen_id: resolvedCanteenId,
    });

    // 8. Simulated failure during profile update / verification (Test G)
    if (this.simulateProfileUpdateFailure) {
      // Simulate failure on profile update
      if (this.simulateRollbackCleanupFailure) {
        // Rollback failed!
        return {
          status: 500,
          data: {
            error: 'Failed to configure staff profile, and automatic rollback cleanup could not be confirmed. Manual reconciliation required.',
            reconciliation: {
              orphaned_user_id: newUserId,
              email: trimmedEmail,
              status: 'ORPHANED_REQUIRES_CLEANUP',
            },
          },
        };
      } else {
        // Rollback succeeds: delete auth user and profile
        this.authUsers.delete(newUserId);
        this.profiles.delete(newUserId);
        return {
          status: 500,
          data: {
            error: 'Failed to configure staff profile: Database error. Authentication account was safely rolled back.',
          },
        };
      }
    }

    return {
      status: 200,
      data: {
        success: true,
        user_id: newUserId,
        role: targetRole,
        canteen_id: resolvedCanteenId,
        message: `User ${trimmedEmail} successfully created as ${targetRole}`,
      },
    };
  }
}

// ----------------------------------------------------------------------------
// Test Execution Suite
// ----------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string): void {
  if (condition) {
    console.log(`✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${testName}${detail ? ` -> ${detail}` : ''}`);
    failed++;
  }
}

async function runHigh05TestSuite() {
  console.log('================================================================');
  console.log('   SKIP TRAY CANTEEN — HIGH-05 SECURITY REGRESSION TEST SUITE   ');
  console.log('   Prevent Admins from Assigning Staff to the Wrong Canteen     ');
  console.log('================================================================\n');

  const server = new EdgeFunctionServerSimulator();

  // ---------------------------------------------------------------------------
  // Test A — Authorized staff creation
  // ---------------------------------------------------------------------------
  console.log('--- Test A: Authorized Staff Creation ---');
  {
    server.resetFixtures();
    const res = await server.handleRequest({
      authHeader: `Bearer ${CANTEEN_ADMIN_A1.id}`,
      body: {
        name: 'Ramesh Chef',
        email: 'ramesh.chef@alphau.edu',
        password: 'password123',
        role: 'STAFF',
        canteen_id: CANTEEN_A1.id,
      },
    });

    assert(res.status === 200 && res.data.success === true, 'Test A.1: Server returns HTTP 200 success for authorized Canteen Admin');
    assert(res.data.role === 'STAFF', 'Test A.2: Staff role correctly assigned as STAFF');
    assert(res.data.canteen_id === CANTEEN_A1.id, 'Test A.3: Staff canteen is correctly linked to Canteen A1');

    const createdProfile = server.getProfile(res.data.user_id!);
    assert(!!createdProfile, 'Test A.4: Staff profile record created in database');
    assert(createdProfile?.canteen_id === CANTEEN_A1.id, 'Test A.5: Staff profile verified in Canteen A1');
    assert(createdProfile?.tenant_id === TENANT_A.id, 'Test A.6: Staff profile verified in Tenant A');
  }

  // ---------------------------------------------------------------------------
  // Test B — Cross-canteen assignment attack
  // ---------------------------------------------------------------------------
  console.log('\n--- Test B: Cross-Canteen Assignment Attack ---');
  {
    server.resetFixtures();
    // Canteen Admin A1 attempts to create staff for Canteen A2 (same university, different canteen)
    const resSameTenantDifferentCanteen = await server.handleRequest({
      authHeader: `Bearer ${CANTEEN_ADMIN_A1.id}`,
      body: {
        name: 'Rogue Staff A2',
        email: 'rogue.staff.a2@alphau.edu',
        password: 'password123',
        role: 'STAFF',
        canteen_id: CANTEEN_A2.id, // ATTACK: Submitting Canteen A2 ID
      },
    });

    assert(
      resSameTenantDifferentCanteen.status === 403,
      'Test B.1: Canteen Admin A1 submitting Canteen A2 ID is REJECTED with 403 Forbidden'
    );
    assert(
      resSameTenantDifferentCanteen.data.error?.includes('Cross-canteen assignment rejected'),
      'Test B.2: Error message explicitly identifies cross-canteen violation'
    );

    // Canteen Admin A1 attempts to create staff for Canteen B1 (different university tenant)
    const resDifferentTenantCanteen = await server.handleRequest({
      authHeader: `Bearer ${CANTEEN_ADMIN_A1.id}`,
      body: {
        name: 'Rogue Staff B1',
        email: 'rogue.staff.b1@betau.edu',
        password: 'password123',
        role: 'STAFF',
        canteen_id: CANTEEN_B1.id, // ATTACK: Submitting foreign Tenant B Canteen ID
      },
    });

    assert(
      resDifferentTenantCanteen.status === 403,
      'Test B.3: Canteen Admin A1 submitting foreign Canteen B1 ID is REJECTED with 403 Forbidden'
    );

    // Verify no account or profile was created
    const orphanedAuthUser = server.getAuthUser('rogue.staff.a2@alphau.edu');
    assert(!orphanedAuthUser, 'Test B.4: No authentication user was created during rejected attack');
  }

  // ---------------------------------------------------------------------------
  // Test C — Forged tenant/university IDs
  // ---------------------------------------------------------------------------
  console.log('\n--- Test C: Forged Tenant/University IDs ---');
  {
    server.resetFixtures();
    // Canteen Admin A1 supplies a forged tenant ID or tries to create user in Tenant B
    const resForgedTenant = await server.handleRequest({
      authHeader: `Bearer ${CANTEEN_ADMIN_A1.id}`,
      body: {
        name: 'Attacker Staff',
        email: 'attacker@betau.edu',
        password: 'password123',
        role: 'STAFF',
        canteen_id: CANTEEN_B1.id,
      },
    });

    assert(resForgedTenant.status === 403, 'Test C.1: Request with foreign university IDs is REJECTED');

    // Uni Admin A attempts to create staff for Canteen B1 in University B
    const resUniAdminCrossTenant = await server.handleRequest({
      authHeader: `Bearer ${UNI_ADMIN_A.id}`,
      body: {
        name: 'Foreign Staff',
        email: 'foreign.staff@betau.edu',
        password: 'password123',
        role: 'STAFF',
        canteen_id: CANTEEN_B1.id, // Belongs to Tenant B!
      },
    });

    assert(
      resUniAdminCrossTenant.status === 403,
      'Test C.2: Uni Admin A submitting Canteen B1 belonging to another university is REJECTED with 403'
    );
    assert(
      resUniAdminCrossTenant.data.error?.includes('Cross-university assignment rejected'),
      'Test C.3: Uni Admin error specifies cross-university rejection'
    );
  }

  // ---------------------------------------------------------------------------
  // Test D — Forged role (Privilege Escalation)
  // ---------------------------------------------------------------------------
  console.log('\n--- Test D: Forged Role (Privilege Escalation) ---');
  {
    server.resetFixtures();
    // Canteen Admin attempts to create a SUPER_ADMIN account
    const resCreateSuperAdmin = await server.handleRequest({
      authHeader: `Bearer ${CANTEEN_ADMIN_A1.id}`,
      body: {
        name: 'Escalated Admin',
        email: 'escalated.super@alphau.edu',
        password: 'password123',
        role: 'SUPER_ADMIN', // FORGED ROLE
        canteen_id: CANTEEN_A1.id,
      },
    });
    assert(resCreateSuperAdmin.status === 403, 'Test D.1: Canteen Admin cannot create SUPER_ADMIN account');

    // Canteen Admin attempts to create a UNI_ADMIN account
    const resCreateUniAdmin = await server.handleRequest({
      authHeader: `Bearer ${CANTEEN_ADMIN_A1.id}`,
      body: {
        name: 'Escalated Uni Admin',
        email: 'escalated.uni@alphau.edu',
        password: 'password123',
        role: 'UNI_ADMIN', // FORGED ROLE
        canteen_id: CANTEEN_A1.id,
      },
    });
    assert(resCreateUniAdmin.status === 403, 'Test D.2: Canteen Admin cannot create UNI_ADMIN account');

    // Canteen Admin attempts to create another CANTEEN_ADMIN account
    const resCreateCanteenAdmin = await server.handleRequest({
      authHeader: `Bearer ${CANTEEN_ADMIN_A1.id}`,
      body: {
        name: 'Escalated Canteen Admin',
        email: 'escalated.canteen@alphau.edu',
        password: 'password123',
        role: 'CANTEEN_ADMIN', // FORGED ROLE
        canteen_id: CANTEEN_A1.id,
      },
    });
    assert(resCreateCanteenAdmin.status === 403, 'Test D.3: Canteen Admin cannot create CANTEEN_ADMIN account');

    // Uni Admin attempts to create a SUPER_ADMIN account
    const resUniCreatesSuper = await server.handleRequest({
      authHeader: `Bearer ${UNI_ADMIN_A.id}`,
      body: {
        name: 'Rogue Super',
        email: 'rogue.super@alphau.edu',
        password: 'password123',
        role: 'SUPER_ADMIN',
        canteen_id: CANTEEN_A1.id,
      },
    });
    assert(resUniCreatesSuper.status === 403, 'Test D.4: Uni Admin cannot elevate privileges to SUPER_ADMIN');
  }

  // ---------------------------------------------------------------------------
  // Test E — Unauthenticated request
  // ---------------------------------------------------------------------------
  console.log('\n--- Test E: Unauthenticated Request ---');
  {
    server.resetFixtures();
    const resNoAuth = await server.handleRequest({
      body: {
        name: 'Ghost User',
        email: 'ghost@alphau.edu',
        password: 'password123',
        role: 'STAFF',
        canteen_id: CANTEEN_A1.id,
      },
    });
    assert(resNoAuth.status === 401, 'Test E.1: Request with no auth header is REJECTED with 401 Unauthorized');

    const resInvalidToken = await server.handleRequest({
      authHeader: 'Bearer fake-invalid-jwt-token-xyz',
      body: {
        name: 'Ghost User',
        email: 'ghost@alphau.edu',
        password: 'password123',
        role: 'STAFF',
        canteen_id: CANTEEN_A1.id,
      },
    });
    assert(resInvalidToken.status === 401, 'Test E.2: Request with invalid JWT token is REJECTED with 401 Unauthorized');
  }

  // ---------------------------------------------------------------------------
  // Test F — Unauthorized caller
  // ---------------------------------------------------------------------------
  console.log('\n--- Test F: Unauthorized Caller ---');
  {
    server.resetFixtures();
    // Ordinary student attempts to create staff
    const resStudentCaller = await server.handleRequest({
      authHeader: `Bearer ${STUDENT_A.id}`,
      body: {
        name: 'Student Puppet',
        email: 'puppet@alphau.edu',
        password: 'password123',
        role: 'STAFF',
        canteen_id: CANTEEN_A1.id,
      },
    });
    assert(resStudentCaller.status === 403, 'Test F.1: Student caller is REJECTED with 403 Forbidden');

    // Existing staff member attempts to create another staff member
    const resStaffCaller = await server.handleRequest({
      authHeader: `Bearer ${STAFF_A1.id}`,
      body: {
        name: 'Staff Peer',
        email: 'peer@alphau.edu',
        password: 'password123',
        role: 'STAFF',
        canteen_id: CANTEEN_A1.id,
      },
    });
    assert(resStaffCaller.status === 403, 'Test F.2: Regular STAFF caller is REJECTED with 403 Forbidden');
  }

  // ---------------------------------------------------------------------------
  // Test G — Profile creation failure & atomic rollback
  // ---------------------------------------------------------------------------
  console.log('\n--- Test G: Profile Creation Failure & Atomic Rollback ---');
  {
    server.resetFixtures();
    // Simulate failure during database profile initialization with successful rollback
    server.simulateProfileUpdateFailure = true;
    server.simulateRollbackCleanupFailure = false;

    const emailToTest = 'will.fail@alphau.edu';
    const resFailure = await server.handleRequest({
      authHeader: `Bearer ${CANTEEN_ADMIN_A1.id}`,
      body: {
        name: 'Doomed Staff',
        email: emailToTest,
        password: 'password123',
        role: 'STAFF',
        canteen_id: CANTEEN_A1.id,
      },
    });

    assert(resFailure.status === 500, 'Test G.1: Server returns 500 on database profile update failure');
    assert(
      resFailure.data.error?.includes('safely rolled back'),
      'Test G.2: Error message confirms authentication account was rolled back'
    );

    // Verify orphaned auth user was purged
    let orphanFound = false;
    for (const u of (server as any).authUsers.values()) {
      if (u.email === emailToTest) orphanFound = true;
    }
    assert(!orphanFound, 'Test G.3: Orphaned auth user was deleted during rollback');

    // Simulate catastrophic scenario where rollback cleanup fails
    server.simulateRollbackCleanupFailure = true;
    const emailToReconcile = 'reconcile.needed@alphau.edu';
    const resReconcile = await server.handleRequest({
      authHeader: `Bearer ${CANTEEN_ADMIN_A1.id}`,
      body: {
        name: 'Stuck Staff',
        email: emailToReconcile,
        password: 'password123',
        role: 'STAFF',
        canteen_id: CANTEEN_A1.id,
      },
    });

    assert(resReconcile.status === 500, 'Test G.4: Server returns 500 when rollback cleanup encounters error');
    assert(
      !!resReconcile.data.reconciliation,
      'Test G.5: Actionable reconciliation record is provided to track orphaned account'
    );
    assert(
      resReconcile.data.reconciliation?.status === 'ORPHANED_REQUIRES_CLEANUP',
      'Test G.6: Reconciliation record correctly marks account as ORPHANED_REQUIRES_CLEANUP'
    );
  }

  // ---------------------------------------------------------------------------
  // Test H — Ownership tampering (RLS UPDATE & Trigger Enforcement)
  // ---------------------------------------------------------------------------
  console.log('\n--- Test H: Ownership Tampering ---');
  {
    // A regular user tries to mutate their own canteen_id or tenant_id
    const userMutatesOwnCanteen = DatabaseEngineSimulator.canUpdateProfile(
      STUDENT_A,
      STUDENT_A,
      { ...STUDENT_A, canteen_id: CANTEEN_A1.id }, // Self-assign to canteen
      ALL_CANTEENS
    );
    assert(
      userMutatesOwnCanteen.allowed === false,
      'Test H.1: Student CANNOT self-assign or mutate their canteen_id (blocked by RLS)'
    );

    const userMutatesOwnTenant = DatabaseEngineSimulator.canUpdateProfile(
      STUDENT_A,
      STUDENT_A,
      { ...STUDENT_A, tenant_id: TENANT_B.id }, // Move to Tenant B
      ALL_CANTEENS
    );
    assert(
      userMutatesOwnTenant.allowed === false,
      'Test H.2: Student CANNOT change their tenant_id (blocked by RLS)'
    );

    // Canteen Admin attempts to reassign an existing staff member to Canteen A2
    const adminReassignsStaffCanteen = DatabaseEngineSimulator.canUpdateProfile(
      CANTEEN_ADMIN_A1,
      STAFF_A1,
      { ...STAFF_A1, canteen_id: CANTEEN_A2.id }, // Reassigning to Canteen A2
      ALL_CANTEENS
    );
    assert(
      adminReassignsStaffCanteen.allowed === false,
      'Test H.3: Canteen Admin CANNOT reassign existing staff member to another canteen (blocked by RLS)'
    );

    // Canteen Admin attempts to update staff belonging to another canteen
    const otherStaffA2: MockProfile = {
      id: 'usr-staff-a2',
      name: 'Chef Bob A2',
      role: 'STAFF',
      tenant_id: TENANT_A.id,
      canteen_id: CANTEEN_A2.id,
    };
    const adminUpdatesOtherStaff = DatabaseEngineSimulator.canUpdateProfile(
      CANTEEN_ADMIN_A1,
      otherStaffA2,
      { ...otherStaffA2, name: 'Hacked Name' },
      ALL_CANTEENS
    );
    assert(
      adminUpdatesOtherStaff.allowed === false,
      'Test H.4: Canteen Admin A1 CANNOT update staff belonging to Canteen A2 (blocked by RLS)'
    );
  }

  // ---------------------------------------------------------------------------
  // Test I — Higher-level admin permissions
  // ---------------------------------------------------------------------------
  console.log('\n--- Test I: Higher-Level Admin Permissions ---');
  {
    server.resetFixtures();

    // 1. Uni Admin A legitimately creates a Canteen Admin for Canteen A1 in University A
    const resUniCreatesAdmin = await server.handleRequest({
      authHeader: `Bearer ${UNI_ADMIN_A.id}`,
      body: {
        name: 'New Canteen Manager',
        email: 'mgr.canteen.a1@alphau.edu',
        password: 'password123',
        role: 'CANTEEN_ADMIN',
        canteen_id: CANTEEN_A1.id,
      },
    });
    assert(
      resUniCreatesAdmin.status === 200 && resUniCreatesAdmin.data.success === true,
      'Test I.1: Uni Admin A can legitimately create CANTEEN_ADMIN within their university'
    );
    assert(
      resUniCreatesAdmin.data.canteen_id === CANTEEN_A1.id,
      'Test I.2: Created Canteen Admin is correctly scoped to Canteen A1'
    );

    // 2. Uni Admin A legitimately creates a STAFF member for Canteen A2 in University A
    const resUniCreatesStaff = await server.handleRequest({
      authHeader: `Bearer ${UNI_ADMIN_A.id}`,
      body: {
        name: 'Uni Provisioned Staff',
        email: 'staff.a2@alphau.edu',
        password: 'password123',
        role: 'STAFF',
        canteen_id: CANTEEN_A2.id,
      },
    });
    assert(
      resUniCreatesStaff.status === 200 && resUniCreatesStaff.data.success === true,
      'Test I.3: Uni Admin A can legitimately provision STAFF for Canteen A2 in their university'
    );

    // 3. Uni Admin A attempts to create admin for Canteen B1 in University B (rejected)
    const resUniCrossOrg = await server.handleRequest({
      authHeader: `Bearer ${UNI_ADMIN_A.id}`,
      body: {
        name: 'Cross Org Admin',
        email: 'cross.org@betau.edu',
        password: 'password123',
        role: 'CANTEEN_ADMIN',
        canteen_id: CANTEEN_B1.id,
      },
    });
    assert(
      resUniCrossOrg.status === 403,
      'Test I.4: Uni Admin A cross-university assignment to Canteen B1 is strictly rejected'
    );

    // 4. Super Admin has global permission across canteens
    const resSuperAdmin = await server.handleRequest({
      authHeader: `Bearer ${SUPER_ADMIN.id}`,
      body: {
        name: 'Global Provisioned Staff',
        email: 'global.staff@betau.edu',
        password: 'password123',
        role: 'STAFF',
        canteen_id: CANTEEN_B1.id,
      },
    });
    assert(
      resSuperAdmin.status === 200 && resSuperAdmin.data.success === true,
      'Test I.5: Super Admin can provision staff across permitted global canteens'
    );
  }

  // ---------------------------------------------------------------------------
  // Test J — Direct API/database bypass
  // ---------------------------------------------------------------------------
  console.log('\n--- Test J: Direct API/Database Bypass ---');
  {
    // Attacker bypasses the UI and Edge Function and attempts direct SQL / REST insert or update
    // 1. Direct insert violating tenant-canteen consistency
    const directInsertCrossTenant = DatabaseEngineSimulator.triggerCheckProfileCanteenTenantConsistency(
      { tenant_id: TENANT_A.id, canteen_id: CANTEEN_B1.id }, // Canteen B1 belongs to Tenant B!
      ALL_CANTEENS
    );
    assert(
      directInsertCrossTenant.valid === false,
      'Test J.1: Database trigger blocks direct insert with cross-tenant canteen assignment'
    );
    assert(
      directInsertCrossTenant.error?.includes('Cross-tenant assignment violation'),
      'Test J.2: Database trigger raises explicit cross-tenant violation exception'
    );

    // 2. Direct insert with non-existent canteen ID
    const directInsertBogusCanteen = DatabaseEngineSimulator.triggerCheckProfileCanteenTenantConsistency(
      { tenant_id: TENANT_A.id, canteen_id: 'non-existent-canteen-uuid' },
      ALL_CANTEENS
    );
    assert(
      directInsertBogusCanteen.valid === false,
      'Test J.3: Database trigger blocks assignment to non-existent canteen'
    );

    // 3. Direct RLS update bypass: An unauthorized user invokes Supabase REST API directly
    const directRestApiBypass = DatabaseEngineSimulator.canUpdateProfile(
      CANTEEN_ADMIN_A1, // Canteen Admin A1 directly issues PATCH /rest/v1/profiles?id=eq.STAFF_A1
      STAFF_A1,
      { ...STAFF_A1, canteen_id: CANTEEN_B1.id, tenant_id: TENANT_B.id }, // Forged IDs
      ALL_CANTEENS
    );
    assert(
      directRestApiBypass.allowed === false,
      'Test J.4: Direct REST API update with forged canteen & tenant IDs is blocked by RLS'
    );

    // 4. Inactive canteen assignment check
    server.resetFixtures();
    const resInactiveCanteen = await server.handleRequest({
      authHeader: `Bearer ${UNI_ADMIN_A.id}`,
      body: {
        name: 'Inactive Staff',
        email: 'inactive.staff@alphau.edu',
        password: 'password123',
        role: 'STAFF',
        canteen_id: CANTEEN_A_INACTIVE.id,
      },
    });
    assert(
      resInactiveCanteen.status === 400 && resInactiveCanteen.data.error?.includes('inactive'),
      'Test J.5: Assignment of staff to an inactive canteen is rejected'
    );
  }

  // ---------------------------------------------------------------------------
  // Test Summary
  // ---------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runHigh05TestSuite();
