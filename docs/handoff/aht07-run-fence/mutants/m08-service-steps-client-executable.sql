-- AHT-07 run settlement (PROPOSAL F, not in the migration chain; nothing applies this to any hosted database).
--
-- A run-owned id tied to the EXACT report idempotency keys, and a durable settlement record. No login session id, no
-- token, and no new column on user_issue_reports: the link is the existing unique `idempotency_key`.
--
--   * ct_runs: one row per run, registered by the service role BEFORE the account exists. The account's uid is recorded
--     on it inside the account-creation transaction (AFTER INSERT on auth.users), so a run-owned account is known as
--     run-owned before any token for it exists, and stays known after it is deleted (plain uuid, no FK).
--   * ct_run_keys: the exact idempotency keys the runner registers (service role) BEFORE each Send, up to the run's cap.
--     After settlement every key carries its outcome (deleted / absent): the durable settlement record.
--   * A report insert by a run-owned uid is admitted only while the run is open AND its idempotency_key is registered to
--     that run; a registered key can be used by no other identity. Admitted inserts hold the run's shared lock to COMMIT.
--   * The fence takes the run's exclusive lock and closes key registration, so it returns only after every admitted
--     insert has ended, and nothing enters afterwards (any session, user_id NULL, after account deletion).
--   * Settlement (after the account is deleted) deletes exactly the rows holding the run's keys and records each key's
--     outcome. The inventory is the pre-registered keys; the caller supplies none.
--
-- Run states: registered (before signup) -> open (uid recorded at signup) -> fenced -> settled (tombstone).

BEGIN;

CREATE TABLE public.ct_runs (
  ct_run           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repository       text NOT NULL CHECK (repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  workflow_path    text NOT NULL CHECK (workflow_path ~ '^\.github/workflows/[A-Za-z0-9_.-]+\.ya?ml$'),
  run_id           bigint NOT NULL CHECK (run_id > 0),
  run_attempt      integer NOT NULL CHECK (run_attempt > 0),
  test_id          text NOT NULL CHECK (test_id ~ '^[a-z0-9-]{1,80}$'),
  account_email    text NOT NULL UNIQUE CHECK (account_email = lower(account_email)),
  account_uid      uuid UNIQUE,                 -- plain uuid, no FK: the run-owned classification outlives the account
  state            text NOT NULL DEFAULT 'registered' CHECK (state IN ('registered','open','fenced','settled')),
  key_cap          integer NOT NULL CHECK (key_cap BETWEEN 0 AND 10),
  settled_deleted  integer,
  settled_absent   integer,
  registered_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  opened_at        timestamptz,
  fenced_at        timestamptz,
  settled_at       timestamptz,
  UNIQUE (repository, workflow_path, run_id, run_attempt, test_id),
  CHECK (state <> 'registered' OR account_uid IS NULL),
  CHECK (state <> 'open' OR account_uid IS NOT NULL),
  CHECK ((state = 'settled') = (settled_deleted IS NOT NULL AND settled_absent IS NOT NULL))
);

CREATE TABLE public.ct_run_keys (
  idempotency_key  uuid PRIMARY KEY,            -- one key belongs to at most one run
  ct_run           uuid NOT NULL REFERENCES public.ct_runs(ct_run),
  registered_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  outcome          text CHECK (outcome IN ('deleted','absent')),
  settled_at       timestamptz,
  CHECK ((outcome IS NULL) = (settled_at IS NULL))
);
CREATE INDEX ct_run_keys_run_idx ON public.ct_run_keys (ct_run);

ALTER TABLE public.ct_runs ENABLE ROW LEVEL SECURITY;      -- no policies: no client role can read or write them
ALTER TABLE public.ct_run_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ct_runs, public.ct_run_keys FROM PUBLIC, anon, authenticated, service_role;

-- Signup and email change serialize with registration on this per-email lock.
CREATE FUNCTION public.ct_email_lock_key(p_email text) RETURNS bigint
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT pg_catalog.hashtextextended('ct_email:' || pg_catalog.lower(p_email), 0) $$;

CREATE FUNCTION public.ct_run_lock_key(p_ct_run uuid) RETURNS bigint
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT pg_catalog.hashtextextended('ct_run:' || p_ct_run::text, 0) $$;

-- AFTER INSERT OR UPDATE OF email ON auth.users: records the uid on the registered run in the account-creation
-- transaction. Real users: one per-email advisory lock and one unique-index lookup.
CREATE FUNCTION public.ct_claim_account() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.email IS NULL THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND pg_catalog.lower(NEW.email) IS NOT DISTINCT FROM pg_catalog.lower(OLD.email) THEN RETURN NULL; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(public.ct_email_lock_key(NEW.email));
  IF TG_OP = 'INSERT' THEN
    UPDATE public.ct_runs SET account_uid = NEW.id, state = 'open', opened_at = pg_catalog.clock_timestamp()
     WHERE account_email = pg_catalog.lower(NEW.email) AND state = 'registered';
    IF FOUND THEN RETURN NULL; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.ct_runs WHERE account_email = pg_catalog.lower(NEW.email)) THEN
    RAISE EXCEPTION 'ct_run_email_not_claimable' USING ERRCODE = '42501';
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_ct_claim_account
  AFTER INSERT OR UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.ct_claim_account();

