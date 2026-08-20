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
-- DEPLOYMENT ORDER: if this version is applied first, #1282's held 20260812000000/20260812001000 files must
-- be re-versioned above this applied identity during their post-ACCEPT rebase. Commercial activation remains
-- a separate authorization; never use an include-all recovery to couple it to this prerequisite.

-- FAIL-CLOSED identity preflight. Production operators run the same read-only aggregates before separately
-- authorizing this migration. The migration repeats them so a changed/unclean state aborts rather than
-- silently choosing among profiles. Only sanitized counts are exposed; no customer/subscription value is
-- printed, repaired, deleted, or merged.
DO $$
DECLARE
    v_blank_subscriptions int;
    v_duplicate_subscriptions int;
    v_blank_customers int;
    v_duplicate_customers int;
BEGIN
    SELECT count(*)::int INTO v_blank_subscriptions
      FROM public.user_profiles
     WHERE stripe_subscription_id IS NOT NULL
       AND BTRIM(stripe_subscription_id) = '';

    SELECT count(*)::int INTO v_duplicate_subscriptions
      FROM (
        SELECT stripe_subscription_id
          FROM public.user_profiles
         WHERE stripe_subscription_id IS NOT NULL
         GROUP BY stripe_subscription_id
        HAVING count(*) > 1
      ) duplicate_groups;

    SELECT count(*)::int INTO v_blank_customers
      FROM public.user_profiles
     WHERE stripe_customer_id IS NOT NULL
       AND BTRIM(stripe_customer_id) = '';

    SELECT count(*)::int INTO v_duplicate_customers
      FROM (
        SELECT stripe_customer_id
          FROM public.user_profiles
         WHERE stripe_customer_id IS NOT NULL
         GROUP BY stripe_customer_id
        HAVING count(*) > 1
      ) duplicate_groups;

    IF v_blank_subscriptions > 0 OR v_duplicate_subscriptions > 0
       OR v_blank_customers > 0 OR v_duplicate_customers > 0 THEN
        RAISE EXCEPTION
          'billing identity preflight failed (blank_subscription_rows=%, duplicate_subscription_groups=%, blank_customer_rows=%, duplicate_customer_groups=%); no repair performed',
          v_blank_subscriptions, v_duplicate_subscriptions, v_blank_customers, v_duplicate_customers;
    END IF;
END;
$$;

