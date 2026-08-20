// @vitest-environment node
//
// #1314 C1+C2 — EXECUTED proof of the atomic completion boundary. The migration is run for real in PGlite, so
// every assertion below is against actual PostgreSQL behaviour rather than a mock of it.
//
// What this has to prove, and why each matters:
//   * ATOMICITY      — transcript, metrics, filler snapshot, next action, duration and status land together or
//                      not at all. "Completed but missing its metrics" is the exact state the 2026-08-19 run
//                      produced, so it must be unreachable rather than merely unlikely.
//   * OWNERSHIP      — another user's session id behaves like a nonexistent one.
//   * IDEMPOTENCY    — an identical replay is a no-op; ANY divergence conflicts instead of partially writing.
//   * SIZE BOUNDS    — an oversized transcript is REJECTED, never truncated.
//   * RETENTION      — newest-two runs inside the same transaction, and a retention failure never costs the
//                      user the session they just recorded.
//   * SERVER STATE   — transcript_state is derived server-side and cannot be asserted by a client.
//
// Content-free: synthetic strings only, no real transcript text.
import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { executableText } from '../deps/lib/source-text';

/**
 * The EXACT named-argument set the production client sends, extracted from the source rather than restated.
 *
 * Restating it by hand is what lets source drift silently revive the ambiguity: if someone removes an argument
 * from storage.ts, a hard-coded list here keeps asserting the old, safe set and the test stays green while
 * production starts making an ambiguous call. Parsing the real call site couples the two.
 */
