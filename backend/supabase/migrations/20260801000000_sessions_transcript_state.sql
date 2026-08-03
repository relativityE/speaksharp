-- #1047 PR-U1 — Canonical, SERVER-OWNED transcript state.
--
-- Adds an explicit `transcript_state` to public.sessions so every surface (History, session detail,
-- Analytics, PDF) reads one authoritative answer to "is there a transcript?" instead of inferring it from
-- an empty string (which silently renders as a measured zero) or a client guess.
--
-- Closed value set:
--   available     : a persisted, non-empty transcript exists.
--   not_captured  : no usable transcript was captured (e.g. a failed/degraded finalization).
--   expired       : a server RETENTION operation explicitly removed prior transcript text. This is the
--                   ONLY state a client can never produce or infer, and it is set ONLY by the retention
--                   mutation owned by #1117 — NOT by this PR. `expired` is never inferred from emptiness;
--                   an empty transcript is `not_captured`, not `expired`.
--
-- Server-owned enforcement: a BEFORE INSERT/UPDATE trigger DERIVES the state from transcript presence on
-- every write, so a client UPDATE can never self-assert any state (it is overwritten) — and in particular
-- can never assert `expired`. Once `expired` is set (by the future #1117 retention op) it is STICKY: a
-- later re-save cannot silently downgrade it back to not_captured/available. This PR performs NO transcript
-- deletion and NEVER writes `expired`; it only establishes the column, its derivation, and its contract.
--
-- Compatibility: purely additive with a DEFAULT + a trigger the currently deployed app is unaware of.
-- Old-app inserts still succeed; the trigger sets the correct state from the transcript they write.
-- Rollback: DROP TRIGGER + DROP FUNCTION + `ALTER TABLE public.sessions DROP COLUMN IF EXISTS
-- transcript_state;` (drops the column and its CHECK). No other column is affected.
--
-- NOT APPLIED TO PRODUCTION BY THIS PR. Requires separate Product Owner migration approval before deploy.

-- 1) Additive nullable column so existing rows are untouched initially.
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS transcript_state TEXT;

-- 2) Backfill EXISTING rows from transcript presence ONLY. Never `expired` — no retention op has run, and
--    `expired` must never be inferred from an absent/empty transcript.
UPDATE public.sessions
  SET transcript_state = CASE
    WHEN transcript IS NOT NULL AND transcript ~ '[^[:space:]]' THEN 'available'
    ELSE 'not_captured'
  END
  WHERE transcript_state IS NULL;

-- 3) New rows that omit the column derive to a safe default; the trigger below corrects it from the actual
--    transcript at write time regardless.
ALTER TABLE public.sessions
  ALTER COLUMN transcript_state SET DEFAULT 'not_captured';

ALTER TABLE public.sessions
  ALTER COLUMN transcript_state SET NOT NULL;

-- 4) Closed value set. Scoped to public.sessions (conrelid), not by name alone, so a same-named constraint
--    on another relation can never cause this CHECK to be silently skipped.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sessions_transcript_state_check'
      AND conrelid = 'public.sessions'::regclass
      AND contype = 'c'
  ) THEN
    ALTER TABLE public.sessions
      ADD CONSTRAINT sessions_transcript_state_check
      CHECK (transcript_state IN ('available', 'expired', 'not_captured'));
  END IF;
END $$;

-- INVARIANT BACKSTOP (locked U1 rule): `expired` never carries transcript text. Enforced at the DB boundary
-- as a CHECK so it holds even when the derivation trigger is bypassed (e.g. #1117's privileged retention
-- path) — a contradictory insert/update is rejected, never silently accepted.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sessions_expired_transcript_null_check'
      AND conrelid = 'public.sessions'::regclass
      AND contype = 'c'
  ) THEN
    ALTER TABLE public.sessions
      ADD CONSTRAINT sessions_expired_transcript_null_check
      CHECK (transcript_state <> 'expired' OR transcript IS NULL);
  END IF;
END $$;

-- 5) Server-owned derivation. Runs BEFORE INSERT/UPDATE so the stored state always matches the transcript
--    the server actually persisted, and any client-supplied transcript_state is overwritten (clients can
--    never self-assert a state — least of all `expired`).
CREATE OR REPLACE FUNCTION public.sessions_set_transcript_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- STICKY expiry: once a retention operation (#1117) has expired a row, a later re-save must not silently
  -- resurrect it to not_captured/available. `expired` is only ever established by that retention path; this
  -- clause is forward-compatible and, in this PR, is never reachable because nothing sets `expired` yet.
  IF TG_OP = 'UPDATE' AND OLD.transcript_state = 'expired' THEN
    -- STICKY + INVARIANT: an expired row stays expired AND its transcript stays NULL, so a later ordinary
    -- re-save can never silently reintroduce retention-removed text (resurrection prevention).
    NEW.transcript_state := 'expired';
    NEW.transcript := NULL;
  ELSIF NEW.transcript IS NOT NULL AND NEW.transcript ~ '[^[:space:]]' THEN
    NEW.transcript_state := 'available';
  ELSE
    NEW.transcript_state := 'not_captured';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sessions_set_transcript_state ON public.sessions;
CREATE TRIGGER trg_sessions_set_transcript_state
  BEFORE INSERT OR UPDATE OF transcript, transcript_state ON public.sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.sessions_set_transcript_state();

-- 6) Cheap filter for the transcript-less surfaces / future retention sweeps.
CREATE INDEX IF NOT EXISTS idx_sessions_transcript_state
  ON public.sessions (user_id, transcript_state);
