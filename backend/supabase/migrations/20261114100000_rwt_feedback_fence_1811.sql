-- #1811 AHT-01/02/07/08 recoverable feedback writes: a transactional run fence on user_issue_reports.
--
-- A live journey's disposable, run-owned account (app_metadata.ct_run, written only by the service role) may submit feedback.
-- Without this fence a runner lost mid-journey can leave reports the run cannot name. The fence makes the database itself the
-- durable, run-bound record and the writer-stop:
--   * open  — the service role opens ONE fence for the run-owned account, bound to its exact ct_run binding, the case(s) that
--             account runs (one, or several consolidated into one journey) and a key cap;
--   * write — every report the fenced account inserts takes the fence row lock, is refused once the fence is closed or past its
--             key cap or unkeyed, and has its id and idempotency key recorded IN THE SAME TRANSACTION (committed report ⇔ recorded);
--   * close — takes the same row lock, so it waits for every in-flight insert of that account, then refuses all later ones;
--   * clean — deletes exactly the recorded report ids (still owned by the account or ownerless), then reads them back to zero;
--   * verify — a READ-ONLY readback of one fence (exists/state/owner/recorded/remaining/foreign), for the runner's independent
--             zero check and to recover an uncertain open by its deterministic key instead of reopening (open is not idempotent);
--   * list   — a READ-ONLY list of fences not yet cleaned and older than an age floor (run key, state, binding, opened_at only),
--             so recovery finds a lost run's fence even after that run deleted its account (Sam, #1860 review).
--             Ownerless covers AHT-02: the product keeps feedback after account deletion (user_id ON DELETE SET NULL), so the
--             run's own reports survive its account; the fence still names them, and only them.
-- Accounts without a fence (every real user) are untouched: one indexed lookup, no lock, no change.
-- No application caller: only the service role reaches the RPCs; the table has no API grants.

CREATE TABLE public.rwt_feedback_fences (
  run_key text PRIMARY KEY CHECK (run_key ~ '^[0-9]{1,20}-[0-9]{1,4}-AHT-0[1278](\+AHT-0[1278]){0,3}$'),
  owner_uid uuid NOT NULL UNIQUE,
  -- The feedback-submitting journeys (Sam, #1859 review): AHT-01, the Focus journey (AHT-02), AHT-07 and AHT-08. One case, or a
  -- consolidated journey's cases in ascending order without repeats (e.g. 'AHT-07+AHT-08').
  case_id text NOT NULL CHECK (case_id IN ('AHT-01', 'AHT-02', 'AHT-07', 'AHT-08', 'AHT-01+AHT-02', 'AHT-01+AHT-07', 'AHT-01+AHT-08',
                                           'AHT-02+AHT-07', 'AHT-02+AHT-08', 'AHT-07+AHT-08', 'AHT-01+AHT-02+AHT-07', 'AHT-01+AHT-02+AHT-08',
                                           'AHT-01+AHT-07+AHT-08', 'AHT-02+AHT-07+AHT-08', 'AHT-01+AHT-02+AHT-07+AHT-08')),
  run_binding jsonb NOT NULL CHECK (jsonb_typeof(run_binding) = 'object'),
  key_cap integer NOT NULL CHECK (key_cap BETWEEN 1 AND 8),
  report_ids uuid[] NOT NULL DEFAULT '{}',
  report_keys uuid[] NOT NULL DEFAULT '{}',
  refused_writes integer NOT NULL DEFAULT 0 CHECK (refused_writes >= 0),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed', 'cleaned')),
  opened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  closed_at timestamptz,
  cleaned_at timestamptz,
  CHECK ((state = 'open') = (closed_at IS NULL)),
  CHECK ((state = 'cleaned') = (cleaned_at IS NOT NULL))
);
ALTER TABLE public.rwt_feedback_fences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rwt_feedback_fences FROM PUBLIC, anon, authenticated, service_role;

-- The write fence. BEFORE INSERT so the id the row will commit with is recorded atomically with it (a failed insert rolls the
-- record back with it). Keyed on the INSERTING identity (auth.uid()), not NEW.user_id: a fenced account cannot escape by inserting
-- an ownerless report.
CREATE FUNCTION public._rwt_feedback_fence_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_fence public.rwt_feedback_fences%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rwt_feedback_fences WHERE owner_uid = v_actor) THEN RETURN NEW; END IF;
  SELECT * INTO v_fence FROM public.rwt_feedback_fences WHERE owner_uid = v_actor FOR UPDATE;
  IF v_fence.state <> 'open' THEN
    RAISE EXCEPTION 'rwt feedback fence is closed' USING ERRCODE = '42501';
  END IF;
  IF NEW.idempotency_key IS NULL THEN
    RAISE EXCEPTION 'rwt feedback fence refuses an unkeyed report' USING ERRCODE = '42501';
  END IF;
  IF NOT (NEW.idempotency_key = ANY (v_fence.report_keys)) AND cardinality(v_fence.report_keys) >= v_fence.key_cap THEN
    RAISE EXCEPTION 'rwt feedback fence key cap reached' USING ERRCODE = '42501';
  END IF;
  UPDATE public.rwt_feedback_fences
     SET report_ids = report_ids || NEW.id,
         report_keys = CASE WHEN NEW.idempotency_key = ANY (report_keys) THEN report_keys ELSE report_keys || NEW.idempotency_key END
   WHERE run_key = v_fence.run_key;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._rwt_feedback_fence_v1() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER zz_rwt_feedback_fence
  BEFORE INSERT ON public.user_issue_reports
  FOR EACH ROW EXECUTE FUNCTION public._rwt_feedback_fence_v1();

