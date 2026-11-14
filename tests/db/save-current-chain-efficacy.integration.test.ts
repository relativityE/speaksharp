// @vitest-environment node
// Refs #1843: replay integrity on the installed migration chain, not an archived save body.
// Synthetic local database only. This is not deployed-schema or payment-wall evidence.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const DIR = resolve(process.cwd(), 'backend/supabase/migrations');
const SIGNATURE = 'public.complete_session_v2(uuid,text,integer,text,jsonb,integer,double precision,double precision,jsonb,jsonb,text)';
const BOOTSTRAP = `
CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE anon;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, created_at timestamptz DEFAULT now(), raw_user_meta_data jsonb DEFAULT '{}'::jsonb);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('request.jwt.claim.role', true), '')::text $f$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT '{}'::jsonb $f$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
CREATE FUNCTION public.uuid_generate_v4() RETURNS uuid LANGUAGE sql AS $f$ SELECT gen_random_uuid() $f$;
CREATE SCHEMA extensions; CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql AS $f$ SELECT string_to_array(name,'/') $f$;
`;
const NEXT_ACTION = JSON.stringify({ reasonCode: 'HIGH_FILLER_RATE', actionCode: 'REDUCE_FILLERS',
    metric: 'filler_rate', value: 0.08, comparator: 'above_baseline', templateVersion: 'rec_v1' });
type SaveResult = { success: boolean; idempotent?: boolean; error?: string };