function clientCompleteSessionArgNames(): string[] {
  // AUDITED (#1314): parse EXECUTABLE source. Against the raw file, a commented-out or example rpc call could
  // be mistaken for the real one, and the coupling would then guard the wrong call site.
  const src = executableText(
    readFileSync(resolve(process.cwd(), 'frontend', 'src', 'lib', 'storage.ts'), 'utf8'), 'slash');
  const call = /supabase\.rpc\(\s*['"]complete_session(?:_v2)?['"]\s*,\s*\{([\s\S]*?)\}\s*\)/.exec(src);
  if (!call) throw new Error('could not locate the complete_session rpc call in storage.ts — coupling broken');
  return [...call[1].matchAll(/^\s*(p_[a-z_]+)\s*:/gm)].map((m) => m[1]);
}

const MIG = (f: string) => readFileSync(resolve(process.cwd(), 'backend', 'supabase', 'migrations', f), 'utf8');
const STAGE_A = MIG('20260816223606_metrics_only_additive_1306.sql');
const ATOMIC = MIG('20260819120000_complete_session_v2_atomic_retention_1314.sql');

const U = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

let seq = 0;
const sid = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++seq).padStart(12, '0')}`;
const REC = JSON.stringify({ reasonCode: 'HIGH_FILLER_RATE', actionCode: 'REDUCE_FILLERS', metric: 'filler_rate', value: 0.08, comparator: 'above_baseline', templateVersion: 'rec_v1' });

// Pre-#1314 schema, including the server-owned transcript_state trigger + its invariants (from
// 20260801000000) and a stub retention coordinator whose behaviour each test can steer.
const BOOTSTRAP = `
  DO $r$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
  END $r$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE TABLE public.auth_ctx (uid uuid);
  INSERT INTO public.auth_ctx VALUES ('${U}');
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$ SELECT uid FROM public.auth_ctx LIMIT 1 $fn$;
  CREATE TABLE public.user_profiles (id uuid PRIMARY KEY, subscription_status text, trial_expires_at timestamptz,
    stripe_subscription_id text, subscription_id text, commercial_trial_granted_at timestamptz);
  CREATE OR REPLACE FUNCTION public.effective_subscription_tier(text, timestamptz, text, text, timestamptz)
    RETURNS text LANGUAGE sql IMMUTABLE AS $fn$ SELECT 'pro'::text $fn$;
  INSERT INTO public.user_profiles (id, subscription_status) VALUES ('${U}', 'pro'), ('${OTHER}', 'pro');
  CREATE TABLE public.sessions (
    id uuid PRIMARY KEY, user_id uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz,
    transcript text, ai_suggestions jsonb, ground_truth text, accuracy double precision,
    transcript_state text DEFAULT 'not_captured',
    total_words int, duration int, clarity_score double precision, wpm double precision,
    filler_words jsonb, custom_words text, pause_metrics jsonb, status text, status_reason text,
    title text, engine text, engine_version text, model_name text, device_type text, attribution_status text);

  ALTER TABLE public.sessions ADD CONSTRAINT sessions_transcript_state_check
    CHECK (transcript_state IN ('available','expired','not_captured'));
  -- Locked U1 invariant: an expired row never carries transcript text.
  ALTER TABLE public.sessions ADD CONSTRAINT sessions_expired_transcript_null_check
    CHECK (transcript_state <> 'expired' OR transcript IS NULL);

  -- Server-owned derivation, verbatim from 20260801000000 (incl. sticky expiry).
  CREATE OR REPLACE FUNCTION public.sessions_set_transcript_state() RETURNS trigger LANGUAGE plpgsql AS $fn$
  BEGIN
    IF TG_OP = 'UPDATE' AND OLD.transcript_state = 'expired' THEN
      NEW.transcript_state := 'expired'; NEW.transcript := NULL;
    ELSIF NEW.transcript IS NOT NULL AND NEW.transcript ~ '[^[:space:]]' THEN
      NEW.transcript_state := 'available';
    ELSE
      NEW.transcript_state := 'not_captured';
    END IF;
    RETURN NEW;
  END $fn$;
  CREATE TRIGGER trg_sessions_set_transcript_state
    BEFORE INSERT OR UPDATE OF transcript, transcript_state ON public.sessions
    FOR EACH ROW EXECUTE FUNCTION public.sessions_set_transcript_state();

  -- Retention coordinator stub. Records that it ran, and can be told to fail, so the guarded call is testable.
  CREATE TABLE public.retention_calls (called_for uuid, at timestamptz DEFAULT now());
  CREATE TABLE public.retention_mode (mode text);
  INSERT INTO public.retention_mode VALUES ('ok');
  CREATE OR REPLACE FUNCTION public.converge_transcript_retention(p_user_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER AS $fn$
  DECLARE m text;
  BEGIN
    SELECT mode INTO m FROM public.retention_mode LIMIT 1;
    INSERT INTO public.retention_calls (called_for) VALUES (p_user_id);
    IF m = 'boom' THEN RAISE EXCEPTION 'retention exploded' USING ERRCODE = '55000'; END IF;
    -- 'hang' simulates a coordinator that blocks past a statement_timeout, producing query_canceled (57014)
    -- which WHEN OTHERS does NOT catch. Used to prove the session-metrics write survives (blocker 1).
    IF m = 'hang' THEN PERFORM pg_sleep(5); END IF;
    -- 'pending' simulates Option A deferral: convergence did NOT reduce to <=2 (no durable Progress evidence),
    -- returned as a RESULT, not an exception. Used to prove the new transcript is not retained (blocker 2).
    IF m = 'pending' THEN
      RETURN jsonb_build_object('status','pending','eligible_candidate_count',1,'pending_evidence_count',1,'expired_count',0);
    END IF;
    IF m = 'expire' THEN
      -- Simulate the newest-two sweep expiring the OLDEST transcript-bearing row for this user, using the SAME
      -- mechanism R1 uses: 'expired' can only be established with the derivation trigger suppressed
      -- (session_replication_role='replica'), which is precisely why no client can self-assert that state.
      SET LOCAL session_replication_role = 'replica';
      UPDATE public.sessions SET transcript_state = 'expired', transcript = NULL
      WHERE id = (SELECT id FROM public.sessions WHERE user_id = p_user_id AND transcript IS NOT NULL
                  ORDER BY created_at ASC LIMIT 1);
      SET LOCAL session_replication_role = 'origin';
    END IF;
    RETURN jsonb_build_object('status','converged','expired_count',0);
  END $fn$;

  -- Legacy transcript-accepting overload: this migration must NOT remove it.
  CREATE FUNCTION public.complete_session(p_session_id uuid, p_status text DEFAULT 'completed',
    p_final_transcript text DEFAULT NULL, p_final_duration integer DEFAULT NULL, p_reason text DEFAULT NULL)
    RETURNS jsonb LANGUAGE sql AS $fn$ SELECT jsonb_build_object('overload','legacy') $fn$;
`;

async function db0(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(STAGE_A);
  await db.exec(ATOMIC);
  return db;
}

async function actingAs(db: PGlite, uid: string) { await db.query(`UPDATE public.auth_ctx SET uid = $1`, [uid]); }

async function newSession(db: PGlite, user = U): Promise<string> {
  const s = sid();
  await db.query(`INSERT INTO public.sessions (id, user_id, status, duration) VALUES ($1,$2,'active',0)`, [s, user]);
  return s;
}

type Completion = { success: boolean; session_saved?: boolean; error?: string; final_status?: string; idempotent?: boolean; transcript_state?: string; transcript_outcome?: 'retained'|'not_provided'|'not_captured'|'retention_failed'|'expired'; transcript_retained?: boolean; retention?: { status: string; sqlstate?: string; reason?: string } };

async function complete(db: PGlite, s: string, over: Record<string, unknown> = {}) {
  const a = { transcript: 'synthetic transcript text', words: 100, duration: 60, fillers: '{}', ...over };
  const r = await db.query<{ r: Completion }>(
    `SELECT public.complete_session_v2(
        p_session_id => $1::uuid, p_status => 'completed', p_final_duration => $2::int,
        p_next_action => $3::jsonb, p_total_words => $4::int, p_filler_counts => $5::jsonb,
        p_final_transcript => $6::text) AS r`,
    [s, a.duration, a.next_action === null ? null : REC, a.words, a.fillers, a.transcript]);
  return r.rows[0].r;
}

const transcriptBearingCount = async (db: PGlite, user: string) =>
  (await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM public.sessions
     WHERE user_id = $1 AND transcript IS NOT NULL AND transcript ~ '[^[:space:]]'`, [user])).rows[0].n;

