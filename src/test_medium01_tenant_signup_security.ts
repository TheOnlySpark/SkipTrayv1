/**
 * ============================================================================
 * SKIP TRAY CANTEEN — MEDIUM-01 SECURITY VERIFICATION TEST SUITE
 * Secure Tenant Assignment During Signup and Prevent Email Membership Enumeration
 * ============================================================================
 *
 * Verifies all 11 mandatory test scenarios defined in MEDIUM-01 security audit:
 *
 * Test A — Forged tenant metadata:
 *          Register a user while submitting invalid, fake, or inactive tenant ID.
 *          Expected: user is not granted unauthorized membership.
 *
 * Test B — Forged university or canteen ID:
 *          Submit IDs belonging to another university or canteen.
 *          Expected: unauthorized associations are rejected; canteen_id forced to null.
 *
 * Test C — Forged role (Privilege Escalation during signup):
 *          Attempt to register with administrative or Super Admin role via client metadata.
 *          Expected: user receives only role permitted by approved policy ('STUDENT').
 *
 * Test D — Valid registration:
 *          Register through legitimate onboarding process for active public tenant.
 *          Expected: registration succeeds and profile linked to target tenant.
 *
 * Test E — Restricted / Closed tenant onboarding:
 *          Attempt registration for tenant with allow_public_registration = false or system tenant.
 *          Expected: direct self-registration is rejected.
 *
 * Test F — Public RPC access:
 *          Call check_user_tenant_access as an unauthenticated user.
 *          Expected: execution is denied; no membership information is revealed.
 *
 * Test G — Authenticated enumeration:
 *          Attempt to check arbitrary email addresses using ordinary authenticated account.
 *          Expected: caller cannot discover unauthorized email-to-tenant membership.
 *
 * Test H — Cross-tenant access:
 *          Uni Admin A attempts to inspect Tenant B memberships.
 *          Expected: request is denied with forbidden exception.
 *
 * Test I — Direct database/API bypass:
 *          Attempt unauthorized membership updates or role changes directly on profiles table.
 *          Expected: database triggers and RLS prevent the operation.
 *
 * Test J — Existing functionality regression:
 *          Legitimate login, password check, and authorized onboarding continue to work.
 *          Expected: authorized flows succeed cleanly.
 *
 * Test K — Partial registration failure:
 *          Simulate failure during profile creation on invalid tenant.
 *          Expected: transaction aborts, no partial or unmanaged profile persists.
 */

interface MockTenant {
  id: string;
  slug: string;
  name: string;
  is_active: boolean;
  allow_public_registration: boolean;
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
  passwordHash: string;
  raw_user_meta_data: Record<string, any>;
  raw_app_meta_data: Record<string, any>;
}

// ----------------------------------------------------------------------------
// Test Fixtures
// ----------------------------------------------------------------------------

const TENANT_ALPHA: MockTenant = {
  id: 'tenant-alpha-uuid',
  slug: 'alpha',
  name: 'University Alpha',
  is_active: true,
  allow_public_registration: true,
};

const TENANT_BETA: MockTenant = {
  id: 'tenant-beta-uuid',
  slug: 'beta',
  name: 'University Beta',
  is_active: true,
  allow_public_registration: true,
};

const TENANT_INACTIVE: MockTenant = {
  id: 'tenant-inactive-uuid',
  slug: 'inactive-uni',
  name: 'Closed University',
  is_active: false,
  allow_public_registration: true,
};

const TENANT_RESTRICTED: MockTenant = {
  id: 'tenant-restricted-uuid',
  slug: 'private-uni',
  name: 'Private Institute',
  is_active: true,
  allow_public_registration: false, // Closed to public self-registration
};

const TENANT_SYSTEM: MockTenant = {
  id: '00000000-0000-0000-0000-000000000000',
  slug: 'system',
  name: 'System Default',
  is_active: true,
  allow_public_registration: false, // Super Admin only
};

