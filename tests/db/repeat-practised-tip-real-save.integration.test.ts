// @vitest-environment node
//
// Outcome 4 D2 rev 2 — the chosen tip on the ACTUAL save path. Replaces the modelled save-order test.
//
// Every shipped versioned migration is applied in order over a minimal Supabase bootstrap (the same pattern
// trial-session-v2-current-chain.integration.test.ts uses), so `complete_session_v2`, newest-one retention
// (`converge_transcript_retention` → `expire_transcripts_newest_one`), the derived-content purge, the recording lease,
// session create, Progress RPCs and the D2 migration are all the real ones. Nothing is stubbed or restated.
// Each claim has a negative control: a mutant of the D2 triggers with the one rule removed, which must lose it.
//
// Content-free: synthetic identifiers and text only.
import { describe, it, expect, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const DIR = resolve(process.cwd(), 'backend', 'supabase', 'migrations');
const SHIPPED = readdirSync(DIR).filter((f) => /^\d{8,14}_.+\.sql$/.test(f)).sort();
const D2 = '20261112010000_repeat_practised_tip.sql';

/** Only what Supabase provides outside the migrations (verbatim from the trial current-chain suite). */
const SUPABASE_BOOTSTRAP = `
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
END $r$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, created_at timestamptz DEFAULT now(), raw_user_meta_data jsonb DEFAULT '{}'::jsonb);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('request.jwt.claim.role', true), '')::text $f$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT '{}'::jsonb $f$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
CREATE OR REPLACE FUNCTION public.uuid_generate_v4() RETURNS uuid LANGUAGE sql AS $f$ SELECT gen_random_uuid() $f$;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE IF NOT EXISTS storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql AS $f$ SELECT string_to_array(name,'/') $f$;
`;

const NEXT_ACTION = JSON.stringify({
    reasonCode: 'HIGH_FILLER_RATE', actionCode: 'REDUCE_FILLERS', metric: 'filler_rate',
    value: 0.08, comparator: 'above_baseline', templateVersion: 'rec_v1',
});
const TIP = 'Pause before you name the price.';
const REVIEW = JSON.stringify({ version: 'gemini_coaching_v1', what_worked: 'The opening was concrete.', what_to_try_next: TIP });

let db: PGlite | null = null;
afterEach(async () => { await db?.close(); db = null; });

async function shippedChain(opts: { activateRetention?: boolean } = {}): Promise<PGlite> {
    const pg = new PGlite();
    await pg.exec(SUPABASE_BOOTSTRAP);
    expect(SHIPPED.at(-1)).toBe(D2);
    for (const f of SHIPPED) await pg.exec(readFileSync(resolve(DIR, f), 'utf8'));
    if (opts.activateRetention !== false) await pg.query('SELECT public.activate_transcript_retention_newest_one()');
    return pg;
}

async function asUser<T>(uid: string, run: () => Promise<T>): Promise<T> {
    await db!.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid]);
    await db!.exec('SET ROLE authenticated');
    try { return await run(); } finally { await db!.exec('RESET ROLE'); }
}
const one = async <T>(sql: string, params: unknown[] = []) => (await db!.query<{ r: T }>(sql, params)).rows[0].r;

async function signup(): Promise<string> {
    const uid = randomUUID();
    await db!.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [uid, `d2-${uid}@example.test`]);
    return uid;
}

const leases = new Map<string, string>();

/** Start a take the way the app does: a recording lease, then the shipped create. */
async function startTake(uid: string): Promise<string> {
    return asUser(uid, async () => {
        const lease = randomUUID();
        const acquired = await one<{ acquired: boolean }>(`SELECT public.acquire_recording_lease($1::uuid, 'd2', false) AS r`, [lease]);
        expect(acquired.acquired).toBe(true);
        const created = await one<{ new_session: { id: string } | null; error?: string }>(
            `SELECT public.create_session_and_update_usage($1::jsonb, 'private') AS r`,
            [JSON.stringify({ title: 'd2', duration: 0, total_words: 0, lease_id: lease })]);
        expect(created.error ?? null).toBeNull();
        leases.set(created.new_session!.id, lease);
        return created.new_session!.id;
    });
}