CREATE FUNCTION public.ct_report_write_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();                      -- the authenticated request identity, not NEW.user_id
  v_run public.ct_runs%ROWTYPE;
  v_key_run uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key AND EXISTS (
         SELECT 1 FROM public.ct_run_keys WHERE idempotency_key IN (OLD.idempotency_key, NEW.idempotency_key)) THEN
      RAISE EXCEPTION 'ct_key_immutable' USING ERRCODE = '42501';    -- any role, any policy, any grant
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.idempotency_key IS NOT NULL THEN
    SELECT ct_run INTO v_key_run FROM public.ct_run_keys WHERE idempotency_key = NEW.idempotency_key;
  END IF;
  IF v_uid IS NOT NULL THEN
    SELECT * INTO v_run FROM public.ct_runs WHERE account_uid = v_uid;
  END IF;
  IF v_run.ct_run IS NULL THEN
    IF v_key_run IS NOT NULL THEN                -- a run's key used by any other identity (incl. the service role)
      RAISE EXCEPTION 'ct_key_not_yours' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;                                  -- every real user: no lock, no change
  END IF;
  -- Run-owned uid (in any state, and after the account is deleted). Take the run's SHARED lock (transaction-level,
  -- fairly queued, held to COMMIT/ROLLBACK), then read the state again only while holding it.
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(public.ct_run_lock_key(v_run.ct_run));
  SELECT * INTO v_run FROM public.ct_runs WHERE ct_run = v_run.ct_run;
  IF v_run.state <> 'open' THEN
    RAISE EXCEPTION 'ct_run_fenced' USING ERRCODE = '42501';
  END IF;
  IF v_key_run IS DISTINCT FROM v_run.ct_run THEN
    RAISE EXCEPTION 'ct_key_unregistered' USING ERRCODE = '42501';  -- no key, an unknown key, or another run's key
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_uid) THEN
    RAISE EXCEPTION 'ct_run_account_gone' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_ct_report_write_guard
  BEFORE INSERT OR UPDATE ON public.user_issue_reports
  FOR EACH ROW EXECUTE FUNCTION public.ct_report_write_guard();

-- Service-only steps. Identity and state are never parameters. Each returns or raises; a raise is HOLD for the caller.
CREATE FUNCTION public.ct_register_run(p_repository text, p_workflow_path text, p_run_id bigint, p_run_attempt integer,
  p_test_id text, p_account_email text, p_key_cap integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ct uuid;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(public.ct_email_lock_key(p_account_email));
  IF EXISTS (SELECT 1 FROM auth.users WHERE pg_catalog.lower(email) = pg_catalog.lower(p_account_email)) THEN
    RAISE EXCEPTION 'ct_register_account_exists';
  END IF;
  INSERT INTO public.ct_runs (repository, workflow_path, run_id, run_attempt, test_id, account_email, key_cap)
  VALUES (p_repository, p_workflow_path, p_run_id, p_run_attempt, p_test_id, pg_catalog.lower(p_account_email), p_key_cap)
  RETURNING ct_run INTO v_ct;
  RETURN v_ct;
END $$;

-- Register the exact idempotency key the runner is about to Send. Row lock on the run: serializes with the fence.
CREATE FUNCTION public.ct_register_key(p_ct_run uuid, p_key uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_run public.ct_runs%ROWTYPE;
BEGIN
  IF p_key IS NULL THEN RAISE EXCEPTION 'ct_key_null'; END IF;
  SELECT * INTO v_run FROM public.ct_runs WHERE ct_run = p_ct_run FOR UPDATE;
  IF NOT FOUND OR v_run.state <> 'open' THEN RAISE EXCEPTION 'ct_key_refused_state'; END IF;
  IF (SELECT count(*) FROM public.ct_run_keys WHERE ct_run = p_ct_run) >= v_run.key_cap THEN
    RAISE EXCEPTION 'ct_key_over_cap';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ct_run_keys WHERE idempotency_key = p_key) THEN RAISE EXCEPTION 'ct_key_taken'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_issue_reports WHERE idempotency_key = p_key) THEN RAISE EXCEPTION 'ct_key_already_used'; END IF;
  INSERT INTO public.ct_run_keys (idempotency_key, ct_run) VALUES (p_key, p_ct_run);
END $$;

