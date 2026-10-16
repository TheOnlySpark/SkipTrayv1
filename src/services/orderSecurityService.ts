/**
 * SKIP TRAY CANTEEN — SECURE ORDER SECURITY & OTP VERIFICATION SERVICE
 * 
 * Enforces:
 * 1. Strict Order-Status Transitions (PLACED -> ACCEPTED -> PREPARING -> READY -> COLLECTED)
 * 2. Zero Database Storage of OTPs (Plaintext, Encrypted, or Reversible)
 * 3. Short-Lived Ephemeral Challenge Store (Redis or In-Memory) with Keyed HMAC
 * 4. HMAC Secret Isolated Outside Database in Server Environment Configuration
 * 5. Strict 5-Minute Expiration and 5-Attempt Lockout
 * 6. 60-Second Resend Cooldown and Challenge Invalidation on Resend
 * 7. Multi-Tenant and Canteen Authorization Scoping
 * 8. Atomic Single-Use Consumption and Replay Prevention
 * 9. Non-Sensitive Audit Logging (Never Logging or Persisting Secrets)
 */

import crypto from 'node:crypto';

export interface OrderState {
  id: string;
  user_id: string;
  tenant_id: string;
  canteen_id: string;
  status: 'PLACED' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'COLLECTED' | 'REJECTED';
  pickup_time: string;
  otp_attempts: number;
  created_at: Date;
  accepted_at?: Date | null;
  preparation_started_at?: Date | null;
  ready_at?: Date | null;
  collected_at?: Date | null;
  payment_id?: string | null;
  idempotency_key?: string;
}

export interface SecurityUserContext {
  uid: string;
  role: 'STUDENT' | 'TEACHER' | 'STAFF' | 'CANTEEN_ADMIN' | 'UNI_ADMIN' | 'SUPER_ADMIN';
  tenant_id: string;
  canteen_id: string | null;
  email?: string;
}

export interface EphemeralOtpChallenge {
  challengeId: string;
  orderId: string;
  customerId: string;
  tenantId: string;
  canteenId: string;
  keyedHmac: string;
  createdAt: number;
  expiresAt: number;
  resendAvailableAt: number;
  attempts: number;
  maxAttempts: number;
  status: 'ACTIVE' | 'VERIFIED' | 'EXPIRED' | 'LOCKED' | 'SUPERSEDED';
}

export interface SecurityAuditRecord {
  id: string;
  orderId: string;
  actorId: string;
  actorRole: string;
  eventType: string;
  previousStatus?: string | null;
  newStatus?: string | null;
  details?: Record<string, any>;
  timestamp: Date;
}

// Global server configuration for HMAC and security
const OTP_HMAC_SECRET = process.env.OTP_HMAC_SECRET || 'skiptray-secure-ephemeral-hmac-secret-v1-2026';
const OTP_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
const MAX_OTP_ATTEMPTS = 5;

export class OrderSecurityService {
  // Server-side ephemeral store (Redis or in-memory)
  // CRITICAL: Stored in memory ONLY. Never persisted to any database table or disk.
  private ephemeralStore = new Map<string, EphemeralOtpChallenge>();
  
  // Non-sensitive audit trail
  private auditLog: SecurityAuditRecord[] = [];

