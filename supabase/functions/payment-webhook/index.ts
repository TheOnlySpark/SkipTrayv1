import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// Constant-time HMAC-SHA256 signature verification using Web Crypto API
async function verifyHmacSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string | null
): Promise<boolean> {
  if (!secret) {
    // If webhook secret is not set, log warning and allow in local dev mode
    console.warn("PAYMENT_WEBHOOK_SECRET not configured, skipping HMAC validation");
    return true;
  }
  if (!signatureHeader) {
    return false;
  }

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"]
    );

    // Compute HMAC
    const computedSignatureBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(rawBody)
    );

    const computedSignatureHex = Array.from(new Uint8Array(computedSignatureBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Support both raw hex signature and prefixed signatures (e.g. "sha256=...")
    const cleanHeader = signatureHeader.replace(/^sha256=/, "").trim();

    // Constant-time string comparison
    if (computedSignatureHex.length !== cleanHeader.length) {
      return false;
    }
    let diff = 0;
    for (let i = 0; i < computedSignatureHex.length; i++) {
      diff |= computedSignatureHex.charCodeAt(i) ^ cleanHeader.charCodeAt(i);
    }
    return diff === 0;
  } catch (err) {
    console.error("Signature verification error:", err);
    return false;
  }
}

serve(async (req: Request) => {
  // 1. CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-signature, x-zoho-signature, x-razorpay-signature, x-cashfree-signature",
      },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const webhookSecret = Deno.env.get("PAYMENT_WEBHOOK_SECRET") ?? Deno.env.get("ZOHOPAY_WEBHOOK_SECRET") ?? null;

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  let rawBody = "";
  try {
    rawBody = await req.text();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Failed to read request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 2. Extract Webhook Signature Header
  const signatureHeader =
    req.headers.get("x-webhook-signature") ||
    req.headers.get("x-zoho-signature") ||
    req.headers.get("x-cashfree-signature") ||
    req.headers.get("x-razorpay-signature") ||
    null;

  let payload: any = {};
  try {
    payload = JSON.parse(rawBody || "{}");
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 3. Extract Authoritative Gateway Event Fields
  const provider = payload.provider || (req.headers.get("x-provider") || "ZohoPay");
  const providerEventId =
    payload.provider_event_id ||
    payload.event_id ||
    payload.id ||
    payload.data?.payment?.cf_payment_id ||
    payload.payment_id ||
    `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const eventType = payload.event_type || payload.type || "payment.captured";
  const amount = Number(payload.amount ?? payload.data?.amount ?? 0);
  const currency = payload.currency || payload.data?.currency || "INR";
  const paymentReference = payload.payment_id || payload.data?.payment_id || payload.zohopay_payment_id || null;
  const bookingReference = payload.booking_id || payload.order_id || payload.data?.order_id || null;
  const userReference = payload.user_id || payload.data?.user_id || null;
  const universityId = payload.university_id || payload.tenant_id || payload.data?.tenant_id || "00000000-0000-0000-0000-000000000001";

  // 4. Verify Signature
  const isSignatureValid = await verifyHmacSignature(rawBody, signatureHeader, webhookSecret);
  const signatureStatus = isSignatureValid ? "VERIFIED" : "INVALID_SIGNATURE";

  if (!isSignatureValid) {
    // Record untrusted event for audit security
    await supabase.from("payment_webhook_events").upsert(
      {
        provider_event_id: providerEventId,
        provider,
        event_type: eventType,
        payment_id: paymentReference,
        booking_id: bookingReference,
        user_id: userReference,
        university_id: universityId,
        amount,
        currency,
        signature_status: "INVALID_SIGNATURE",
        processing_status: "FAILED",
        last_error: "HMAC-SHA256 signature verification failed. Untrusted webhook rejected.",
        last_attempt_at: new Date().toISOString(),
        payload,
      },
      { onConflict: "provider,provider_event_id" }
    );

    await supabase.from("payment_webhook_audit_logs").insert({
      actor_type: "SYSTEM",
      tenant_id: universityId,
      action: "INVALID_SIGNATURE_REJECTED",
      details: {
        provider,
        provider_event_id: providerEventId,
        event_type: eventType,
        ip: req.headers.get("x-forwarded-for"),
      },
    });

    return new Response(
      JSON.stringify({ error: "Invalid signature verification. Event rejected." }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  // 5. Check Idempotency (Duplicate Prevention)
  const { data: existingEvent } = await supabase
    .from("payment_webhook_events")
    .select("*")
    .eq("provider", provider)
    .eq("provider_event_id", providerEventId)
    .maybeSingle();

  if (existingEvent) {
    if (existingEvent.processing_status === "PROCESSED") {
      // Record duplicate event delivery
      await supabase.from("payment_webhook_audit_logs").insert({
        webhook_event_id: existingEvent.id,
        payment_id: existingEvent.payment_id,
        actor_type: "GATEWAY",
        tenant_id: existingEvent.university_id,
        action: "DUPLICATE_EVENT_DETECTED",
        details: {
          message: "Gateway sent duplicate event. State preserved idempotently.",
          provider_event_id: providerEventId,
          processed_at: existingEvent.processed_at,
        },
      });

      return new Response(
        JSON.stringify({
          status: "DUPLICATE_EVENT",
          message: "Event was already processed idempotently.",
          event_id: existingEvent.id,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    if (existingEvent.processing_status === "PROCESSING" && existingEvent.lock_status === "LOCKED") {
      return new Response(
        JSON.stringify({
          status: "IN_PROGRESS",
          message: "Event is currently locked and being processed by another worker.",
        }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // 6. Acquire Safe Distributed Lock
  const workerId = `edge-worker-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
  const resourceId = paymentReference || bookingReference || providerEventId;
  const { data: lockResult, error: lockError } = await supabase.rpc("acquire_payment_lock", {
    p_resource_type: "PAYMENT",
    p_resource_id: resourceId,
    p_tenant_id: universityId,
    p_lock_owner: workerId,
    p_ttl_seconds: 60,
  });

  if (lockError || !lockResult?.success) {
    return new Response(
      JSON.stringify({
        status: "LOCKED",
        message: lockResult?.message || "Resource is currently locked by another worker.",
      }),
      { status: 423, headers: { "Content-Type": "application/json" } }
    );
  }

  const { lock_id: lockId, lock_token: lockToken } = lockResult;

  // 7. Insert or update event record as PROCESSING
  const { data: eventRecord, error: eventUpsertErr } = await supabase
    .from("payment_webhook_events")
    .upsert(
      {
        id: existingEvent?.id,
        provider_event_id: providerEventId,
        provider,
        event_type: eventType,
        payment_id: paymentReference,
        booking_id: bookingReference,
        user_id: userReference,
        university_id: universityId,
        amount,
        currency,
        signature_status: "VERIFIED",
        processing_status: "PROCESSING",
        lock_id: lockId,
        lock_status: "LOCKED",
        lock_owner: workerId,
        lock_acquired_at: new Date().toISOString(),
        lock_expires_at: lockResult.expires_at,
        last_attempt_at: new Date().toISOString(),
        payload,
      },
      { onConflict: "provider,provider_event_id" }
    )
    .select()
    .single();

  if (eventUpsertErr) {
    // Release lock on setup failure
    await supabase.rpc("release_payment_lock", {
      p_lock_id: lockId,
      p_lock_token: lockToken,
      p_release_reason: "Failed to record event in database",
    });
    return new Response(JSON.stringify({ error: eventUpsertErr.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 8. Process Gateway Event Atomically
  try {
    let resolvedPaymentId = paymentReference;

    // A. Locate corresponding payment record if not provided directly
    if (!resolvedPaymentId) {
      const { data: matchedPayment } = await supabase
        .from("payments")
        .select("id, amount, status")
        .or(`zohopay_order_id.eq.${bookingReference},zohopay_payment_id.eq.${providerEventId}`)
        .maybeSingle();

      if (matchedPayment) {
        resolvedPaymentId = matchedPayment.id;
      }
    }

    // B. Handle payment events
    if (eventType === "payment.captured" || eventType === "payment.success" || eventType === "PAYMENT_SUCCESS") {
      if (resolvedPaymentId) {
        // Validate amount
        const { data: paymentRecord } = await supabase
          .from("payments")
          .select("id, amount, status")
          .eq("id", resolvedPaymentId)
          .single();

        if (paymentRecord && Number(paymentRecord.amount) > 0 && Math.abs(Number(paymentRecord.amount) - amount) > 0.01) {
          throw new Error(`Amount mismatch: expected ${paymentRecord.amount} INR but gateway sent ${amount} INR`);
        }

        // Update payment to SUCCESS
        await supabase
          .from("payments")
          .update({
            status: "SUCCESS",
            zohopay_payment_id: providerEventId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", resolvedPaymentId);
      }

      // Update related booking if applicable
      if (bookingReference) {
        await supabase
          .from("orders")
          .update({
            payment_id: resolvedPaymentId || undefined,
          })
          .eq("id", bookingReference);
      }
    } else if (eventType === "payment.failed" || eventType === "PAYMENT_FAILED") {
      if (resolvedPaymentId) {
        await supabase
          .from("payments")
          .update({
            status: "FAILED",
            updated_at: new Date().toISOString(),
          })
          .eq("id", resolvedPaymentId);
      }
    } else if (eventType === "refund.processed" || eventType === "REFUND_SUCCESS") {
      // Find matching cancellation request
      if (bookingReference) {
        const { data: cancelReq } = await supabase
          .from("cancellation_requests")
          .select("id, refund_status")
          .eq("order_id", bookingReference)
          .maybeSingle();

        if (cancelReq && cancelReq.refund_status === "PROCESSING") {
          await supabase
            .from("cancellation_requests")
            .update({
              refund_status: "COMPLETED",
              refund_transaction_id: providerEventId,
              processed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", cancelReq.id);
        }
      }
    }

    // C. Mark Event as PROCESSED & Release Lock
    const nowIso = new Date().toISOString();
    await supabase
      .from("payment_webhook_events")
      .update({
        payment_id: resolvedPaymentId,
        processing_status: "PROCESSED",
        lock_status: "UNLOCKED",
        processed_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", eventRecord.id);

    await supabase.rpc("release_payment_lock", {
      p_lock_id: lockId,
      p_lock_token: lockToken,
      p_release_reason: "Successfully processed event",
    });

    await supabase.from("payment_webhook_audit_logs").insert({
      webhook_event_id: eventRecord.id,
      payment_id: resolvedPaymentId,
      actor_type: "WORKER",
      tenant_id: universityId,
      action: "WEBHOOK_PROCESSED_SUCCESS",
      details: {
        provider_event_id: providerEventId,
        event_type: eventType,
        worker_id: workerId,
        processed_at: nowIso,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: "Webhook event processed and verified successfully",
        event_id: eventRecord.id,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Webhook processing error:", err);

    // D. Safe Failure Handling & Lock Release
    const errMessage = err?.message || "Unknown processing error";
    const nowIso = new Date().toISOString();

    await supabase
      .from("payment_webhook_events")
      .update({
        processing_status: "FAILED",
        last_error: errMessage,
        lock_status: "UNLOCKED",
        retry_count: (eventRecord.retry_count || 0) + 1,
        last_attempt_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", eventRecord.id);

    await supabase.rpc("release_payment_lock", {
      p_lock_id: lockId,
      p_lock_token: lockToken,
      p_release_reason: `Failed processing: ${errMessage}`,
    });

    await supabase.from("payment_webhook_audit_logs").insert({
      webhook_event_id: eventRecord.id,
      payment_id: paymentReference,
      actor_type: "WORKER",
      tenant_id: universityId,
      action: "WEBHOOK_PROCESSING_FAILED",
      details: {
        error: errMessage,
        worker_id: workerId,
        failed_at: nowIso,
      },
    });

    return new Response(
      JSON.stringify({ error: errMessage, event_id: eventRecord.id }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