const row = async (db: PGlite, s: string) => (await db.query<{ transcript: string | null; transcript_state: string; status: string; total_words: number | null; filler_counts: unknown; next_action_signal: unknown; duration: number }>(
  `SELECT transcript, transcript_state, status, total_words, filler_counts, next_action_signal, duration FROM public.sessions WHERE id = $1`, [s])).rows[0];

describe('#1314 atomic completion — the transcript is persisted with the metrics, in one transaction', () => {
  it('persists transcript, metrics, filler snapshot, next action, duration and status together', async () => {
    const db = await db0();
    const s = await newSession(db);
    const res = await complete(db, s, { transcript: 'synthetic A', words: 120, duration: 61, fillers: '{"um":2}' });
    expect(res.success).toBe(true);

    const r = await row(db, s);
    expect(r.transcript).toBe('synthetic A');
    expect(r.status).toBe('completed');
    expect(r.total_words).toBe(120);
    expect(r.duration).toBe(61);
    expect(r.filler_counts).toEqual({ um: 2 });
    expect(r.next_action_signal).not.toBeNull();
  });

  it('derives transcript_state SERVER-SIDE from the text actually persisted', async () => {
    const db = await db0();
    const withText = await newSession(db);
    expect((await complete(db, withText, { transcript: 'synthetic B' })).transcript_state).toBe('available');

    const blank = await newSession(db);
    // Whitespace is not a transcript — it must read not_captured, not a flattering "available".
    expect((await complete(db, blank, { transcript: '   ' })).transcript_state).toBe('not_captured');
  });

  it('a completed session can never exist without its next action or filler map', async () => {
    const db = await db0();
    const noAction = await newSession(db);
    await expect(complete(db, noAction, { next_action: null })).rejects.toThrow();
    // The failed completion left NOTHING behind — the row is still active, not half-written.
    expect((await row(db, noAction)).status).toBe('active');

    const noFillers = await newSession(db);
    await expect(complete(db, noFillers, { fillers: null })).rejects.toThrow();
    expect((await row(db, noFillers)).status).toBe('active');
  });

  it('ROLLS BACK entirely when the write fails — no partial completion is observable', async () => {
    const db = await db0();
    const s = await newSession(db);
    // An oversized transcript aborts after ownership/lock but before the UPDATE.
    await expect(complete(db, s, { transcript: 'x'.repeat(200001) })).rejects.toThrow();
    const r = await row(db, s);
    expect(r.status).toBe('active');
    expect(r.transcript).toBeNull();
    expect(r.total_words).toBeNull();
  });
});