/** Save it through the shipped `complete_session_v2`, exactly as the client calls it. */
async function saveTake(uid: string, sessionId: string, transcript: string | null): Promise<Record<string, unknown>> {
    const result = await asUser(uid, () => one<Record<string, unknown>>(
        `SELECT public.complete_session_v2(
             p_session_id => $1::uuid, p_status => 'completed', p_final_duration => 60, p_next_action => $2::jsonb,
             p_total_words => 120, p_clarity_score => 80, p_wpm => 130, p_filler_counts => '{"um":3}'::jsonb,
             p_final_transcript => $3) AS r`, [sessionId, NEXT_ACTION, transcript]));
    expect(result.success).toBe(true);
    // The client releases the recording lease once the take is saved, so the next take can start.
    await asUser(uid, () => one(`SELECT public.release_recording_lease($1::uuid) AS r`, [leases.get(sessionId)]));
    return result;
}

async function take(uid: string, transcript: string | null = 'synthetic words for this take'): Promise<string> {
    const id = await startTake(uid);
    await saveTake(uid, id, transcript);
    return id;
}

/** The coaching write for a saved session (service-side in the app; the review shape the client reads). */
const coach = (id: string) => db!.query(`UPDATE public.sessions SET ai_suggestions = $2::jsonb WHERE id = $1`, [id, REVIEW]);

/**
 * The engine attestation for a saved take. In the app the attest Edge function writes this with the service role
 * (session_attribution_authority, 20260803010000) and the session carries its engine identity; the evaluation is
 * only eligible with both. Written here as the service side would, since the Edge function is outside the database.
 */
async function attest(uid: string, id: string) {
    await db!.query(`UPDATE public.sessions SET engine = 'private', engine_version = 'v4', model_name = 'synthetic-model' WHERE id = $1`, [id]);
    await db!.query(`INSERT INTO public.session_attribution_authority (session_id, user_id, engine_class, engine, engine_version, model_id, provider)
                     VALUES ($1, $2, 'private', 'private', 'v4', 'synthetic-model', 'transformers-js-v4')`, [id, uid]);
}

/** A's Progress evaluation, its recommendation, and Practice again pressed — all through the shipped RPCs. */
async function pressPracticeAgain(uid: string, original: string): Promise<string> {
    await attest(uid, original);
    const evaluation = await asUser(uid, () => one<string | null>(`SELECT public.record_progress_evaluation($1) AS r`, [original]));
    const verdict = (await db!.query<{ eligible: boolean; exclusion_reasons: string[] }>(
        'SELECT eligible, exclusion_reasons FROM public.session_progress_evaluations WHERE id = $1', [evaluation])).rows[0];
    expect(verdict).toEqual({ eligible: true, exclusion_reasons: [] });
    return asUser(uid, async () => {
        const rec = await one<string>(
            `SELECT public.record_progress_recommendation($1, 'filler_rate', 'decrease', 3, 'percent of words', 'Cut fillers') AS r`, [original]);
        return one<string>(`SELECT public.record_recommendation_attempt($1) AS r`, [rec]);
    });
}

const advance = (uid: string, attempt: string, lifecycle: string, practice: string) => asUser(uid, async () => {
    await one(`SELECT public.record_progress_evaluation($1) AS r`, [practice]);
    return one<string>(`SELECT public.advance_recommendation_attempt($1, $2, $3, NULL) AS r`, [attempt, lifecycle, practice]);
});

type AttemptState = { practised_tip: string | null; tip_session_id: string | null; practice_session_id: string | null; lifecycle: string };
const attemptState = async (attempt: string) => (await db!.query<AttemptState>(
    'SELECT practised_tip, tip_session_id, practice_session_id, lifecycle FROM public.progress_recommendation_attempts WHERE id = $1',
    [attempt])).rows[0];
type SessionState = { transcript_state: string; has_transcript: boolean; has_review: boolean };
const sessionState = async (id: string) => (await db!.query<SessionState>(
    `SELECT transcript_state, transcript IS NOT NULL AS has_transcript, ai_suggestions IS NOT NULL AS has_review
       FROM public.sessions WHERE id = $1`, [id])).rows[0];

/** Records, in commit order inside the save, when the attempt is bound and when a transcript expires. */
async function recordEventOrder() {
    await db!.exec(`
        CREATE TABLE public.d2_event_log (seq bigserial PRIMARY KEY, event text, ref uuid);
        CREATE FUNCTION public.d2_log_bind() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN
            IF NEW.tip_session_id IS DISTINCT FROM OLD.tip_session_id THEN
                INSERT INTO public.d2_event_log(event, ref) VALUES ('bound', NEW.tip_session_id); END IF;
            RETURN NULL; END $f$;
        CREATE TRIGGER d2_log_bind AFTER UPDATE ON public.progress_recommendation_attempts FOR EACH ROW EXECUTE FUNCTION public.d2_log_bind();
        CREATE FUNCTION public.d2_log_expire() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN
            IF NEW.transcript_state = 'expired' AND OLD.transcript_state IS DISTINCT FROM 'expired' THEN
                INSERT INTO public.d2_event_log(event, ref) VALUES ('expired', NEW.id); END IF;
            RETURN NULL; END $f$;
        CREATE TRIGGER d2_log_expire AFTER UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.d2_log_expire();`);
    return async () => (await db!.query<{ event: string; ref: string }>('SELECT event, ref FROM public.d2_event_log ORDER BY seq')).rows;
}