  // Active sweep timer
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Periodically purge expired challenges from server memory
    this.cleanupInterval = setInterval(() => this.purgeExpiredChallenges(), 60 * 1000);
  }

  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  // --------------------------------------------------------------------------
  // Cryptographic Helpers
  // --------------------------------------------------------------------------

  /**
   * Generates a cryptographically secure, unpredictable 6-digit OTP.
   * Uses trusted server-side crypto.randomBytes with rejection sampling to eliminate modulo bias.
   */
  public static generateCryptographicOtp(): string {
    const min = 100000;
    const max = 999999;
    const range = max - min + 1;
    const maxValid = Math.floor(0xffffffff / range) * range;

    let num: number;
    do {
      num = crypto.randomBytes(4).readUInt32BE(0);
    } while (num >= maxValid);

    return (min + (num % range)).toString();
  }

  /**
   * Computes a keyed HMAC-SHA256 of the OTP bound to order and customer.
   * HMAC secret is kept in server environment configuration outside the database.
   */
  public static computeKeyedHmac(otp: string, orderId: string, customerId: string): string {
    const payload = `${otp}:${orderId}:${customerId}:COLLECTION`;
    return crypto.createHmac('sha256', OTP_HMAC_SECRET).update(payload).digest('hex');
  }

  /**
   * Constant-time comparison between submitted HMAC and stored challenge HMAC.
   * Prevents timing side-channel attacks.
   */
  public static timingSafeVerify(submittedHmac: string, challengeHmac: string): boolean {
    const a = Buffer.from(submittedHmac, 'hex');
    const b = Buffer.from(challengeHmac, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  // --------------------------------------------------------------------------
  // State Machine Validation
  // --------------------------------------------------------------------------

  /**
   * Enforces server-side transition state machine:
   * PLACED -> ACCEPTED -> PREPARING -> READY -> COLLECTED
   */
  public validateTransition(
    currentStatus: OrderState['status'],
    targetStatus: OrderState['status'],
    isOtpVerified: boolean = false
  ): { valid: boolean; error?: string } {
    if (['COLLECTED', 'REJECTED'].includes(currentStatus)) {
      return { valid: false, error: `Order is in terminal status (${currentStatus}) and cannot transition further` };
    }

    if (currentStatus === targetStatus) {
      return { valid: true };
    }

    // Normal workflow
    if (currentStatus === 'PLACED') {
      if (['ACCEPTED', 'REJECTED'].includes(targetStatus)) return { valid: true };
      return { valid: false, error: `Invalid transition from PLACED to ${targetStatus}. Expected ACCEPTED or REJECTED.` };
    }

    if (currentStatus === 'ACCEPTED') {
      if (['PREPARING', 'REJECTED'].includes(targetStatus)) return { valid: true };
      return { valid: false, error: `Invalid transition from ACCEPTED to ${targetStatus}. Expected PREPARING or REJECTED.` };
    }

    if (currentStatus === 'PREPARING') {
      if (targetStatus === 'READY') return { valid: true };
      return { valid: false, error: `Invalid transition from PREPARING to ${targetStatus}. Expected READY.` };
    }

    if (currentStatus === 'READY') {
      if (targetStatus === 'COLLECTED') {
        if (!isOtpVerified) {
          return { valid: false, error: 'Direct transition to COLLECTED is prohibited. Orders must be collected via verified pickup OTP.' };
        }
        return { valid: true };
      }
      if (targetStatus === 'REJECTED') return { valid: true }; // No-show penalty path
      return { valid: false, error: `Invalid transition from READY to ${targetStatus}. Expected COLLECTED via OTP verification.` };
    }

    return { valid: false, error: `Unknown status transition from ${currentStatus} to ${targetStatus}` };
  }

  // --------------------------------------------------------------------------
  // Ephemeral Challenge Management
  // --------------------------------------------------------------------------

  /**
   * Customer initiates collection OTP request for their own READY order.
   * Returns non-sensitive challenge metadata and dispatches OTP to customer contact channel.
   * NEVER returns OTP in API response or persists it in database!
   */
  public requestCollectionOtp(
    caller: SecurityUserContext,
    order: OrderState,
    dispatchChannelFn?: (customerId: string, otp: string) => Promise<void> | void
  ): {
    success: boolean;
    challengeId?: string;
    expiresAt?: number;
    resendAvailableAt?: number;
    message: string;
    cooldownActive?: boolean;
    otpForTestOnly?: string; // Only populated in controlled test environment if needed
  } {
    // 1. Authorization: Only customer who owns order
    if (caller.uid !== order.user_id) {
      this.recordAudit(order.id, caller.uid, caller.role, 'UNAUTHORIZED_OTP_REQUEST', order.status, order.status, {
        attempted_by: caller.uid,
        owner: order.user_id,
      });
      return { success: false, message: 'Access denied: You can only request pickup OTP for your own order.' };
    }

    // 2. State gate: Order must be READY
    if (order.status !== 'READY') {
      return {
        success: false,
        message: `Order is not ready for pickup (current status: ${order.status}). Collection OTP can only be requested for READY orders.`,
      };
    }

    const now = Date.now();
    const existing = this.ephemeralStore.get(order.id);

    // 3. Resend cooldown check
    if (existing && existing.status === 'ACTIVE' && now < existing.resendAvailableAt) {
      const waitSeconds = Math.ceil((existing.resendAvailableAt - now) / 1000);
      return {
        success: false,
        message: `Resend cooldown active. Please wait ${waitSeconds} seconds before requesting a new OTP.`,
        expiresAt: existing.expiresAt,
        resendAvailableAt: existing.resendAvailableAt,
        cooldownActive: true,
      };
    }

    // 4. Invalidate previous challenge if requesting new one
    if (existing && existing.status === 'ACTIVE') {
      existing.status = 'SUPERSEDED';
    }

    // 5. Generate cryptographically unpredictable OTP
    const rawOtp = OrderSecurityService.generateCryptographicOtp();
    const keyedHmac = OrderSecurityService.computeKeyedHmac(rawOtp, order.id, caller.uid);
    const challengeId = crypto.randomUUID();

    const challenge: EphemeralOtpChallenge = {
      challengeId,
      orderId: order.id,
      customerId: caller.uid,
      tenantId: order.tenant_id,
      canteenId: order.canteen_id,
      keyedHmac,
      createdAt: now,
      expiresAt: now + OTP_EXPIRY_MS,
      resendAvailableAt: now + OTP_RESEND_COOLDOWN_MS,
      attempts: 0,
      maxAttempts: MAX_OTP_ATTEMPTS,
      status: 'ACTIVE',
    };

    // Store in ephemeral memory only
    this.ephemeralStore.set(order.id, challenge);

    // 6. Dispatch to verified contact channel (email / push notification)
    // The OTP is never returned to the API caller or persisted in the DB
    if (dispatchChannelFn) {
      try {
        dispatchChannelFn(caller.uid, rawOtp);
      } catch (err) {
        console.error('Failed to dispatch OTP notification:', err);
      }
    }

    // 7. Record non-sensitive audit event (NEVER include rawOtp)
    this.recordAudit(order.id, caller.uid, caller.role, 'OTP_CHALLENGE_CREATED', order.status, order.status, {
      challengeId,
      expiresAt: challenge.expiresAt,
    });

    return {
      success: true,
      challengeId,
      expiresAt: challenge.expiresAt,
      resendAvailableAt: challenge.resendAvailableAt,
      message: 'Collection OTP sent to your verified institutional email/contact channel. Valid for 5 minutes.',
      otpForTestOnly: process.env.NODE_ENV === 'test' ? rawOtp : undefined,
    };
  }

  /**
   * Verifies collection OTP presented by recipient.
   * Atomically transitions order to COLLECTED and consumes challenge on success.
   */
  public verifyCollectionOtp(
    caller: SecurityUserContext,
    order: OrderState,
    submittedOtp: string,
    customNow?: Date
  ): {
    success: boolean;
    message: string;
    locked?: boolean;
    expired?: boolean;
    alreadyCollected?: boolean;
    attempts?: number;
  } {
    // 1. Authorization: Staff or administrators only
    if (!['STAFF', 'CANTEEN_ADMIN', 'UNI_ADMIN', 'SUPER_ADMIN'].includes(caller.role)) {
      this.recordAudit(order.id, caller.uid, caller.role, 'UNAUTHORIZED_VERIFY_ATTEMPT', order.status, order.status);
      return { success: false, message: 'Unauthorized: only cafeteria staff and administrators can verify pickups.' };
    }

    // 2. Scoping: tenant and canteen isolation
    if (caller.role !== 'SUPER_ADMIN') {
      if (caller.tenant_id !== order.tenant_id) {
        return { success: false, message: 'Access denied: order belongs to another organization.' };
      }
      if (['STAFF', 'CANTEEN_ADMIN'].includes(caller.role)) {
        if (!caller.canteen_id || caller.canteen_id !== order.canteen_id) {
          return { success: false, message: 'Access denied: You are only authorized to manage orders for your assigned cafeteria.' };
        }
      }
    }

    // 3. Status checks
    if (order.status === 'COLLECTED') {
      return { success: false, message: 'Replay blocked: Order has already been collected.', alreadyCollected: true };
    }

    if (order.status === 'REJECTED') {
      return { success: false, message: 'Order has been cancelled or rejected and cannot be collected.' };
    }

    if (order.status !== 'READY') {
      return {
        success: false,
        message: `Order is not ready for pickup (current status: ${order.status}). Kitchen must mark it READY first.`,
      };
    }

    const cleanOtp = (submittedOtp || '').trim();
    if (cleanOtp.length !== 6 || !/^\d{6}$/.test(cleanOtp)) {
      return { success: false, message: 'Invalid OTP format. Expected 6 numeric digits.' };
    }

    // 4. Retrieve ephemeral challenge
    const challenge = this.ephemeralStore.get(order.id);
    if (!challenge || challenge.status !== 'ACTIVE') {
      return { success: false, message: 'No active OTP challenge found. Customer must request a collection OTP.' };
    }

    const now = customNow ? customNow.getTime() : Date.now();

    // 5. Expiration check (5 minutes strict)
    if (now > challenge.expiresAt) {
      challenge.status = 'EXPIRED';
      this.recordAudit(order.id, caller.uid, caller.role, 'OTP_EXPIRED', order.status, order.status);
      return { success: false, message: 'OTP has expired. Customer must request a fresh collection OTP.', expired: true };
    }

    // 6. Lockout check (5 failed attempts limit)
    if (challenge.attempts >= challenge.maxAttempts) {
      challenge.status = 'LOCKED';
      this.recordAudit(order.id, caller.uid, caller.role, 'OTP_LOCKED', order.status, order.status);
      return {
        success: false,
        message: 'Maximum verification attempts exceeded (5/5). Verification locked for security.',
        locked: true,
      };
    }

    // 7. Cryptographic Timing-Safe Match
    const submittedHmac = OrderSecurityService.computeKeyedHmac(cleanOtp, order.id, challenge.customerId);
    const isMatch = OrderSecurityService.timingSafeVerify(submittedHmac, challenge.keyedHmac);

    if (isMatch) {
      // ATOMIC CONSUMPTION: Invalidate challenge immediately to prevent replay
      challenge.status = 'VERIFIED';
      this.ephemeralStore.delete(order.id);

      // Transition order status
      order.status = 'COLLECTED';
      order.collected_at = new Date(now);

      // Audit log success (no secrets)
      this.recordAudit(order.id, caller.uid, caller.role, 'OTP_VERIFICATION_SUCCESS', 'READY', 'COLLECTED', {
        challengeId: challenge.challengeId,
      });

      return {
        success: true,
        message: 'OTP verified successfully. Order collected.',
      };
    } else {
      // FAILED ATTEMPT: Increment server-controlled counter
      challenge.attempts += 1;
      order.otp_attempts += 1;

      const isNowLocked = challenge.attempts >= challenge.maxAttempts;
      if (isNowLocked) {
        challenge.status = 'LOCKED';
      }

      this.recordAudit(order.id, caller.uid, caller.role, 'OTP_VERIFICATION_FAILED', order.status, order.status, {
        attempts: challenge.attempts,
        maxAttempts: challenge.maxAttempts,
        locked: isNowLocked,
      });

      if (isNowLocked) {
        return {
          success: false,
          message: 'Invalid OTP. Maximum attempts reached (5/5). Verification locked.',
          locked: true,
          attempts: challenge.attempts,
        };
      }

      return {
        success: false,
        message: `Invalid OTP. Attempt ${challenge.attempts} of ${challenge.maxAttempts}.`,
        locked: false,
        attempts: challenge.attempts,
      };
    }
  }

  /**
   * Admin-only attempt counter reset.
   * Resets counter after verifying customer identity, without bypassing collection or marking collected.
   */
  public resetOtpAttempts(
    caller: SecurityUserContext,
    order: OrderState
  ): { success: boolean; message: string } {
    if (!['CANTEEN_ADMIN', 'UNI_ADMIN', 'SUPER_ADMIN'].includes(caller.role)) {
      return { success: false, message: 'Unauthorized: only cafeteria administrators can reset attempt counters.' };
    }

    if (caller.role !== 'SUPER_ADMIN') {
      if (caller.tenant_id !== order.tenant_id) {
        return { success: false, message: 'Access denied: order belongs to another organization.' };
      }
      if (caller.role === 'CANTEEN_ADMIN') {
        if (!caller.canteen_id || caller.canteen_id !== order.canteen_id) {
          return { success: false, message: 'Access denied: order belongs to another cafeteria.' };
        }
      }
    }

    order.otp_attempts = 0;
    const challenge = this.ephemeralStore.get(order.id);
    if (challenge) {
      challenge.attempts = 0;
      if (challenge.status === 'LOCKED') {
        challenge.status = 'ACTIVE';
      }
    }

    this.recordAudit(order.id, caller.uid, caller.role, 'OTP_ATTEMPTS_RESET', order.status, order.status);

    return { success: true, message: 'OTP attempt counter reset to 0.' };
  }

  // --------------------------------------------------------------------------
  // Audit Trail & Maintenance
  // --------------------------------------------------------------------------

  private recordAudit(
    orderId: string,
    actorId: string,
    actorRole: string,
    eventType: string,
    previousStatus?: string | null,
    newStatus?: string | null,
    details?: Record<string, any>
  ): void {
    this.auditLog.push({
      id: crypto.randomUUID(),
      orderId,
      actorId,
      actorRole,
      eventType,
      previousStatus,
      newStatus,
      details,
      timestamp: new Date(),
    });
  }

  public getAuditLogs(): ReadonlyArray<SecurityAuditRecord> {
    return this.auditLog;
  }

  private purgeExpiredChallenges(): void {
    const now = Date.now();
    for (const [orderId, challenge] of this.ephemeralStore.entries()) {
      if (now > challenge.expiresAt) {
        this.ephemeralStore.delete(orderId);
      }
    }
  }
}

export const orderSecurityService = new OrderSecurityService();