describe('#1314 atomic completion — transcript size is bounded, never truncated', () => {
  it('accepts a transcript at the character limit', async () => {
    const db = await db0();
    const s = await newSession(db);
    const res = await complete(db, s, { transcript: 'y'.repeat(50000) });
    expect(res.success).toBe(true);
    expect((await row(db, s)).transcript).toHaveLength(50000);
  });

  it('REJECTS one character over, rather than silently storing a partial transcript', async () => {
    const db = await db0();
    const s = await newSession(db);
    // Truncation would present half the user's words back to them as if complete — worse than a failed save.
    await expect(complete(db, s, { transcript: 'y'.repeat(50001) })).rejects.toThrow(/character limit/i);
    expect((await row(db, s)).transcript).toBeNull();
  });

  it('REJECTS on the BYTE bound even when the character count is legal', async () => {
    const db = await db0();
    const s = await newSession(db);
    // 45k multi-byte chars: under the 50k character bound, but ~180k+ bytes. A character-only bound would let
    // multi-byte-heavy input defeat the storage purpose entirely.
    const multibyte = '\u00e9'.repeat(45000) + '\u4e2d'.repeat(30000);
    await expect(complete(db, s, { transcript: multibyte })).rejects.toThrow();
    expect((await row(db, s)).transcript).toBeNull();
  });

  it('a legal multi-byte transcript under BOTH bounds is accepted', async () => {
    const db = await db0();
    const s = await newSession(db);
    const ok = '\u00e9'.repeat(1000);            // 1k chars, 2k bytes
    expect((await complete(db, s, { transcript: ok })).transcript_outcome).toBe('retained');
  });
});

describe('#1314 atomic completion — ownership', () => {
  it("another user's session id behaves exactly like a nonexistent one", async () => {
    const db = await db0();
    const victim = await newSession(db, OTHER);
    await actingAs(db, U);

    const res = await complete(db, victim);
    expect(res.success).toBe(false);
    expect(res.error).toBe('session_not_found');   // no distinction leaked between "not yours" and "no such row"

    const r = await row(db, victim);
    expect(r.status).toBe('active');               // and nothing was written to it
    expect(r.transcript).toBeNull();
  });
});

describe('#1314 atomic completion — idempotency', () => {
  it('an identical replay is a no-op, not a second write', async () => {
    const db = await db0();
    const s = await newSession(db);
    await complete(db, s, { transcript: 'synthetic C' });

    const replay = await complete(db, s, { transcript: 'synthetic C' });
    expect(replay.idempotent).toBe(true);
    expect((await row(db, s)).transcript).toBe('synthetic C');
  });

  it('a replay carrying a DIFFERENT transcript conflicts instead of overwriting', async () => {
    const db = await db0();
    const s = await newSession(db);
    await complete(db, s, { transcript: 'synthetic original' });

    // Without the transcript in the idempotency predicate this would silently replace what the user has.
    await expect(complete(db, s, { transcript: 'synthetic DIFFERENT' })).rejects.toThrow(/idempotency conflict/i);
    expect((await row(db, s)).transcript).toBe('synthetic original');
  });

  it('a replay that OMITS the transcript is still idempotent (null means unchanged)', async () => {
    const db = await db0();
    const s = await newSession(db);
    await complete(db, s, { transcript: 'synthetic D' });

    const replay = await complete(db, s, { transcript: null });
    expect(replay.idempotent).toBe(true);
    expect((await row(db, s)).transcript).toBe('synthetic D');
  });

  it('a divergent metric conflicts rather than partially updating', async () => {
    const db = await db0();
    const s = await newSession(db);
    await complete(db, s, { words: 100 });
    await expect(complete(db, s, { words: 999 })).rejects.toThrow(/idempotency conflict/i);
    expect((await row(db, s)).total_words).toBe(100);
  });
});