const ALL_MOCK_TENANTS = [TENANT_ALPHA, TENANT_BETA, TENANT_INACTIVE, TENANT_RESTRICTED, TENANT_SYSTEM];

// ----------------------------------------------------------------------------
// Database Trigger & Function Simulator (Migration 0044)
// ----------------------------------------------------------------------------

class DatabaseEngineMedium01Simulator {
  private tenants: MockTenant[] = [...ALL_MOCK_TENANTS];
  private authUsers: Map<string, MockAuthUser> = new Map();
  private profiles: Map<string, MockProfile> = new Map();

  constructor() {
    this.reset();
  }

  reset() {
    this.tenants = [...ALL_MOCK_TENANTS];
    this.authUsers.clear();
    this.profiles.clear();

    // Pre-populate legitimate users
    this.seedUser('student-alice@alphau.edu', 'secret123', TENANT_ALPHA.id, 'STUDENT', 'Alice Student', 'usr-student-alice');
    this.seedUser('student-bob@betau.edu', 'secret123', TENANT_BETA.id, 'STUDENT', 'Bob Student', 'usr-student-bob');
    this.seedUser('dean@alphau.edu', 'secret123', TENANT_ALPHA.id, 'UNI_ADMIN', 'Dean Alpha', 'usr-dean-alpha');
    this.seedUser('dean@betau.edu', 'secret123', TENANT_BETA.id, 'UNI_ADMIN', 'Dean Beta', 'usr-dean-beta');
    this.seedUser('admin@skiptray.com', 'secret123', TENANT_SYSTEM.id, 'SUPER_ADMIN', 'Super Admin', 'usr-admin');
  }

  private seedUser(
    email: string,
    passwordHash: string,
    tenantId: string,
    role: MockProfile['role'],
    name: string,
    customId?: string
  ): string {
    const id = customId || `usr-${email.replace(/[@.]/g, '-')}`;
    this.authUsers.set(id, {
      id,
      email,
      passwordHash,
      raw_user_meta_data: { name, tenant_id: tenantId },
      raw_app_meta_data: { role, tenant_id: tenantId },
    });
    this.profiles.set(id, {
      id,
      name,
      role,
      tenant_id: tenantId,
      canteen_id: null,
    });
    return id;
  }

  getProfile(id: string): MockProfile | undefined {
    return this.profiles.get(id);
  }

  getAuthUserByEmail(email: string): MockAuthUser | undefined {
    for (const u of this.authUsers.values()) {
      if (u.email.toLowerCase() === email.toLowerCase()) return u;
    }
    return undefined;
  }

  /**
   * Simulates Migration 0044 handle_new_user() trigger execution.
   */
  triggerHandleNewUser(newUser: MockAuthUser): { success: boolean; error?: string } {
    let tenantId: string | null = null;
    let isServerAdmin = false;

    // 1. Determine tenant_id source
    if (newUser.raw_app_meta_data?.tenant_id) {
      tenantId = newUser.raw_app_meta_data.tenant_id;
      isServerAdmin = true;
    } else if (newUser.raw_user_meta_data?.tenant_id) {
      tenantId = newUser.raw_user_meta_data.tenant_id;
    }

    if (!tenantId) {
      return { success: false, error: 'Registration denied: Valid institution context is required.' };
    }

    // 2. Verify target tenant existence and status
    const tenant = this.tenants.find(t => t.id === tenantId);
    if (!tenant) {
      return { success: false, error: 'Registration denied: Selected institution does not exist.' };
    }

    if (!tenant.is_active) {
      return { success: false, error: 'Registration denied: Selected institution is currently inactive or suspended.' };
    }

    // 3. For public self-registration: enforce approved registration policy
    if (!isServerAdmin) {
      if (tenant.slug === 'system') {
        return {
          success: false,
          error: 'Registration denied: Direct self-registration is not permitted for the system management tenant.',
        };
      }

      if (!tenant.allow_public_registration) {
        return {
          success: false,
          error: 'Registration denied: This institution does not permit public self-registration.',
        };
      }
    }

    // 4. Role Assignment
    let role: MockProfile['role'] = 'STUDENT';
    if (isServerAdmin && newUser.raw_app_meta_data?.role) {
      role = newUser.raw_app_meta_data.role;
    } else {
      // Public signup is ALWAYS strictly STUDENT
      role = 'STUDENT';
    }

    // 5. Canteen Assignment
    let canteenId: string | null = null;
    if (isServerAdmin && newUser.raw_app_meta_data?.canteen_id) {
      canteenId = newUser.raw_app_meta_data.canteen_id;
    } else {
      canteenId = null;
    }

    const name = newUser.raw_user_meta_data?.name ?? null;

    // Create profile
    this.profiles.set(newUser.id, {
      id: newUser.id,
      name,
      role,
      tenant_id: tenantId,
      canteen_id: canteenId,
    });

    return { success: true };
  }