-- The fence. Waits (up to p_lock_timeout_ms) for every admitted insert on this run to end; then nothing more can enter.
CREATE FUNCTION public.ct_fence_run(p_ct_run uuid, p_lock_timeout_ms integer) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_state text;
BEGIN
  IF p_lock_timeout_ms IS NULL OR p_lock_timeout_ms NOT BETWEEN 1 AND 60000 THEN RAISE EXCEPTION 'ct_fence_bad_timeout'; END IF;
  PERFORM pg_catalog.set_config('lock_timeout', p_lock_timeout_ms::text || 'ms', true);
  SELECT state INTO v_state FROM public.ct_runs WHERE ct_run = p_ct_run FOR UPDATE;   -- serializes with signup and keys
  IF NOT FOUND THEN RAISE EXCEPTION 'ct_fence_unknown_run'; END IF;
  IF v_state IN ('fenced','settled') THEN RETURN v_state; END IF;                   -- second fencer
  PERFORM pg_catalog.pg_advisory_xact_lock(public.ct_run_lock_key(p_ct_run));
  UPDATE public.ct_runs SET state = 'fenced', fenced_at = pg_catalog.clock_timestamp() WHERE ct_run = p_ct_run;
  RETURN 'fenced';
END $$;

-- After the fence: the account recorded at signup (the only account cleanup may delete for this run; email is not proof).
CREATE FUNCTION public.ct_run_account(p_ct_run uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_run public.ct_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.ct_runs WHERE ct_run = p_ct_run;
  IF NOT FOUND OR v_run.state <> 'fenced' THEN RAISE EXCEPTION 'ct_account_requires_fence'; END IF;
  RETURN v_run.account_uid;
END $$;

-- Settle: after the account is gone, delete exactly the rows holding this run's registered keys and record each key's
-- outcome. One transaction: a crash settles nothing, and a second settler returns the recorded result.
CREATE FUNCTION public.ct_settle_run(p_ct_run uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_run public.ct_runs%ROWTYPE; v_keys integer; v_deleted integer;
BEGIN
  SELECT * INTO v_run FROM public.ct_runs WHERE ct_run = p_ct_run FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ct_settle_unknown_run'; END IF;
  IF v_run.state = 'settled' THEN RETURN v_run.settled_deleted || ':' || v_run.settled_absent; END IF;
  IF v_run.state <> 'fenced' THEN RAISE EXCEPTION 'ct_settle_requires_fence'; END IF;
  IF v_run.account_uid IS NOT NULL AND EXISTS (SELECT 1 FROM auth.users WHERE id = v_run.account_uid) THEN
    RAISE EXCEPTION 'ct_settle_account_still_exists';
  END IF;
  SELECT count(*) INTO v_keys FROM public.ct_run_keys WHERE ct_run = p_ct_run;
  IF v_keys > v_run.key_cap THEN RAISE EXCEPTION 'ct_settle_over_cap'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_issue_reports r JOIN public.ct_run_keys k USING (idempotency_key)
             WHERE k.ct_run = p_ct_run AND r.user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'ct_settle_owned_report';
  END IF;
  UPDATE public.ct_run_keys k SET outcome = CASE WHEN EXISTS (SELECT 1 FROM public.user_issue_reports r
           WHERE r.idempotency_key = k.idempotency_key) THEN 'deleted' ELSE 'absent' END,
         settled_at = pg_catalog.clock_timestamp()
   WHERE k.ct_run = p_ct_run;
  DELETE FROM public.user_issue_reports r USING public.ct_run_keys k
   WHERE k.ct_run = p_ct_run AND r.idempotency_key = k.idempotency_key;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> (SELECT count(*) FROM public.ct_run_keys WHERE ct_run = p_ct_run AND outcome = 'deleted') THEN
    RAISE EXCEPTION 'ct_settle_delete_count';
  END IF;
  UPDATE public.ct_runs SET state = 'settled', settled_deleted = v_deleted, settled_absent = v_keys - v_deleted,
    settled_at = pg_catalog.clock_timestamp() WHERE ct_run = p_ct_run;
  RETURN v_deleted || ':' || (v_keys - v_deleted);
END $$;

-- Read-only settlement record for the runner's evidence: one line per key, in key order.
CREATE FUNCTION public.ct_settlement(p_ct_run uuid) RETURNS TABLE (idempotency_key uuid, outcome text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT k.idempotency_key, k.outcome FROM public.ct_run_keys k WHERE k.ct_run = p_ct_run ORDER BY 1 $$;

-- Supabase grants every new public function to anon, authenticated and service_role by default: revoke explicitly.
REVOKE ALL ON FUNCTION public.ct_email_lock_key(text), public.ct_run_lock_key(uuid), public.ct_claim_account(),
  public.ct_report_write_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ct_register_run(text,text,bigint,integer,text,text,integer), public.ct_register_key(uuid,uuid),
  public.ct_fence_run(uuid,integer), public.ct_run_account(uuid), public.ct_settle_run(uuid), public.ct_settlement(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ct_register_run(text,text,bigint,integer,text,text,integer), public.ct_register_key(uuid,uuid),
  public.ct_fence_run(uuid,integer), public.ct_run_account(uuid), public.ct_settle_run(uuid), public.ct_settlement(uuid)
  TO service_role;

COMMIT;
