-- Durable, operator-visible signal for a refund follow-up the stripe-webhook could not verify (Sam's decision,
-- 2026-11-12). A charge.refunded event whose follow-up is "unverified" (for example, a renewal invoice already
-- outstanding after cancel_at_period_end was set), or a partial refund the product never offers, records one row
-- per refunded charge here. The row stays UNRESOLVED until an operator reconciles the outcome; nothing in the
-- webhook resolves it, and a later delivery that looks clean never does.
--
-- Restricted like the other operational records (account_checkout_rejections, stripe_subscription_tombstones):
-- RLS on and no direct table access for any API role, service_role included. The webhook writes only through
-- record_stripe_refund_followup (service_role EXECUTE); reconciliation is an operator act through
-- reconcile_stripe_refund_followup, which no API role can execute.
--
-- Content-free by construction: the closed reason code, Stripe's charge and event ids for correlation, the mode,
-- counts and times. No customer content, amount, card, email or secret, and no free text.
--
-- This only records. It never retries a refund, voids an invoice, cancels again or moves money, and it does not
-- say that no further charge will happen.

CREATE TABLE public.stripe_refund_followups (
  -- One row per refund operation: the refunded charge, or the event when the charge id itself was unreadable.
  operation_key text PRIMARY KEY
    CHECK (operation_key ~ '^(charge:(ch|py)_[A-Za-z0-9_]{1,200}|event:evt_[A-Za-z0-9_]{1,200})$'),
  livemode boolean,
  status text NOT NULL DEFAULT 'unresolved' CHECK (status IN ('unresolved', 'reconciled')),
  reason text NOT NULL CHECK (reason IN (
    'configuration_missing', 'refund_unreadable', 'stripe_read_failed', 'ownership_mismatch',
    'subscription_state_unverified', 'renewal_outstanding', 'update_failed', 'update_unconfirmed',
    'renewal_outstanding_after_update', 'boundary_unverified_after_update', 'partial_refund')),
  first_event_id text NOT NULL CHECK (first_event_id ~ '^evt_[A-Za-z0-9_]{1,200}$'),
  last_event_id text NOT NULL CHECK (last_event_id ~ '^evt_[A-Za-z0-9_]{1,200}$'),
  deliveries integer NOT NULL DEFAULT 1 CHECK (deliveries >= 1),
  first_seen_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  reconciled_at timestamptz,
  reconciliation text CHECK (reconciliation IS NULL
    OR reconciliation IN ('verified_no_outstanding_invoice', 'operator_resolved', 'not_actionable')),
  CHECK ((status = 'unresolved') = (reconciled_at IS NULL AND reconciliation IS NULL)),
  CHECK ((status = 'reconciled') = (reconciled_at IS NOT NULL AND reconciliation IS NOT NULL))
);
ALTER TABLE public.stripe_refund_followups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stripe_refund_followups FROM PUBLIC, anon, authenticated, service_role;

-- Records (or re-records) the signal for one refund operation. Returns true only when the row is written, so the
-- webhook can tell a durable signal from a failed write; every malformed input returns false and writes nothing.
-- A delivery of the event already recorded (Stripe redelivering a non-2xx answer) only counts the delivery, so an
-- operator's reconciliation is not undone by a retry of the same event. A different event for the same operation
-- that is still not verified reopens it: the problem was seen again after the reconciliation.
CREATE FUNCTION public.record_stripe_refund_followup(
  p_operation_key text, p_event_id text, p_livemode boolean, p_reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_operation_key IS NULL
    OR p_operation_key !~ '^(charge:(ch|py)_[A-Za-z0-9_]{1,200}|event:evt_[A-Za-z0-9_]{1,200})$'
    OR p_event_id IS NULL OR p_event_id !~ '^evt_[A-Za-z0-9_]{1,200}$'
    OR p_reason IS NULL OR p_reason NOT IN (
      'configuration_missing', 'refund_unreadable', 'stripe_read_failed', 'ownership_mismatch',
      'subscription_state_unverified', 'renewal_outstanding', 'update_failed', 'update_unconfirmed',
      'renewal_outstanding_after_update', 'boundary_unverified_after_update', 'partial_refund')
    THEN RETURN false; END IF;
  INSERT INTO public.stripe_refund_followups AS f (operation_key, livemode, reason, first_event_id, last_event_id)
    VALUES (p_operation_key, p_livemode, p_reason, p_event_id, p_event_id)
  ON CONFLICT (operation_key) DO UPDATE SET
    deliveries = f.deliveries + 1,
    last_seen_at = statement_timestamp(),
    last_event_id = EXCLUDED.last_event_id,
    reason = EXCLUDED.reason,
    livemode = COALESCE(EXCLUDED.livemode, f.livemode),
    status = CASE WHEN EXCLUDED.last_event_id IN (f.first_event_id, f.last_event_id) THEN f.status ELSE 'unresolved' END,
    reconciled_at = CASE WHEN EXCLUDED.last_event_id IN (f.first_event_id, f.last_event_id) THEN f.reconciled_at ELSE NULL END,
    reconciliation = CASE WHEN EXCLUDED.last_event_id IN (f.first_event_id, f.last_event_id) THEN f.reconciliation ELSE NULL END;
  RETURN true;
END;
$$;

-- An operator's record that the outcome was checked. Returns true only for an unresolved row it closes.
CREATE FUNCTION public.reconcile_stripe_refund_followup(p_operation_key text, p_reconciliation text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_reconciliation IS NULL OR p_reconciliation NOT IN
    ('verified_no_outstanding_invoice', 'operator_resolved', 'not_actionable') THEN RETURN false; END IF;
  UPDATE public.stripe_refund_followups
    SET status = 'reconciled', reconciled_at = statement_timestamp(), reconciliation = p_reconciliation
    WHERE operation_key = p_operation_key AND status = 'unresolved';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.record_stripe_refund_followup(text, text, boolean, text),
  public.reconcile_stripe_refund_followup(text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_stripe_refund_followup(text, text, boolean, text) TO service_role;