-- Durable database authority for binding uniqueness. These indexes arbitrate concurrent first bindings;
-- RPC checks provide useful structured errors, while the indexes remain authoritative for every writer.
CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_stripe_subscription_id_unique_1287
  ON public.user_profiles (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_stripe_customer_id_unique_1287
  ON public.user_profiles (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

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
    customer_id     text NOT NULL,
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
REVOKE ALL ON public.stripe_subscription_tombstones FROM PUBLIC, anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- Canonical subscription snapshot RPC. Applies the CURRENT Stripe subscription state idempotently and
-- atomically. Service-role only (the Edge calls it after signature verification + Stripe hydration).
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_stripe_subscription_snapshot(
    p_event_id text,
    p_subscription_id text,
    p_customer_id text,
    p_status text,                          -- Stripe subscription.status (the current, hydrated value)
    p_has_approved_price boolean,           -- result of the Edge's configured $10/month price validation
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
    v_subscription text := NULLIF(BTRIM(COALESCE(p_subscription_id, '')), '');
    v_customer   text := NULLIF(BTRIM(COALESCE(p_customer_id, '')), '');
    v_status     text := lower(BTRIM(COALESCE(p_status, '')));
    v_event_at   timestamptz := CASE WHEN p_event_created IS NULL THEN NULL ELSE to_timestamp(p_event_created) END;
    v_pro        boolean;
    v_terminal   boolean;   -- terminal states clear the paid subscription id
    v_rows       int := 0;
    v_error      text := NULL;
    v_bound_user uuid := NULL;
    v_bound_customer text := NULL;
    v_existing_subscription text := NULL;
    v_existing_customer text := NULL;
    v_tombstone_customer text := NULL;
BEGIN
    IF NULLIF(BTRIM(COALESCE(p_event_id, '')), '') IS NULL THEN
        RAISE EXCEPTION 'apply_stripe_subscription_snapshot: event_id is required';
    END IF;
    IF v_subscription IS NULL THEN
        RAISE EXCEPTION 'apply_stripe_subscription_snapshot: subscription_id is required';
    END IF;
    IF v_customer IS NULL THEN
        RAISE EXCEPTION 'apply_stripe_subscription_snapshot: customer_id is required';
    END IF;
    IF v_status NOT IN ('active', 'trialing', 'past_due', 'unpaid', 'incomplete',
                        'incomplete_expired', 'paused', 'canceled') THEN
        RAISE EXCEPTION 'apply_stripe_subscription_snapshot: unsupported status %', v_status;
    END IF;
    IF p_has_approved_price IS NULL THEN
        RAISE EXCEPTION 'apply_stripe_subscription_snapshot: approved-price result is required';
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
        v_pro      := v_status IN ('active', 'trialing') AND p_has_approved_price;
        v_terminal := v_status IN ('canceled', 'incomplete_expired');

        IF p_user_id IS NOT NULL THEN
            -- First activation / explicit binding. Fail CLOSED on any identity collision so a subscription
            -- can never be rebound across profiles and a profile with a conflicting live billing identity is
            -- never silently overwritten (the Edge returns non-2xx; Stripe retries once the state is coherent).
            SELECT stripe_subscription_id, stripe_customer_id
              INTO v_existing_subscription, v_existing_customer
              FROM public.user_profiles
             WHERE id = p_user_id
             FOR UPDATE;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'snapshot: user_id % does not identify a profile', p_user_id;
            END IF;
            IF EXISTS (SELECT 1 FROM public.stripe_subscription_tombstones
                       WHERE subscription_id = v_subscription) THEN
                RAISE EXCEPTION 'snapshot: subscription_id % is terminal and cannot be rebound', v_subscription;
            END IF;
            IF EXISTS (SELECT 1 FROM public.user_profiles
                       WHERE stripe_subscription_id = v_subscription AND id <> p_user_id) THEN
                RAISE EXCEPTION 'snapshot: subscription_id % already bound to a different profile', v_subscription;
            END IF;
            IF v_customer IS NOT NULL AND EXISTS (SELECT 1 FROM public.user_profiles
                       WHERE stripe_customer_id = v_customer AND id <> p_user_id) THEN
                RAISE EXCEPTION 'snapshot: customer_id % already bound to a different profile', v_customer;
            END IF;
            IF v_existing_subscription IS NOT NULL
               AND v_existing_subscription <> v_subscription THEN
                RAISE EXCEPTION 'snapshot: profile % already holds a different subscription id (conflicting billing identity)', p_user_id;
            END IF;
            IF v_existing_customer IS NOT NULL AND v_existing_customer <> v_customer THEN
                RAISE EXCEPTION 'snapshot: profile % already holds a different customer id (conflicting billing identity)', p_user_id;
            END IF;
            IF v_terminal
               AND (v_existing_subscription IS NULL OR v_existing_customer IS NULL) THEN
                RAISE EXCEPTION 'snapshot: terminal state requires an exact existing subscription/customer binding';
            END IF;
            -- A first binding is incomplete until BOTH identifiers are already exact. No unapproved
            -- snapshot may claim either durable unique identity, regardless of its nonterminal status.
            -- Already-bound wrong-price snapshots remain valid non-grants so they can revoke Pro while
            -- preserving the exact identity needed for a later correction.
            IF NOT p_has_approved_price
               AND (v_existing_subscription IS NULL OR v_existing_customer IS NULL) THEN
                RAISE EXCEPTION 'snapshot: first binding requires the approved price';
            END IF;

            -- Establish the durable terminal authority before clearing the live key. Both operations are in
            -- this transaction, so a failure leaves neither a tombstone nor a partial profile mutation.
            IF v_terminal THEN
                INSERT INTO public.stripe_subscription_tombstones
                    (subscription_id, customer_id, terminal_status, event_id)
                VALUES (v_subscription, v_customer, v_status, p_event_id);
            END IF;

            UPDATE public.user_profiles
            SET subscription_status   = CASE WHEN v_pro THEN 'pro' ELSE 'free' END,
                stripe_subscription_id = CASE WHEN v_terminal THEN NULL ELSE v_subscription END,
                subscription_id        = CASE WHEN v_terminal THEN NULL ELSE subscription_id END,
                stripe_customer_id     = CASE WHEN v_existing_customer IS NULL THEN v_customer ELSE stripe_customer_id END,
                last_stripe_event_at   = GREATEST(COALESCE(last_stripe_event_at, to_timestamp(0)), COALESCE(v_event_at, to_timestamp(0))),
                updated_at             = now()
            WHERE id = p_user_id;
            GET DIAGNOSTICS v_rows = ROW_COUNT;
            IF v_rows <> 1 THEN
                RAISE EXCEPTION 'snapshot affected % profiles for user_id %', v_rows, p_user_id;
            END IF;

        ELSE
            BEGIN
                -- Subsequent state events must resolve through BOTH already-bound identities. A
                -- subscription-only match is insufficient: accepting a different hydrated customer would
                -- silently rebind billing.
                SELECT id, stripe_customer_id
                 INTO STRICT v_bound_user, v_bound_customer
                  FROM public.user_profiles
                 WHERE stripe_subscription_id = v_subscription
                 FOR UPDATE;

                IF v_bound_customer IS NULL OR v_bound_customer <> v_customer THEN
                    RAISE EXCEPTION 'snapshot: customer_id does not match the profile bound to subscription_id %', v_subscription;
                END IF;
                IF EXISTS (SELECT 1 FROM public.user_profiles
                           WHERE stripe_customer_id = v_customer AND id <> v_bound_user) THEN
                    RAISE EXCEPTION 'snapshot: customer_id % is bound to multiple profiles', v_customer;
                END IF;

                IF v_terminal THEN
                    INSERT INTO public.stripe_subscription_tombstones
                        (subscription_id, customer_id, terminal_status, event_id)
                    VALUES (v_subscription, v_customer, v_status, p_event_id);
                END IF;

                UPDATE public.user_profiles
                SET subscription_status   = CASE WHEN v_pro THEN 'pro' ELSE 'free' END,
                    stripe_subscription_id = CASE WHEN v_terminal THEN NULL ELSE stripe_subscription_id END,
                    subscription_id        = CASE WHEN v_terminal THEN NULL ELSE subscription_id END,
                    last_stripe_event_at   = GREATEST(COALESCE(last_stripe_event_at, to_timestamp(0)), COALESCE(v_event_at, to_timestamp(0))),
                    updated_at             = now()
                WHERE id = v_bound_user;
                GET DIAGNOSTICS v_rows = ROW_COUNT;
                IF v_rows <> 1 THEN
                    RAISE EXCEPTION 'snapshot affected % profiles for subscription_id %', v_rows, v_subscription;
                END IF;
            EXCEPTION WHEN no_data_found THEN
                -- A zero-row live lookup is acceptable only for an already-recorded terminal binding whose
                -- customer identity also matches. Crucially, the RPC never creates a tombstone here.
                SELECT customer_id INTO v_tombstone_customer
                  FROM public.stripe_subscription_tombstones
                 WHERE subscription_id = v_subscription;
                IF NOT FOUND THEN
                    RAISE EXCEPTION 'snapshot: subscription_id % is not bound and is not terminal (status=%)', v_subscription, v_status;
                END IF;
                IF v_tombstone_customer <> v_customer THEN
                    RAISE EXCEPTION 'snapshot: customer_id does not match terminal subscription_id %', v_subscription;
                END IF;
                v_rows := 0;
                v_pro := false;
            END;
        END IF;

        RETURN jsonb_build_object(
            'success', true,
            'rows', v_rows,
            'entitlement', CASE WHEN v_pro THEN 'pro' ELSE 'free' END,
            'terminal', v_terminal,
            'approved_price', p_has_approved_price,
            'non_grant_reason', CASE
                WHEN v_status IN ('active', 'trialing') AND NOT p_has_approved_price THEN 'unapproved_price'
                WHEN NOT v_pro THEN 'non_granting_status'
                ELSE NULL
            END
        );
    EXCEPTION WHEN OTHERS THEN
        -- Roll back the processed marker so Stripe can retry (the Edge returns non-2xx on a false result).
        DELETE FROM public.processed_webhook_events WHERE event_id = p_event_id;
        v_error := SQLERRM;
        RETURN jsonb_build_object('success', false, 'error', v_error);
    END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_stripe_subscription_snapshot(text, text, text, text, boolean, boolean, bigint, uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_stripe_subscription_snapshot(text, text, text, text, boolean, boolean, bigint, uuid, bigint) TO service_role;