describe('current-chain save replay integrity and causal controls', () => {
    let db: PGlite;
    let original: string;
    beforeAll(async () => {
        db = new PGlite();
        await db.exec(BOOTSTRAP);
        for (const file of readdirSync(DIR).filter(f => /^\d{8,14}_.+\.sql$/.test(f)).sort()) {
            await db.exec(readFileSync(resolve(DIR, file), 'utf8'));
        }
        original = (await db.query<{ definition: string }>(
            'SELECT pg_get_functiondef($1::regprocedure) AS definition', [SIGNATURE])).rows[0].definition;
    }, 120_000);
    afterAll(async () => { await db?.close(); });

    async function authenticated<T>(body: () => Promise<T>): Promise<T> {
        await db.exec('SET ROLE authenticated');
        try { return await body(); } finally { await db.exec('RESET ROLE'); }
    }
    async function createTake(): Promise<string> {
        const uid = randomUUID();
        await db.query('INSERT INTO auth.users (id,email) VALUES ($1,$2)', [uid, `save-${uid}@example.test`]);
        await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [uid]);
        return authenticated(async () => {
            const lease = randomUUID();
            const acquired = (await db.query<{ r: { acquired: boolean } }>(
                "SELECT public.acquire_recording_lease($1::uuid, 'save-efficacy', false) AS r", [lease])).rows[0].r;
            expect(acquired.acquired).toBe(true);
            const created = (await db.query<{ r: { new_session: { id: string }; error?: string } }>(
                "SELECT public.create_session_and_update_usage($1::jsonb, 'private') AS r",
                [JSON.stringify({ title: 'save-efficacy', duration: 0, total_words: 0, lease_id: lease })])).rows[0].r;
            expect(created.error).toBeUndefined();
            return created.new_session.id;
        });
    }
    async function save(id: string, wpm = 130, words = 120): Promise<SaveResult> {
        return authenticated(async () => (await db.query<{ r: SaveResult }>(
            `SELECT public.complete_session_v2(p_session_id => $1::uuid, p_final_duration => 60,
                p_next_action => $2::jsonb, p_total_words => $3::int, p_wpm => $4::float8,
                p_clarity_score => 80, p_filler_counts => '{}'::jsonb,
                p_final_transcript => 'synthetic save efficacy words') AS r`, [id, NEXT_ACTION, words, wpm])).rows[0].r);
    }
    async function snapshot(id: string) {
        return (await db.query('SELECT * FROM public.sessions WHERE id=$1', [id])).rows[0];
    }
    async function conflict(id: string, wpm: number, words: number) {
        try { return { result: await save(id, wpm, words), code: undefined }; }
        catch (error) {
            const failure = error as { code?: string };
            // Setup, permission and pin errors must fail this test, not count as killing a mutant.
            if (failure.code !== '40003') throw error;
            return { result: undefined, code: failure.code };
        }
    }
    const assertConflict = (result: Awaited<ReturnType<typeof conflict>>) => expect(result.code).toBe('40003');
    const assertHidden = (result: SaveResult) => expect(result).toEqual({ success: false, error: 'session_not_found' });

    it('identical replay is a no-op; changed WPM or total words conflicts without changing the saved row', async () => {
        const id = await createTake();
        expect(await save(id)).toMatchObject({ success: true, idempotent: false });
        const before = await snapshot(id);
        expect(await save(id)).toMatchObject({ success: true, idempotent: true });
        expect(await snapshot(id)).toEqual(before);
        assertConflict(await conflict(id, 131, 120));
        assertConflict(await conflict(id, 130, 121));
        expect(await snapshot(id)).toEqual(before);
    });

    it('another authenticated user cannot complete or learn the existence of a take', async () => {
        const victim = await createTake();
        const before = await snapshot(victim);
        await createTake(); // distinct real signup; switches JWT subject to the other user
        assertHidden(await save(victim));
        expect(await save(randomUUID())).toEqual({ success: false, error: 'session_not_found' });
        expect(await snapshot(victim)).toEqual(before);
    });

    it('causal control: removing the ownership lookup fails the same refusal assertion', async () => {
        const victim = await createTake();
        const before = await snapshot(victim);
        await createTake();
        assertHidden(await save(victim));
        const predicate = 'WHERE id = p_session_id AND user_id = auth.uid() FOR UPDATE;';
        expect(original.split(predicate)).toHaveLength(2);
        await db.exec('BEGIN');
        try {
            await db.exec(original.replace(predicate, 'WHERE id = p_session_id FOR UPDATE;'));
            expect((await db.query<{ ok: boolean }>('SELECT public.retention_content_free_compatible() AS ok')).rows[0].ok).toBe(false);
            const changed = await db.query<{ signature: string }>(
                'UPDATE public.transcript_retention_function_pins SET definition_md5=md5(pg_get_functiondef($1::regprocedure)) WHERE signature=$1 RETURNING signature', [SIGNATURE]);
            expect(changed.rows).toEqual([{ signature: SIGNATURE }]);
            const result = await save(victim); // unexpected SQL/setup errors fail, not count as a kill
            expect(result.success).toBe(true);
            expect(() => assertHidden(result)).toThrow();
            // Other ownership predicates still prevent writes. This mutant proves refusal, not cross-user mutation.
            expect(await snapshot(victim)).toEqual(before);
        } finally { await db.exec('ROLLBACK'); }
        assertHidden(await save(victim));
        expect(await snapshot(victim)).toEqual(before);
        expect((await db.query<{ definition: string }>('SELECT pg_get_functiondef($1::regprocedure) AS definition', [SIGNATURE])).rows[0].definition).toBe(original);
    });

    for (const mutant of [
        { name: 'ignoring changed WPM',
            from: 'AND COALESCE(p_wpm, v_session.wpm)                      IS NOT DISTINCT FROM v_session.wpm',
            to: 'AND true', wpm: 131, words: 120 },
        { name: 'silently accepting conflicting replays',
            from: "RAISE EXCEPTION '#1306: idempotency conflict — a completed session cannot be re-completed with different final metrics/duration/status/reason/next-action/transcript'\n            USING ERRCODE = '40003';",
            to: 'v_idempotent := true;', wpm: 130, words: 121 },
    ]) {
        it(`causal control: ${mutant.name} fails the same conflict assertion, then restores green`, async () => {
            const id = await createTake();
            expect(await save(id)).toMatchObject({ success: true });
            assertConflict(await conflict(id, mutant.wpm, mutant.words));
            expect(original.split(mutant.from)).toHaveLength(2);
            await db.exec('BEGIN');
            try {
                await db.exec(original.replace(mutant.from, mutant.to));
                expect((await db.query<{ ok: boolean }>('SELECT public.retention_content_free_compatible() AS ok')).rows[0].ok).toBe(false);
                // Test-local repin admits only this deliberate semantic mutant. Production pins are untouched.
                const changed = await db.query<{ signature: string }>(
                    'UPDATE public.transcript_retention_function_pins SET definition_md5=md5(pg_get_functiondef($1::regprocedure)) WHERE signature=$1 RETURNING signature', [SIGNATURE]);
                expect(changed.rows).toEqual([{ signature: SIGNATURE }]);
                const result = await conflict(id, mutant.wpm, mutant.words);
                expect(result.result).toMatchObject({ success: true, idempotent: true });
                expect(() => assertConflict(result)).toThrow();
            } finally { await db.exec('ROLLBACK'); }
            assertConflict(await conflict(id, mutant.wpm, mutant.words));
            expect((await db.query<{ definition: string }>('SELECT pg_get_functiondef($1::regprocedure) AS definition', [SIGNATURE])).rows[0].definition).toBe(original);
        });
    }
});