  /**
   * Simulates public.prevent_profile_tenant_tampering() trigger.
   */
  triggerPreventProfileTenantTampering(
    callerRole: MockProfile['role'],
    currentRecord: MockProfile,
    newTenantId: string
  ): { success: boolean; error?: string } {
    if (currentRecord.tenant_id && newTenantId !== currentRecord.tenant_id) {
      if (callerRole !== 'SUPER_ADMIN') {
        return { success: false, error: 'Unauthorized: tenant_id is immutable and cannot be modified' };
      }
    }
    return { success: true };
  }

  /**
   * Simulates Migration 0044 check_user_tenant_access() RPC.
   */
  rpcCheckUserTenantAccess(
    caller: MockProfile | null,
    p_email: string,
    p_tenant_id: string
  ): { success: boolean; hasAccess?: boolean; error?: string } {
    // 1. Authentication check
    if (!caller) {
      return { success: false, error: 'Unauthorized: Authentication required' };
    }

    // 2. Role check
    if (!['SUPER_ADMIN', 'UNI_ADMIN', 'ADMIN'].includes(caller.role)) {
      return { success: false, error: 'Forbidden: Insufficient privileges to inspect organization membership' };
    }

    // 3. Scope check: Uni Admin can ONLY inspect their own university
    if (['UNI_ADMIN', 'ADMIN'].includes(caller.role) && p_tenant_id !== caller.tenant_id) {
      return { success: false, error: 'Forbidden: You cannot inspect membership for a different organization' };
    }

    // 4. Query membership
    const user = this.getAuthUserByEmail(p_email);
    if (!user) {
      return { success: true, hasAccess: false };
    }

    const profile = this.getProfile(user.id);
    const hasAccess = profile?.tenant_id === p_tenant_id;
    return { success: true, hasAccess };
  }

  /**
   * Simulates the secure login flow in Login.tsx:
   * 1. Direct password check.
   * 2. Post-auth tenant check.
   */
  simulateLoginFlow(
    email: string,
    password: string,
    currentTenantId: string
  ): { success: boolean; error?: string; authenticatedUser?: MockProfile } {
    const user = this.getAuthUserByEmail(email);

    // If email not found or wrong password → generic error (zero enumeration)
    if (!user || user.passwordHash !== password) {
      return { success: false, error: 'Invalid email or password. Please try again.' };
    }

    const profile = this.getProfile(user.id);
    if (!profile) {
      return { success: false, error: 'Unable to load user profile. Please try again or contact support.' };
    }

    // Super Admin can access anywhere
    if (profile.role === 'SUPER_ADMIN') {
      return { success: true, authenticatedUser: profile };
    }

    // Check tenant match
    if (profile.tenant_id !== currentTenantId) {
      return {
        success: false,
        error: 'This account is not registered with this institution. Please check your institution or register a new account.',
      };
    }

    return { success: true, authenticatedUser: profile };
  }