// ── Negative controls: each removes exactly one D2 rule from the installed chain. ──
/** The first design Sam returned: no server binding; a pending copy is purged when its original expires. */
async function mutantFirstDesign() {
    await db!.exec(`
        DROP TRIGGER trg_sessions_prec_tip_on_completed ON public.sessions;
        CREATE FUNCTION public.d2_mutant_purge_pending_on_source_expiry() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $f$ BEGIN
            UPDATE public.progress_recommendation_attempts a SET practised_tip = NULL
              FROM public.progress_recommendations r
             WHERE r.id = a.recommendation_id AND r.source_session_id = NEW.id AND a.lifecycle = 'pending';
            RETURN NULL; END $f$;
        CREATE TRIGGER d2_mutant_purge AFTER UPDATE OF transcript_state ON public.sessions FOR EACH ROW
            WHEN (NEW.transcript_state = 'expired') EXECUTE FUNCTION public.d2_mutant_purge_pending_on_source_expiry();`);
}
/** The same D2 binding, but run at commit: after the save's retention has already expired the original. */
async function mutantBindAfterExpiry() {
    await db!.exec(`
        DROP TRIGGER trg_sessions_prec_tip_on_completed ON public.sessions;
        CREATE CONSTRAINT TRIGGER trg_sessions_prec_tip_on_completed AFTER INSERT OR UPDATE OF status ON public.sessions
            DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.status = 'completed')
            EXECUTE FUNCTION public._prec_att_on_session_completed();`);
}
/** Cleanup only by extending the existing purge: it runs on expiry and only when the session has coaching. */
async function mutantPurgeNeedsCoaching() {
    await db!.exec(`
        DROP TRIGGER trg_sessions_purge_practised_tip_on_expire ON public.sessions;
        CREATE TRIGGER trg_sessions_purge_practised_tip_on_expire AFTER UPDATE OF transcript_state ON public.sessions
            FOR EACH ROW WHEN (NEW.transcript_state = 'expired' AND OLD.transcript_state IS DISTINCT FROM 'expired'
                               AND NEW.ai_suggestions IS NOT NULL)
            EXECUTE FUNCTION public._prec_att_purge_tip_on_expire();`);
    await removeSupersedeOnSave();
}
/** Replace one fragment of an installed function. The fragment must occur exactly once. */
async function mutateFn(fn: string, from: string, to: string) {
    const def = (await db!.query<{ d: string }>(`SELECT pg_get_functiondef('${fn}'::regprocedure) AS d`)).rows[0].d;
    expect(def.split(from)).toHaveLength(2);
    await db!.exec(def.replace(from, to));
}
/** A newer save no longer retires a copy: neither an older repeat's, nor an unbound copy this save cannot hold. */
async function removeSupersedeOnSave() {
    await mutateFn('public._prec_att_on_session_completed()',
        '(a.tip_session_id IS NOT NULL AND a.tip_session_id <> NEW.id AND EXISTS (', '(false AND EXISTS (');
    await mutateFn('public._prec_att_on_session_completed()',
        'OR (a.tip_session_id IS NULL\n                AND NOT public._prec_att_can_hold_tip(a, NEW.id)', 'OR (false\n                AND NOT public._prec_att_can_hold_tip(a, NEW.id)');
}