-- Open: only for a run-owned RWT account whose service-written binding equals the run's, one fence per account.
CREATE FUNCTION public.open_rwt_feedback_fence_v1(p_owner uuid, p_binding jsonb, p_case text, p_key_cap integer)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_run_key text;
BEGIN
  IF p_owner IS NULL OR p_binding IS NULL OR jsonb_typeof(p_binding) <> 'object'
     OR p_binding->>'role' IS DISTINCT FROM 'rwt-journey'
     OR (p_binding->>'runId') !~ '^[1-9][0-9]{0,19}$' OR (p_binding->>'runAttempt') !~ '^[1-9][0-9]{0,3}$' THEN
    RAISE EXCEPTION 'rwt feedback fence: invalid binding' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_owner AND u.raw_app_meta_data->'ct_run' = p_binding) THEN
    RAISE EXCEPTION 'rwt feedback fence: account is not run-owned by this binding' USING ERRCODE = '42501';
  END IF;
  v_run_key := (p_binding->>'runId') || '-' || (p_binding->>'runAttempt') || '-' || p_case;
  INSERT INTO public.rwt_feedback_fences(run_key, owner_uid, case_id, run_binding, key_cap)
  VALUES (v_run_key, p_owner, p_case, p_binding, p_key_cap);
  RETURN v_run_key;
END $$;