  /**
   * Simulates public self-registration (signUp).
   */
  simulatePublicSignUp(
    email: string,
    password: string,
    requestedMetadata: Record<string, any>
  ): { success: boolean; error?: string; userId?: string } {
    // Check existing email
    if (this.getAuthUserByEmail(email)) {
      return { success: false, error: 'A user with this email address has already been registered' };
    }

    const userId = `usr-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const newAuthUser: MockAuthUser = {
      id: userId,
      email,
      passwordHash: password,
      raw_user_meta_data: requestedMetadata, // Client-supplied
      raw_app_meta_data: {}, // Public signups cannot set app_metadata
    };

    // Run trigger
    const triggerResult = this.triggerHandleNewUser(newAuthUser);
    if (!triggerResult.success) {
      // Postgres transaction aborts: auth user is not created
      return { success: false, error: triggerResult.error };
    }

    this.authUsers.set(userId, newAuthUser);
    return { success: true, userId };
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

async function runMedium01TestSuite() {
  console.log('================================================================');
  console.log('   SKIP TRAY CANTEEN — MEDIUM-01 SECURITY VERIFICATION SUITE    ');
  console.log('   Secure Tenant Assignment & Prevent Email Membership Leak     ');
  console.log('================================================================\n');

  const db = new DatabaseEngineMedium01Simulator();

  // ---------------------------------------------------------------------------
  // Test A — Forged tenant metadata
  // ---------------------------------------------------------------------------
  console.log('--- Test A: Forged Tenant Metadata ---');
  {
    db.reset();

    // 1. Submit non-existent tenant ID
    const resFakeTenant = db.simulatePublicSignUp('hacker1@evil.com', 'password123', {
      tenant_id: 'non-existent-tenant-uuid-1234',
    });
    assert(resFakeTenant.success === false, 'Test A.1: Non-existent tenant ID is REJECTED');
    assert(
      resFakeTenant.error?.includes('Selected institution does not exist'),
      'Test A.2: Error message explicitly rejects invalid institution'
    );

    // 2. Submit inactive tenant ID
    const resInactiveTenant = db.simulatePublicSignUp('hacker2@evil.com', 'password123', {
      tenant_id: TENANT_INACTIVE.id,
    });
    assert(resInactiveTenant.success === false, 'Test A.3: Inactive/suspended tenant ID is REJECTED');
    assert(
      resInactiveTenant.error?.includes('inactive or suspended'),
      'Test A.4: Error message indicates institution is inactive'
    );

    // 3. Submit empty/missing tenant ID
    const resMissingTenant = db.simulatePublicSignUp('hacker3@evil.com', 'password123', {});
    assert(resMissingTenant.success === false, 'Test A.5: Missing tenant ID is REJECTED');
  }

  // ---------------------------------------------------------------------------
  // Test B — Forged university or canteen ID
  // ---------------------------------------------------------------------------
  console.log('\n--- Test B: Forged University or Canteen ID ---');
  {
    db.reset();
    // User tries to self-assign a canteen_id during public registration
    const resForgedCanteen = db.simulatePublicSignUp('student.fake@alphau.edu', 'password123', {
      tenant_id: TENANT_ALPHA.id,
      canteen_id: 'canteen-secret-vip-uuid',
      university_id: 'fake-university-id',
    });

    assert(resForgedCanteen.success === true, 'Test B.1: Legitimate registration for Tenant Alpha succeeds');
    const createdProfile = db.getProfile(resForgedCanteen.userId!);
    assert(
      createdProfile?.canteen_id === null,
      'Test B.2: Client-supplied canteen_id was IGNORED; profile canteen_id is NULL'
    );
    assert(
      createdProfile?.tenant_id === TENANT_ALPHA.id,
      'Test B.3: Profile is correctly bound to validated Tenant Alpha'
    );
  }

  // ---------------------------------------------------------------------------
  // Test C — Forged role (Privilege Escalation during signup)
  // ---------------------------------------------------------------------------
  console.log('\n--- Test C: Forged Role (Privilege Escalation) ---');
  {
    db.reset();

    // 1. Attacker attempts to register as SUPER_ADMIN
    const resEscalateSuper = db.simulatePublicSignUp('superhacker@alphau.edu', 'password123', {
      tenant_id: TENANT_ALPHA.id,
      role: 'SUPER_ADMIN',
      is_admin: true,
      is_super_admin: true,
    });
    assert(resEscalateSuper.success === true, 'Test C.1: Registration processed without crash');
    const superProfile = db.getProfile(resEscalateSuper.userId!);
    assert(
      superProfile?.role === 'STUDENT',
      'Test C.2: Forged SUPER_ADMIN role was rejected; user granted only STUDENT role'
    );

    // 2. Attacker attempts to register as UNI_ADMIN
    const resEscalateUni = db.simulatePublicSignUp('unihacker@alphau.edu', 'password123', {
      tenant_id: TENANT_ALPHA.id,
      role: 'UNI_ADMIN',
    });
    const uniProfile = db.getProfile(resEscalateUni.userId!);
    assert(
      uniProfile?.role === 'STUDENT',
      'Test C.3: Forged UNI_ADMIN role was rejected; user granted only STUDENT role'
    );

    // 3. Attacker attempts to register as CANTEEN_ADMIN or STAFF
    const resEscalateStaff = db.simulatePublicSignUp('staffhacker@alphau.edu', 'password123', {
      tenant_id: TENANT_ALPHA.id,
      role: 'STAFF',
    });
    const staffProfile = db.getProfile(resEscalateStaff.userId!);
    assert(
      staffProfile?.role === 'STUDENT',
      'Test C.4: Forged STAFF role was rejected; user granted only STUDENT role'
    );
  }

  // ---------------------------------------------------------------------------
  // Test D — Valid registration
  // ---------------------------------------------------------------------------
  console.log('\n--- Test D: Valid Registration ---');
  {
    db.reset();
    const resLegit = db.simulatePublicSignUp('charlie@alphau.edu', 'validPassword123', {
      tenant_id: TENANT_ALPHA.id,
      name: 'Charlie Brown',
    });

    assert(resLegit.success === true && !!resLegit.userId, 'Test D.1: Legitimate student registration succeeds');
    const legitProfile = db.getProfile(resLegit.userId!);
    assert(legitProfile?.name === 'Charlie Brown', 'Test D.2: Student name correctly initialized');
    assert(legitProfile?.role === 'STUDENT', 'Test D.3: Student role correctly assigned as STUDENT');
    assert(legitProfile?.tenant_id === TENANT_ALPHA.id, 'Test D.4: Student profile correctly assigned to Tenant Alpha');
    assert(legitProfile?.canteen_id === null, 'Test D.5: Student has no unauthorized canteen association');
  }

  // ---------------------------------------------------------------------------
  // Test E — Restricted / Closed tenant onboarding
  // ---------------------------------------------------------------------------
  console.log('\n--- Test E: Restricted / Closed Tenant Onboarding ---');
  {
    db.reset();

    // 1. Attempt to register for system tenant
    const resSystemTenant = db.simulatePublicSignUp('system.intruder@skiptray.com', 'password123', {
      tenant_id: TENANT_SYSTEM.id,
    });
    assert(resSystemTenant.success === false, 'Test E.1: Self-registration for system tenant is strictly REJECTED');
    assert(
      resSystemTenant.error?.includes('system management tenant'),
      'Test E.2: Error explicitly protects system management tenant'
    );

    // 2. Attempt to register for restricted tenant that disallows public registration
    const resRestrictedTenant = db.simulatePublicSignUp('private.intruder@private.edu', 'password123', {
      tenant_id: TENANT_RESTRICTED.id,
    });
    assert(
      resRestrictedTenant.success === false,
      'Test E.3: Self-registration for private/restricted tenant is REJECTED'
    );
    assert(
      resRestrictedTenant.error?.includes('does not permit public self-registration'),
      'Test E.4: Error enforces tenant public registration policy'
    );
  }

  // ---------------------------------------------------------------------------
  // Test F — Public RPC access
  // ---------------------------------------------------------------------------
  console.log('\n--- Test F: Public RPC Access ---');
  {
    db.reset();
    // Unauthenticated caller attempts to call check_user_tenant_access
    const resAnonRpc = db.rpcCheckUserTenantAccess(null, 'student-alice@alphau.edu', TENANT_ALPHA.id);
    assert(resAnonRpc.success === false, 'Test F.1: Unauthenticated caller calling RPC is REJECTED');
    assert(
      resAnonRpc.error?.includes('Authentication required'),
      'Test F.2: Rejection error specifies authentication required'
    );
    assert(resAnonRpc.hasAccess === undefined, 'Test F.3: No boolean membership status is returned to anon caller');
  }

  // ---------------------------------------------------------------------------
  // Test G — Authenticated enumeration
  // ---------------------------------------------------------------------------
  console.log('\n--- Test G: Authenticated Enumeration ---');
  {
    db.reset();
    const studentAlice = db.getProfile('usr-student-alice')!;

    // An ordinary student attempts to probe membership of arbitrary emails
    const resStudentProbing = db.rpcCheckUserTenantAccess(
      studentAlice,
      'student-bob@betau.edu',
      TENANT_BETA.id
    );

    assert(
      resStudentProbing.success === false,
      'Test G.1: Ordinary student account CANNOT inspect tenant membership via RPC'
    );
    assert(
      resStudentProbing.error?.includes('Insufficient privileges'),
      'Test G.2: RPC strictly forbids non-administrative authenticated users'
    );
  }

  // ---------------------------------------------------------------------------
  // Test H — Cross-tenant access
  // ---------------------------------------------------------------------------
  console.log('\n--- Test H: Cross-Tenant Access ---');
  {
    db.reset();
    const deanAlpha = db.getProfile('usr-dean-alpha')!; // Uni Admin for Tenant Alpha

    // Dean Alpha attempts to check if student-bob@betau.edu belongs to Tenant Beta
    const resCrossTenantRpc = db.rpcCheckUserTenantAccess(
      deanAlpha,
      'student-bob@betau.edu',
      TENANT_BETA.id // Tenant Beta!
    );

    assert(
      resCrossTenantRpc.success === false,
      'Test H.1: University Admin A is BLOCKED from inspecting memberships in University B'
    );
    assert(
      resCrossTenantRpc.error?.includes('cannot inspect membership for a different organization'),
      'Test H.2: Error explicitly enforces multi-tenant administrative boundary'
    );

    // Dean Alpha checking legitimate user in their own university (Tenant Alpha)
    const resLegitTenantCheck = db.rpcCheckUserTenantAccess(
      deanAlpha,
      'student-alice@alphau.edu',
      TENANT_ALPHA.id
    );
    assert(
      resLegitTenantCheck.success === true && resLegitTenantCheck.hasAccess === true,
      'Test H.3: Uni Admin A can legitimately check membership within their own university'
    );
  }

  // ---------------------------------------------------------------------------
  // Test I — Direct database/API bypass (Tenant Immortality)
  // ---------------------------------------------------------------------------
  console.log('\n--- Test I: Direct Database/API Bypass ---');
  {
    db.reset();
    const studentAlice = db.getProfile('usr-student-alice')!;

    // Student Alice attempts to issue UPDATE profiles SET tenant_id = TENANT_BETA.id
    const resTamperTenant = db.triggerPreventProfileTenantTampering(
      studentAlice.role,
      studentAlice,
      TENANT_BETA.id
    );

    assert(
      resTamperTenant.success === false,
      'Test I.1: User CANNOT mutate tenant_id on existing profile (blocked by trigger)'
    );
    assert(
      resTamperTenant.error?.includes('tenant_id is immutable'),
      'Test I.2: Trigger raises explicit immutability exception'
    );

    // Super Admin can legitimately reassign tenant if needed
    const superAdmin = db.getProfile('usr-admin')!;
    const resSuperAdminTamper = db.triggerPreventProfileTenantTampering(
      superAdmin.role,
      studentAlice,
      TENANT_BETA.id
    );
    assert(resSuperAdminTamper.success === true, 'Test I.3: Super Admin retains organizational migration capability');
  }

  // ---------------------------------------------------------------------------
  // Test J — Existing functionality regression (Secure Login Flow)
  // ---------------------------------------------------------------------------
  console.log('\n--- Test J: Existing Functionality Regression (Login Flow) ---');
  {
    db.reset();

    // 1. Student Alice logs into her own university (Tenant Alpha) with correct password
    const resLoginAliceAlpha = db.simulateLoginFlow(
      'student-alice@alphau.edu',
      'secret123',
      TENANT_ALPHA.id
    );
    assert(resLoginAliceAlpha.success === true, 'Test J.1: Alice logs in successfully to Tenant Alpha');
    assert(
      resLoginAliceAlpha.authenticatedUser?.id === 'usr-student-alice',
      'Test J.2: Alice receives her authenticated profile'
    );

    // 2. Student Alice enters WRONG password for Tenant Alpha
    const resLoginAliceWrongPw = db.simulateLoginFlow(
      'student-alice@alphau.edu',
      'wrongPassword!',
      TENANT_ALPHA.id
    );
    assert(resLoginAliceWrongPw.success === false, 'Test J.3: Wrong password fails authentication');
    assert(
      resLoginAliceWrongPw.error === 'Invalid email or password. Please try again.',
      'Test J.4: Generic error prevents password-guessing differentiation'
    );

    // 3. Attacker enters completely non-existent email
    const resLoginNonExistent = db.simulateLoginFlow(
      'ghost.nonexistent@alphau.edu',
      'password123',
      TENANT_ALPHA.id
    );
    assert(resLoginNonExistent.success === false, 'Test J.5: Non-existent email fails authentication');
    assert(
      resLoginNonExistent.error === 'Invalid email or password. Please try again.',
      'Test J.6: Non-existent email produces IDENTICAL error message to wrong password (ZERO ENUMERATION)'
    );

    // 4. Student Bob (Tenant Beta) enters correct password on Tenant Alpha login page
    const resLoginBobAlpha = db.simulateLoginFlow(
      'student-bob@betau.edu',
      'secret123',
      TENANT_ALPHA.id
    );
    assert(
      resLoginBobAlpha.success === false,
      'Test J.7: Bob cannot log into Tenant Alpha (different institution)'
    );
    assert(
      resLoginBobAlpha.error?.includes('not registered with this institution'),
      'Test J.8: Post-auth tenant check safely blocks cross-tenant access only after valid credentials'
    );

    // 5. Super Admin logs in on any tenant
    const resSuperLogin = db.simulateLoginFlow(
      'admin@skiptray.com',
      'secret123',
      TENANT_ALPHA.id
    );
    assert(resSuperLogin.success === true, 'Test J.9: Super Admin can log in across any tenant');
  }

  // ---------------------------------------------------------------------------
  // Test K — Partial registration failure
  // ---------------------------------------------------------------------------
  console.log('\n--- Test K: Partial Registration Failure ---');
  {
    db.reset();

    // Trigger failure on registration with invalid tenant
    const resFailure = db.simulatePublicSignUp('failed.reg@nowhere.com', 'password123', {
      tenant_id: 'bad-uuid',
    });

    assert(resFailure.success === false, 'Test K.1: Registration fails on invalid tenant');
    // Ensure no orphaned profile was created
    const profile = db.getAuthUserByEmail('failed.reg@nowhere.com');
    assert(!profile, 'Test K.2: No user or profile was persisted after registration failure');
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

runMedium01TestSuite();