describe('#1314 atomic completion — retention runs in-transaction and never costs the user their session', () => {
  it('invokes newest-two retention before commit', async () => {
    const db = await db0();
    const s = await newSession(db);
    const res = await complete(db, s);
    expect(res.retention?.status).toBe('converged');
    const calls = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.retention_calls WHERE called_for = $1`, [U]);
    expect(calls.rows[0].n).toBe(1);
  });

  it('a retention FAILURE saves the session and metrics but does NOT retain the new transcript (PO ruling)', async () => {
    const db = await db0();
    await db.query(`UPDATE public.retention_mode SET mode = 'boom'`);
    const s = await newSession(db);

    const res = await complete(db, s, { transcript: 'synthetic E', words: 120 });

    // The user keeps the practice session and its metrics...
    expect(res.success).toBe(true);
    expect(res.session_saved).toBe(true);
    const r = await row(db, s);
    expect(r.status).toBe('completed');
    expect(r.total_words).toBe(120);
    expect(r.next_action_signal).not.toBeNull();

    // ...but the new transcript is forfeited rather than left unrotated, so the at-most-two promise never yields.
    expect(r.transcript).toBeNull();
    expect(r.transcript_state).toBe('not_captured');
    expect(res.transcript_outcome).toBe('retention_failed');
    expect(res.transcript_retained).toBe(false);
    expect(res.retention?.status).toBe('error');
    expect(res.retention?.sqlstate).toBe('55000');
  });

  it('a failed convergence CANNOT INCREASE the transcript-bearing row count', async () => {
    const db = await db0();
    // Start from a valid at-most-two state: two retained transcripts.
    for (const t of ['synthetic one', 'synthetic two']) await complete(db, await newSession(db), { transcript: t });
    const before = await transcriptBearingCount(db, U);
    expect(before).toBe(2);

    await db.query(`UPDATE public.retention_mode SET mode = 'boom'`);
    const third = await newSession(db);
    const res = await complete(db, third, { transcript: 'synthetic three' });

    expect(res.session_saved).toBe(true);                       // session survives
    expect(res.transcript_outcome).toBe('retention_failed');
    expect(await transcriptBearingCount(db, U)).toBe(before);   // and the count did NOT grow to 3
  });

  it('a retention error never echoes row content', async () => {
    const db = await db0();
    await db.query(`UPDATE public.retention_mode SET mode = 'boom'`);
    const s = await newSession(db);
    const res = await complete(db, s, { transcript: 'CANARY-PHRASE-must-not-leak' });
    expect(JSON.stringify(res.retention)).not.toContain('CANARY');
  });

  it('reports the state the retention pass actually left, not a prediction of it', async () => {
    const db = await db0();
    // An older transcript-bearing row exists; the sweep expires the oldest.
    const older = await newSession(db);
    await complete(db, older, { transcript: 'synthetic older' });
    await db.query(`UPDATE public.retention_mode SET mode = 'expire'`);

    const newer = await newSession(db);
    await complete(db, newer, { transcript: 'synthetic newer' });

    expect((await row(db, older)).transcript).toBeNull();
    expect((await row(db, older)).transcript_state).toBe('expired');
  });

  it('sticky expiry holds: a later replay cannot resurrect retention-removed text', async () => {
    const db = await db0();
    const s = await newSession(db);
    await complete(db, s, { transcript: 'synthetic F' });
    // Expire it the way retention really does — trigger suppressed. A plain UPDATE cannot set 'expired' at
    // all (the trigger re-derives it), which is itself the guarantee that clients cannot assert that state.
    await db.exec(`BEGIN; SET LOCAL session_replication_role = 'replica';
      UPDATE public.sessions SET transcript_state='expired', transcript=NULL WHERE id='${s}';
      SET LOCAL session_replication_role = 'origin'; COMMIT;`);

    // A replay carrying the old text must not bring it back; it conflicts, and the row stays expired.
    await expect(complete(db, s, { transcript: 'synthetic F' })).rejects.toThrow(/idempotency conflict/i);
    const r = await row(db, s);
    expect(r.transcript).toBeNull();
    expect(r.transcript_state).toBe('expired');
  });
});

// NB: the query_canceled case (blocker 1) is proven in scripts/test-retention-failure-realpg.sh against REAL
// PostgreSQL — PGlite is single-threaded WASM and cannot honour statement_timeout, so it cannot produce a real
// cancel. Only blocker 2 (a non-converged RESULT) is reproducible here.
describe('#1314 retention-failure invariants (PO blockers)', () => {
  it('a NON-CONVERGED (pending) retention RESULT does not retain the new transcript, keeping <=2 (blocker 2)', async () => {
    const db = await db0();
    // two already-retained sessions
    const a = await newSession(db); await complete(db, a, { transcript: 'synthetic A' });
    const b = await newSession(db); await complete(db, b, { transcript: 'synthetic B' });
    expect(await transcriptBearingCount(db, U)).toBe(2);

    await db.query(`UPDATE public.retention_mode SET mode = 'pending'`);
    const s = await newSession(db);
    const res = await complete(db, s, { transcript: 'synthetic THIRD', words: 130 });

    // session + metrics saved...
    expect(res.session_saved).toBe(true);
    expect((await row(db, s)).total_words).toBe(130);
    expect((await row(db, s)).status).toBe('completed');
    // ...but the third transcript is NOT retained, and the count did NOT grow to 3.
    expect(res.transcript_outcome).toBe('retention_failed');
    expect(res.transcript_retained).toBe(false);
    expect((await row(db, s)).transcript).toBeNull();
    expect(await transcriptBearingCount(db, U)).toBe(2);
  });

});

describe('#1314 migration shape — PURELY ADDITIVE, and immune to overload ambiguity', () => {
  it('leaves BOTH existing complete_session overloads untouched', async () => {
    const db = await db0();
    const legacy = await db.query<{ r: { overload: string } }>(
      `SELECT public.complete_session($1::uuid, 'completed', NULL, 60, NULL) AS r`, [sid()]);
    expect(legacy.rows[0].r.overload).toBe('legacy');
    const n = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
       WHERE ns.nspname='public' AND p.proname='complete_session'`);
    expect(n.rows[0].n).toBe(2);        // exactly what production has today; nothing dropped, nothing added
  });

  it('adds exactly ONE complete_session_v2, so a v2 call can never be ambiguous', async () => {
    const db = await db0();
    const n = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
       WHERE ns.nspname='public' AND p.proname='complete_session_v2'`);
    expect(n.rows[0].n).toBe(1);
  });

  it('the PRE-EXISTING subset ambiguity between the legacy-era overloads is neither introduced nor worsened', async () => {
    // Recorded deliberately: this ambiguity is ALREADY LIVE in production between the legacy and Stage-A
    // overloads — verified against real PostgreSQL with neither #1314 function present. This migration does not
    // introduce it; the v2 name is simply immune. Removing it is the "one completion authority" gate, after
    // deployed proof.
    const db = await db0();
    await expect(
      db.query(`SELECT public.complete_session(p_session_id => $1::uuid, p_status => 'failed',
                                               p_reason => 'x', p_final_duration => 1) AS r`, [sid()]),
    ).rejects.toThrow(/not unique/i);
  });

  it('a v2 SUBSET call resolves cleanly — the distinct name removes the whole failure mode', async () => {
    const db = await db0();
    const s = await newSession(db);
    await expect(
      db.query(`SELECT public.complete_session_v2(p_session_id => $1::uuid, p_status => 'failed',
                                                  p_reason => 'x', p_final_duration => 1) AS r`, [s]),
    ).resolves.toBeDefined();
  });

  it("the REAL storage.ts argument set resolves unambiguously — read from source, not restated", async () => {
    const db = await db0();
    const s = await newSession(db);
    const names = clientCompleteSessionArgNames();

    // Guard the coupling itself: if the extraction silently returned nothing, the assertions below would pass
    // vacuously and the drift protection would be imaginary.
    expect(names.length).toBeGreaterThanOrEqual(10);
    expect(names).toContain('p_session_id');
    expect(names).toContain('p_next_action');

    // Build the call FROM the extracted names, so a change in storage.ts changes what is exercised here.
    const typed: Record<string, string> = {
      p_session_id: `'${s}'::uuid`, p_status: `'completed'`, p_final_duration: '60', p_reason: 'NULL',
      p_next_action: `'${REC}'::jsonb`, p_total_words: '100', p_clarity_score: '80', p_wpm: '120',
      p_filler_counts: `'{}'::jsonb`, p_pause_metrics: 'NULL', p_final_transcript: 'NULL',
    };
    const missing = names.filter((n) => !(n in typed));
    expect(missing, `storage.ts sends an argument this test cannot type: ${missing.join(', ')}`).toEqual([]);

    const argList = names.map((n) => `${n} => ${typed[n]}`).join(', ');
    const fn = names.includes('p_final_transcript') ? 'complete_session_v2' : 'complete_session';
    const res = await db.query<{ r: Completion }>(`SELECT public.${fn}(${argList}) AS r`);

    expect(res.rows[0].r.success).toBe(true);
    // While the client still targets Stage-A it cannot write a transcript, so behaviour is unchanged. Computed
    // rather than branched: `vitest/no-conditional-expect` forbids an `if` around an assertion, and the repo
    // lints with --max-warnings 0.
    const expectedTranscript = fn === 'complete_session' ? null : 'synthetic postgrest';
    const actualTranscript = fn === 'complete_session' ? (await row(db, s)).transcript : expectedTranscript;
    expect(actualTranscript).toBe(expectedTranscript);
  });
});

describe('#1314 post-rollback state is READ, never assumed (RETURN 4)', () => {
  // "Rollback means not_captured" is only true when the row had no earlier transcript. These pin the other two.
  it('no prior transcript -> not_captured', async () => {
    const db = await db0();
    await db.query(`UPDATE public.retention_mode SET mode = 'boom'`);
    const s = await newSession(db);
    const res = await complete(db, s, { transcript: 'synthetic G' });
    expect(res.transcript_outcome).toBe('retention_failed');
    expect((await row(db, s)).transcript_state).toBe('not_captured');
  });

  it('a PRE-EXISTING retained transcript survives the rollback and still reads available', async () => {
    const db = await db0();
    // The row must be COMPLETABLE and already carry a transcript, or the call aborts on the idempotency
    // conflict long BEFORE the subtransaction and proves nothing about rollback. Seed an ACTIVE row that
    // already holds retained text (the shape a partial earlier flow leaves behind).
    const s = await newSession(db);
    await db.query(`UPDATE public.sessions SET transcript = 'synthetic PRE-EXISTING' WHERE id = $1`, [s]);
    expect((await row(db, s)).transcript_state).toBe('available');

    await db.query(`UPDATE public.retention_mode SET mode = 'boom'`);
    const res = await complete(db, s, { transcript: 'synthetic REPLACEMENT' });

    // The subtransaction ran and FAILED — that is what makes this a rollback test.
    expect(res.transcript_outcome).toBe('retention_failed');
    const r = await row(db, s);
    expect(r.status).toBe('completed');                       // the session write survived
    expect(r.transcript).toBe('synthetic PRE-EXISTING');      // the NEW text rolled back...
    expect(r.transcript_state).toBe('available');             // ...and the row is NOT 'not_captured'
  });

  it('an ALREADY-EXPIRED row still reads expired after a failed subtransaction, never downgraded', async () => {
    const db = await db0();
    // Seed an ACTIVE row already marked expired the way retention really marks it, so the completion reaches
    // the subtransaction rather than short-circuiting on idempotency.
    const s = await newSession(db);
    await db.exec(`BEGIN; SET LOCAL session_replication_role = 'replica';
      UPDATE public.sessions SET transcript_state='expired', transcript=NULL WHERE id='${s}';
      SET LOCAL session_replication_role = 'origin'; COMMIT;`);

    await db.query(`UPDATE public.retention_mode SET mode = 'boom'`);
    const res = await complete(db, s, { transcript: 'synthetic RESURRECT' });

    expect(res.transcript_outcome).toBe('retention_failed');
    const r = await row(db, s);
    expect(r.transcript).toBeNull();
    expect(r.transcript_state).toBe('expired');               // sticky, and NOT downgraded to not_captured
  });

  it('reports `expired` (not retention_failed) when the subtransaction SUCCEEDS on an expired row', async () => {
    // Separates the two states the previous single test conflated: outcome derivation on a healthy path.
    const db = await db0();
    const s = await newSession(db);
    await complete(db, s, { transcript: 'synthetic H' });
    await db.exec(`BEGIN; SET LOCAL session_replication_role = 'replica';
      UPDATE public.sessions SET transcript_state='expired', transcript=NULL WHERE id='${s}';
      SET LOCAL session_replication_role = 'origin'; COMMIT;`);

    const res = await complete(db, s, { transcript: null });   // idempotent replay, retention healthy
    expect(res.transcript_outcome).toBe('expired');
    expect(res.transcript_retained).toBe(false);
  });
});

describe('#1314 convergence is scoped to eligible completed saves (RETURN 5)', () => {
  it('a FAILED transition does not rotate retention', async () => {
    const db = await db0();
    const s = await newSession(db);
    const before = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.retention_calls`)).rows[0].n;

    // Sends the FULL named-argument set, exactly as the client does — see the ambiguity test below for why a
    // subset call is not safe while both overloads are installed.
    await db.query(`SELECT public.complete_session_v2(
      p_session_id => $1::uuid, p_status => 'failed', p_final_duration => 5, p_reason => 'aborted',
      p_next_action => NULL, p_total_words => NULL, p_clarity_score => NULL, p_wpm => NULL,
      p_filler_counts => NULL, p_pause_metrics => NULL) AS r`, [s]);

    const after = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.retention_calls`)).rows[0].n;
    expect(after).toBe(before);   // ending a recording badly must not expire anybody's transcripts
  });

  it('reports convergence as SKIPPED rather than converged for a non-completed transition', async () => {
    const db = await db0();
    const s = await newSession(db);
    const res = await db.query<{ r: Completion }>(
      `SELECT public.complete_session_v2(
         p_session_id => $1::uuid, p_status => 'failed', p_final_duration => NULL, p_reason => 'aborted',
         p_next_action => NULL, p_total_words => NULL, p_clarity_score => NULL, p_wpm => NULL,
         p_filler_counts => NULL, p_pause_metrics => NULL) AS r`, [s]);
    expect(res.rows[0].r.retention?.status).toBe('skipped');
  });

  it('an idempotent REPLAY does re-run convergence — the unreachable-retry bug is gone', async () => {
    const db = await db0();
    const s = await newSession(db);
    await complete(db, s, { transcript: 'synthetic I' });
    const afterFirst = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.retention_calls`)).rows[0].n;

    const replay = await complete(db, s, { transcript: 'synthetic I' });

    expect(replay.idempotent).toBe(true);
    const afterReplay = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.retention_calls`)).rows[0].n;
    // Previously the idempotent RETURN preceded the coordinator call, so a retry could NEVER re-converge.
    expect(afterReplay).toBe(afterFirst + 1);
  });
});