-- Close: waits for every in-flight insert of the account (same row lock), then refuses all later ones. Idempotent.
CREATE FUNCTION public.close_rwt_feedback_fence_v1(p_run_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_fence public.rwt_feedback_fences%ROWTYPE;
BEGIN
  SELECT * INTO v_fence FROM public.rwt_feedback_fences WHERE run_key = p_run_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rwt feedback fence: unknown run' USING ERRCODE = 'P0002'; END IF;
  IF v_fence.state = 'open' THEN
    UPDATE public.rwt_feedback_fences SET state = 'closed', closed_at = clock_timestamp() WHERE run_key = p_run_key
    RETURNING * INTO v_fence;
  END IF;
  RETURN jsonb_build_object('state', v_fence.state, 'reports', cardinality(v_fence.report_ids), 'keys', cardinality(v_fence.report_keys));
END $$;

-- Clean: only a closed fence; deletes exactly the recorded ids that are still the account's or ownerless, then reads them back.
-- `cleaned` only on a zero readback. A recorded report now owned by another account is never deleted and keeps the fence closed.
CREATE FUNCTION public.clean_rwt_feedback_fence_v1(p_run_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_fence public.rwt_feedback_fences%ROWTYPE;
  v_deleted integer;
  v_residue integer;
  v_foreign integer;
BEGIN
  SELECT * INTO v_fence FROM public.rwt_feedback_fences WHERE run_key = p_run_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rwt feedback fence: unknown run' USING ERRCODE = 'P0002'; END IF;
  IF v_fence.state = 'open' THEN RAISE EXCEPTION 'rwt feedback fence: close before cleaning' USING ERRCODE = '55000'; END IF;
  SELECT count(*) INTO v_foreign FROM public.user_issue_reports r
   WHERE r.id = ANY (v_fence.report_ids) AND r.user_id IS NOT NULL AND r.user_id <> v_fence.owner_uid;
  DELETE FROM public.user_issue_reports r
   WHERE r.id = ANY (v_fence.report_ids) AND (r.user_id IS NULL OR r.user_id = v_fence.owner_uid);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  SELECT count(*) INTO v_residue FROM public.user_issue_reports r WHERE r.id = ANY (v_fence.report_ids);
  IF v_residue = 0 AND v_foreign = 0 AND v_fence.state = 'closed' THEN
    UPDATE public.rwt_feedback_fences SET state = 'cleaned', cleaned_at = clock_timestamp() WHERE run_key = p_run_key;
  END IF;
  RETURN jsonb_build_object('deleted', v_deleted, 'residue', v_residue, 'foreign', v_foreign,
    'state', CASE WHEN v_residue = 0 AND v_foreign = 0 THEN 'cleaned' ELSE v_fence.state END);
END $$;

-- Verify: read-only. Never writes, never locks; reports only counts, the state and the owner for the caller's own comparison.
CREATE FUNCTION public.verify_rwt_feedback_fence_v1(p_run_key text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_fence public.rwt_feedback_fences%ROWTYPE;
  v_remaining integer;
  v_foreign integer;
BEGIN
  SELECT * INTO v_fence FROM public.rwt_feedback_fences WHERE run_key = p_run_key;
  IF NOT FOUND THEN RETURN jsonb_build_object('exists', false); END IF;
  SELECT count(*) FILTER (WHERE r.user_id IS NULL OR r.user_id = v_fence.owner_uid),
         count(*) FILTER (WHERE r.user_id IS NOT NULL AND r.user_id <> v_fence.owner_uid)
    INTO v_remaining, v_foreign
    FROM public.user_issue_reports r WHERE r.id = ANY (v_fence.report_ids);
  RETURN jsonb_build_object('exists', true, 'state', v_fence.state, 'owner', v_fence.owner_uid, 'case', v_fence.case_id,
    'recorded', cardinality(v_fence.report_ids), 'keys', cardinality(v_fence.report_keys),
    'remaining', v_remaining, 'foreign', v_foreign);
END $$;

-- List: read-only. Unresolved (not cleaned) fences at least p_min_age_seconds old, oldest first; never report or account data.
CREATE FUNCTION public.list_unresolved_rwt_feedback_fences_v1(p_min_age_seconds integer)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('run_key', f.run_key, 'state', f.state, 'binding', f.run_binding,
           'opened_at', f.opened_at) ORDER BY f.opened_at, f.run_key), '[]'::jsonb)
    FROM public.rwt_feedback_fences f
   WHERE f.state <> 'cleaned' AND p_min_age_seconds >= 0
     AND f.opened_at <= clock_timestamp() - make_interval(secs => p_min_age_seconds);
$$;

REVOKE ALL ON FUNCTION public.open_rwt_feedback_fence_v1(uuid, jsonb, text, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.close_rwt_feedback_fence_v1(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.clean_rwt_feedback_fence_v1(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.verify_rwt_feedback_fence_v1(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_unresolved_rwt_feedback_fences_v1(integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.open_rwt_feedback_fence_v1(uuid, jsonb, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.close_rwt_feedback_fence_v1(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.clean_rwt_feedback_fence_v1(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_rwt_feedback_fence_v1(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_unresolved_rwt_feedback_fences_v1(integer) TO service_role;