describe('outcome 4 D2 on the shipped save path (every shipped migration, real complete_session_v2 and retention)', () => {
    it('binding before the original expires: the repeat save binds B, then expires A and purges its review; the tip survives', async () => {
        db = await shippedChain();
        const uid = await signup();
        const a = await take(uid);
        await coach(a);
        const attempt = await pressPracticeAgain(uid, a);
        expect(await attemptState(attempt)).toMatchObject({ practised_tip: TIP, tip_session_id: null, lifecycle: 'pending' });

        const order = await recordEventOrder();
        const b = await take(uid);
        // The real save expired A and the shipped purge removed its review, in the same transaction.
        expect(await sessionState(a)).toEqual({ transcript_state: 'expired', has_transcript: false, has_review: false });
        expect(await sessionState(b)).toMatchObject({ transcript_state: 'available', has_transcript: true });
        // B was bound BEFORE A expired, inside that one save.
        expect(await order()).toEqual([{ event: 'bound', ref: b }, { event: 'expired', ref: a }]);
        expect(await attemptState(attempt)).toMatchObject({ practised_tip: TIP, tip_session_id: b, lifecycle: 'pending' });

        // The client's non-blocking advance after the save confirms the binding and keeps the tip.
        expect(await advance(uid, attempt, 'not_comparable', b)).toBe('not_comparable');
        expect(await attemptState(attempt)).toEqual({ practised_tip: TIP, tip_session_id: b, practice_session_id: b, lifecycle: 'not_comparable' });
    }, 180_000);

    it('NEGATIVE CONTROL: the first design (purge a pending copy when its original expires) loses the tip in the real save', async () => {
        db = await shippedChain();
        const uid = await signup();
        const a = await take(uid);
        await coach(a);
        const attempt = await pressPracticeAgain(uid, a);
        await mutantFirstDesign();
        const b = await take(uid);
        expect(await sessionState(a)).toMatchObject({ transcript_state: 'expired' });
        expect(await attemptState(attempt)).toMatchObject({ practised_tip: null, tip_session_id: null });
        await advance(uid, attempt, 'not_comparable', b);
        expect(await attemptState(attempt)).toMatchObject({ practised_tip: null, practice_session_id: b });
    }, 180_000);

    it('NEGATIVE CONTROL: binding moved after the original expires breaks the ordering and loses the tip', async () => {
        db = await shippedChain();
        const uid = await signup();
        const a = await take(uid);
        await coach(a);
        const attempt = await pressPracticeAgain(uid, a);
        await mutantBindAfterExpiry();
        const order = await recordEventOrder();
        const b = await take(uid);
        expect(await sessionState(a)).toMatchObject({ transcript_state: 'expired', has_review: false });
        // The original expires while the copy is still unbound, so the copy goes and there is nothing left to bind.
        expect(await order()).toEqual([{ event: 'expired', ref: a }]);
        expect(await order()).not.toEqual([{ event: 'bound', ref: b }, { event: 'expired', ref: a }]);
        expect(await attemptState(attempt)).toMatchObject({ practised_tip: null, tip_session_id: null });
    }, 180_000);

    it("retention: the next real save expires the repeat's transcript and deletes its copy", async () => {
        db = await shippedChain();
        const uid = await signup();
        const a = await take(uid);
        await coach(a);
        const attempt = await pressPracticeAgain(uid, a);
        const b = await take(uid);
        await coach(b);
        await advance(uid, attempt, 'not_comparable', b);
        const c = await take(uid);
        expect(await sessionState(b)).toEqual({ transcript_state: 'expired', has_transcript: false, has_review: false });
        expect(await sessionState(c)).toMatchObject({ transcript_state: 'available' });
        expect(await attemptState(attempt)).toEqual({ practised_tip: null, tip_session_id: b, practice_session_id: b, lifecycle: 'not_comparable' });
    }, 180_000);

    it('no coaching on the repeat, transcript kept: the next real save expires it and the copy is deleted (no ai_suggestions condition)', async () => {
        db = await shippedChain();
        const uid = await signup();
        const a = await take(uid);
        await coach(a);
        const attempt = await pressPracticeAgain(uid, a);
        const b = await take(uid); // never coached
        await advance(uid, attempt, 'not_comparable', b);
        await take(uid);
        expect(await sessionState(b)).toEqual({ transcript_state: 'expired', has_transcript: false, has_review: false });
        expect(await attemptState(attempt)).toMatchObject({ practised_tip: null, tip_session_id: b });
    }, 180_000);

    it('NEGATIVE CONTROL: cleanup that only extends the coaching-gated purge keeps the uncoached repeat\'s copy', async () => {
        db = await shippedChain();
        const uid = await signup();
        const a = await take(uid);
        await coach(a);
        const attempt = await pressPracticeAgain(uid, a);
        const b = await take(uid);
        await advance(uid, attempt, 'not_comparable', b);
        await mutantPurgeNeedsCoaching();
        await take(uid);
        expect(await sessionState(b)).toMatchObject({ transcript_state: 'expired', has_review: false });
        expect(await attemptState(attempt)).toMatchObject({ practised_tip: TIP, tip_session_id: b });
    }, 180_000);

    it('no transcript text on the newer save: retention expires nothing, and the copy is still deleted by the save itself', async () => {
        db = await shippedChain();
        const uid = await signup();
        const a = await take(uid);
        await coach(a);
        const attempt = await pressPracticeAgain(uid, a);
        const b = await take(uid);
        await advance(uid, attempt, 'not_comparable', b);
        const c = await take(uid, '   ');
        // The real save records blank text as not captured, so it is no replacement transcript for retention.
        expect(await sessionState(c)).toMatchObject({ transcript_state: 'not_captured' });
        // No replacement transcript, so the real retention leaves B's transcript in place...
        expect(await sessionState(b)).toMatchObject({ transcript_state: 'available', has_transcript: true });
        // ...and the copy follows the newer save anyway.
        expect(await attemptState(attempt)).toMatchObject({ practised_tip: null, tip_session_id: b });
    }, 180_000);

    it('NEGATIVE CONTROL: without the newer-save rule, a newer save with no transcript leaves the copy in place', async () => {
        db = await shippedChain();
        const uid = await signup();
        const a = await take(uid);
        await coach(a);
        const attempt = await pressPracticeAgain(uid, a);
        const b = await take(uid);
        await advance(uid, attempt, 'not_comparable', b);
        await removeSupersedeOnSave();
        await take(uid, '   ');
        expect(await sessionState(b)).toMatchObject({ transcript_state: 'available' });
        expect(await attemptState(attempt)).toMatchObject({ practised_tip: TIP, tip_session_id: b });
    }, 180_000);

    it('an older original, still available because retention is off, gives no copy: only the newest saved session does', async () => {
        db = await shippedChain({ activateRetention: false });
        const uid = await signup();
        const a = await take(uid);
        await coach(a);
        await take(uid); // a newer save; with retention off, A keeps its transcript and its review
        expect(await sessionState(a)).toMatchObject({ transcript_state: 'available', has_review: true });
        const attempt = await pressPracticeAgain(uid, a);
        expect(await attemptState(attempt)).toMatchObject({ practised_tip: null, tip_session_id: null, lifecycle: 'pending' });
    }, 180_000);

    it('NEGATIVE CONTROL: without the newest-original rule, the older original\'s tip is copied', async () => {
        db = await shippedChain({ activateRetention: false });
        const uid = await signup();
        const a = await take(uid);
        await coach(a);
        await take(uid);
        await mutateFn('public._prec_att_snapshot_tip()', `AND (n.created_at, n.id) > (s.created_at, s.id)`, `AND false`);
        const attempt = await pressPracticeAgain(uid, a);
        expect(await attemptState(attempt)).toMatchObject({ practised_tip: TIP, tip_session_id: null });
    }, 180_000);

    it("an unbound copy goes when the real save expires its original, even with the newer-save rule removed", async () => {
        db = await shippedChain();
        const uid = await signup();
        const a = await take(uid);
        await coach(a);
        const b = await startTake(uid); // started before Practice again, so it can never be the repeat
        const attempt = await pressPracticeAgain(uid, a);
        await removeSupersedeOnSave(); // isolate the expiry rule
        await saveTake(uid, b, 'synthetic words for this take');
        expect(await sessionState(a)).toMatchObject({ transcript_state: 'expired' });
        expect(await attemptState(attempt)).toMatchObject({ practised_tip: null, tip_session_id: null, lifecycle: 'pending' });
    }, 180_000);

    it('NEGATIVE CONTROL: without the unbound-source expiry clause (and the newer-save rule), the copy outlives its original', async () => {
        db = await shippedChain();
        const uid = await signup();
        const a = await take(uid);
        await coach(a);
        const b = await startTake(uid);
        const attempt = await pressPracticeAgain(uid, a);
        await removeSupersedeOnSave();
        await mutateFn('public._prec_att_purge_tip_on_expire()', `OR (a.tip_session_id IS NULL AND EXISTS (`, `OR (false AND EXISTS (`);
        await saveTake(uid, b, 'synthetic words for this take');
        expect(await sessionState(a)).toMatchObject({ transcript_state: 'expired' });
        expect(await attemptState(attempt)).toMatchObject({ practised_tip: TIP, tip_session_id: null });
    }, 180_000);

    it('retention not yet activated (Production today): the original is not expired, the repeat is still bound, and the next save deletes the copy', async () => {
        db = await shippedChain({ activateRetention: false });
        const uid = await signup();
        const a = await take(uid);
        await coach(a);
        const attempt = await pressPracticeAgain(uid, a);
        const b = await take(uid);
        expect(await sessionState(a)).toMatchObject({ transcript_state: 'available', has_review: true });
        expect(await attemptState(attempt)).toMatchObject({ practised_tip: TIP, tip_session_id: b });
        await advance(uid, attempt, 'not_comparable', b);
        await take(uid);
        expect(await attemptState(attempt)).toMatchObject({ practised_tip: null, tip_session_id: b });
    }, 180_000);
});
