-- #1266 / #1287 — webhook DB PREREQUISITE (DB-only; applied & verified BEFORE #1282's new Edge deploys).
--
-- DESIGN LOCK (PM, 2026-08-12): entitlement is decided by the CURRENT observed Stripe subscription state,
-- NOT by event action or arrival order. #1282's Edge verifies the signature, HYDRATES the current Stripe
-- subscription for state-changing events, and calls the snapshot RPC below with that canonical state. This
-- closes unordered AND same-second delivery together: whatever event arrives, the Edge re-reads Stripe and
-- applies the current truth. The event `created` time is AUDIT metadata only, never the entitlement authority.
--
-- This migration is DB-only and BACKWARD-COMPATIBLE with the pre-#1282 Edge: it does NOT touch the existing
-- action-based process_stripe_webhook_event (the old 6-arg caller keeps working unchanged — old Edge + new
-- DB). It only ADDS a service-role, pg_temp-safe snapshot RPC + an audit column. It contains no trial clock,
-- checkout, pricing, or commercial-activation logic (those live in #1282). Applying it activates no billing.

-- Audit-only: the Stripe created-time of the most recent applied snapshot for this profile. Recorded for
-- observability; it is NEVER read to decide entitlement (the snapshot IS the authority).
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS last_stripe_event_at TIMESTAMPTZ;

COMMENT ON COLUMN public.user_profiles.last_stripe_event_at IS
  '#1287 AUDIT ONLY: Stripe created-time of the most recent applied subscription snapshot. Never used to '
  'decide entitlement — the current Stripe subscription state (applied via apply_stripe_subscription_snapshot) '
  'is the sole authority, so event ordering (incl. same-second) cannot change the outcome.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- Durable terminal TOMBSTONE. When a subscription reaches a terminal state (canceled / incomplete_expired)
-- the paid subscription id is cleared from the profile, which would make a later stale snapshot for that
-- same id match ZERO rows. Without a durable record we could not tell "already terminal" (a legitimate
-- no-op — a dead subscription can never reactivate) apart from "never bound / unknown identity" (which MUST
-- fail closed so Stripe retries). This tombstone provides that unambiguous terminal identity. It stores only
-- the minimal allowlisted keys — no customer prose, card data, email, or Stripe payload body.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stripe_subscription_tombstones (
    subscription_id text PRIMARY KEY,
    customer_id     text,
    terminal_status text NOT NULL,
    tombstoned_at   timestamptz NOT NULL DEFAULT now(),
    event_id        text
);

COMMENT ON TABLE public.stripe_subscription_tombstones IS
  '#1287: durable terminal markers for Stripe subscription ids. Lets apply_stripe_subscription_snapshot '
  'distinguish an already-terminal subscription (no-op success; cannot reactivate) from an unknown/unbound '
  'subscription id (fail closed for retry). Written only by the SECDEF snapshot RPC.';

-- Locked down: only the SECURITY DEFINER snapshot RPC (running as owner) touches this table. RLS with no
-- policy denies all direct client access; explicit REVOKE removes any inherited privilege.
ALTER TABLE public.stripe_subscription_tombstones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stripe_subscription_tombstones FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- Canonical subscription snapshot RPC. Applies the CURRENT Stripe subscription state idempotently and
-- atomically. Service-role only (the Edge calls it after signature verification + Stripe hydration).
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_stripe_subscription_snapshot(
    p_event_id text,
    p_subscription_id text,
    p_customer_id text,
    p_status text,                          -- Stripe subscription.status (the current, hydrated value)
    p_cancel_at_period_end boolean DEFAULT false,
    p_current_period_end bigint DEFAULT NULL,
    p_user_id uuid DEFAULT NULL,            -- present for first activation (checkout.session.completed)
    p_event_created bigint DEFAULT NULL     -- AUDIT ONLY
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_customer   text := NULLIF(BTRIM(COALESCE(p_customer_id, '')), '');
    v_status     text := lower(BTRIM(COALESCE(p_status, '')));
    v_event_at   timestamptz := CASE WHEN p_event_created IS NULL THEN NULL ELSE to_timestamp(p_event_created) END;
    v_pro        boolean;
    v_terminal   boolean;   -- terminal states clear the paid subscription id
    v_rows       int := 0;
    v_error      text := NULL;
BEGIN
    IF NULLIF(BTRIM(COALESCE(p_subscription_id, '')), '') IS NULL THEN
        RAISE EXCEPTION 'apply_stripe_subscription_snapshot: subscription_id is required';
    END IF;

    -- Idempotency: an already-processed event id is a no-op success (safe duplicate delivery).
    BEGIN
        INSERT INTO public.processed_webhook_events (event_id, event_type, processed_at)
        VALUES (p_event_id, 'subscription.snapshot', NOW());
    EXCEPTION WHEN unique_violation THEN
        RETURN jsonb_build_object('success', true, 'skipped', true);
    END;

    BEGIN
        -- Map the CURRENT Stripe status to canonical entitlement:
        --   active / trialing            -> Pro (keep the subscription id).
        --   past_due / unpaid            -> Free but PRESERVE the subscription id (recoverable lapse).
        --   canceled / incomplete_expired-> Free and CLEAR the subscription id (terminal).
        --   incomplete / anything else   -> Free, preserve the id (not yet entitled; may still activate).
        -- cancel_at_period_end=true with an 'active' status keeps Pro until the period-end 'canceled' snapshot.
        v_pro      := v_status IN ('active', 'trialing');
        v_terminal := v_status IN ('canceled', 'incomplete_expired');

        -- A terminal status is recorded as a durable tombstone FIRST, so that later stale snapshots for the
        -- same (now cleared) subscription id are recognised as already-terminal no-ops rather than unknown
        -- identities. Idempotent: the first terminal marker stands.
        IF v_terminal THEN
            INSERT INTO public.stripe_subscription_tombstones (subscription_id, customer_id, terminal_status, event_id)
            VALUES (p_subscription_id, v_customer, v_status, p_event_id)
            ON CONFLICT (subscription_id) DO NOTHING;
        END IF;

        IF p_user_id IS NOT NULL THEN
            -- First activation / explicit binding. Fail CLOSED on any identity collision so a subscription
            -- can never be rebound across profiles and a profile with a conflicting live billing identity is
            -- never silently overwritten (the Edge returns non-2xx; Stripe retries once the state is coherent).
            IF EXISTS (SELECT 1 FROM public.user_profiles
                       WHERE stripe_subscription_id = p_subscription_id AND id <> p_user_id) THEN
                RAISE EXCEPTION 'snapshot: subscription_id % already bound to a different profile', p_subscription_id;
            END IF;
            IF v_customer IS NOT NULL AND EXISTS (SELECT 1 FROM public.user_profiles
                       WHERE stripe_customer_id = v_customer AND id <> p_user_id) THEN
                RAISE EXCEPTION 'snapshot: customer_id % already bound to a different profile', v_customer;
            END IF;
            IF EXISTS (SELECT 1 FROM public.user_profiles
                       WHERE id = p_user_id
                         AND stripe_subscription_id IS NOT NULL
                         AND stripe_subscription_id <> p_subscription_id) THEN
                RAISE EXCEPTION 'snapshot: profile % already holds a different subscription id (conflicting billing identity)', p_user_id;
            END IF;

            UPDATE public.user_profiles
            SET subscription_status   = CASE WHEN v_pro THEN 'pro' ELSE 'free' END,
                stripe_subscription_id = CASE WHEN v_terminal THEN NULL ELSE p_subscription_id END,
                subscription_id        = CASE WHEN v_terminal THEN NULL ELSE subscription_id END,
                stripe_customer_id     = COALESCE(v_customer, stripe_customer_id),
                last_stripe_event_at   = GREATEST(COALESCE(last_stripe_event_at, to_timestamp(0)), COALESCE(v_event_at, to_timestamp(0))),
                updated_at             = now()
            WHERE id = p_user_id;
            GET DIAGNOSTICS v_rows = ROW_COUNT;
            IF v_rows <> 1 THEN
                RAISE EXCEPTION 'snapshot affected % profiles for user_id %', v_rows, p_user_id;
            END IF;
        ELSE
            -- Subsequent state events: apply by the subscription id.
            UPDATE public.user_profiles
            SET subscription_status   = CASE WHEN v_pro THEN 'pro' ELSE 'free' END,
                stripe_subscription_id = CASE WHEN v_terminal THEN NULL ELSE stripe_subscription_id END,
                subscription_id        = CASE WHEN v_terminal THEN NULL ELSE subscription_id END,
                stripe_customer_id     = COALESCE(v_customer, stripe_customer_id),
                last_stripe_event_at   = GREATEST(COALESCE(last_stripe_event_at, to_timestamp(0)), COALESCE(v_event_at, to_timestamp(0))),
                updated_at             = now()
            WHERE stripe_subscription_id = p_subscription_id;
            GET DIAGNOSTICS v_rows = ROW_COUNT;
            IF v_rows > 1 THEN
                RAISE EXCEPTION 'snapshot affected % profiles for subscription_id %', v_rows, p_subscription_id;
            END IF;

            -- ZERO rows must NOT be a blanket success (that would swallow an unknown/mismatched identity and
            -- deny Stripe its retry). Distinguish the two legitimate-vs-not cases via the durable tombstone:
            --   • the id is TERMINAL (tombstoned) -> a stale snapshot for a dead subscription is a harmless
            --     no-op; it can never reactivate, so accept it.
            --   • otherwise -> the live subscription id maps to NO profile (unknown identity, or a state event
            --     that arrived before first binding). Fail CLOSED so Stripe retries until the id is bound.
            IF v_rows = 0 AND NOT EXISTS (
                SELECT 1 FROM public.stripe_subscription_tombstones WHERE subscription_id = p_subscription_id
            ) THEN
                RAISE EXCEPTION 'snapshot: subscription_id % is not bound to any profile and is not terminal (status=%) — failing closed', p_subscription_id, v_status;
            END IF;
        END IF;

        RETURN jsonb_build_object('success', true, 'rows', v_rows,
                                  'entitlement', CASE WHEN v_pro THEN 'pro' ELSE 'free' END,
                                  'terminal', v_terminal);
    EXCEPTION WHEN OTHERS THEN
        -- Roll back the processed marker so Stripe can retry (the Edge returns non-2xx on a false result).
        DELETE FROM public.processed_webhook_events WHERE event_id = p_event_id;
        v_error := SQLERRM;
        RETURN jsonb_build_object('success', false, 'error', v_error);
    END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_stripe_subscription_snapshot(text, text, text, text, boolean, bigint, uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_stripe_subscription_snapshot(text, text, text, text, boolean, bigint, uuid, bigint) TO service_role;
