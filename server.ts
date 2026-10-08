import express from 'express';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET || process.env.ZOHOPAY_WEBHOOK_SECRET || '';

const supabase = createClient(supabaseUrl, supabaseKey);

// Use raw body for HMAC signature verification
app.use(express.json({
  verify: (req: any, _res, buf) => {
    req.rawBody = buf.toString();
  }
}));

// Verification helper
function verifyHmacSignature(rawBody: string, signatureHeader?: string): boolean {
  if (!webhookSecret) {
    console.warn('[SERVER] PAYMENT_WEBHOOK_SECRET not set, allowing request');
    return true;
  }
  if (!signatureHeader) return false;

  const cleanHeader = signatureHeader.replace(/^sha256=/, '').trim();
  const computedHash = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(cleanHeader, 'hex'), Buffer.from(computedHash, 'hex'));
  } catch {
    return false;
  }
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'SkipTray Payment Webhook Server' });
});

app.post('/api/webhooks/payment', async (req: any, res) => {
  try {
    const rawBody = req.rawBody || JSON.stringify(req.body);
    const signatureHeader = req.headers['x-webhook-signature'] ||
      req.headers['x-zoho-signature'] ||
      req.headers['x-cashfree-signature'] ||
      req.headers['x-razorpay-signature'];

    const payload = req.body || {};
    const provider = payload.provider || req.headers['x-provider'] || 'ZohoPay';
    const providerEventId = payload.provider_event_id || payload.event_id || payload.id || `evt_${Date.now()}`;
    const eventType = payload.event_type || payload.type || 'payment.captured';
    const amount = Number(payload.amount ?? payload.data?.amount ?? 0);
    const currency = payload.currency || payload.data?.currency || 'INR';
    const paymentReference = payload.payment_id || payload.data?.payment_id || null;
    const bookingReference = payload.booking_id || payload.order_id || null;
    const universityId = payload.university_id || payload.tenant_id || '00000000-0000-0000-0000-000000000001';

    // Signature verification
    const isValid = verifyHmacSignature(rawBody, signatureHeader as string);
    if (!isValid) {
      await supabase.from('payment_webhook_events').upsert({
        provider_event_id: providerEventId,
        provider,
        event_type: eventType,
        amount,
        currency,
        signature_status: 'INVALID_SIGNATURE',
        processing_status: 'FAILED',
        last_error: 'Invalid HMAC-SHA256 signature',
        university_id: universityId,
        payload
      }, { onConflict: 'provider,provider_event_id' });

      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    // Idempotency check
    const { data: existing } = await supabase
      .from('payment_webhook_events')
      .select('*')
      .eq('provider', provider)
      .eq('provider_event_id', providerEventId)
      .maybeSingle();

    if (existing?.processing_status === 'PROCESSED') {
      return res.status(200).json({ status: 'DUPLICATE_EVENT', message: 'Already processed' });
    }

    // Acquire lock
    const workerId = `express-worker-${Date.now()}`;
    const { data: lockResult } = await supabase.rpc('acquire_payment_lock', {
      p_resource_type: 'PAYMENT',
      p_resource_id: paymentReference || providerEventId,
      p_tenant_id: universityId,
      p_lock_owner: workerId,
      p_ttl_seconds: 60
    });

    if (!lockResult?.success) {
      return res.status(423).json({ status: 'LOCKED', message: lockResult?.message });
    }

    const { lock_id: lockId, lock_token: lockToken } = lockResult;

    // Record processing
    const { data: eventRecord } = await supabase
      .from('payment_webhook_events')
      .upsert({
        id: existing?.id,
        provider_event_id: providerEventId,
        provider,
        event_type: eventType,
        payment_id: paymentReference,
        booking_id: bookingReference,
        university_id: universityId,
        amount,
        currency,
        signature_status: 'VERIFIED',
        processing_status: 'PROCESSING',
        lock_id: lockId,
        lock_status: 'LOCKED',
        lock_owner: workerId,
        lock_acquired_at: new Date().toISOString(),
        payload
      }, { onConflict: 'provider,provider_event_id' })
      .select()
      .single();

    // Update payment record
    if (eventType === 'payment.captured' || eventType === 'payment.success') {
      if (paymentReference) {
        await supabase
          .from('payments')
          .update({ status: 'SUCCESS', updated_at: new Date().toISOString() })
          .eq('id', paymentReference);
      }
    } else if (eventType === 'payment.failed') {
      if (paymentReference) {
        await supabase
          .from('payments')
          .update({ status: 'FAILED', updated_at: new Date().toISOString() })
          .eq('id', paymentReference);
      }
    }

    // Mark as processed & release lock
    const nowIso = new Date().toISOString();
    await supabase.from('payment_webhook_events').update({
      processing_status: 'PROCESSED',
      lock_status: 'UNLOCKED',
      processed_at: nowIso,
      updated_at: nowIso
    }).eq('id', eventRecord.id);

    await supabase.rpc('release_payment_lock', {
      p_lock_id: lockId,
      p_lock_token: lockToken,
      p_release_reason: 'Successfully processed event'
    });

    await supabase.from('payment_webhook_audit_logs').insert({
      webhook_event_id: eventRecord.id,
      payment_id: paymentReference,
      actor_type: 'WORKER',
      tenant_id: universityId,
      action: 'WEBHOOK_PROCESSED_SUCCESS',
      details: { provider_event_id: providerEventId, event_type: eventType }
    });

    return res.status(200).json({ success: true, event_id: eventRecord.id });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default app;

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[SkipTray] Payment Webhook Server listening on port ${PORT}`);
  });
}
