// @vitest-environment node
// Desired PO contract, 2026-11-14: expired unpaid accounts have no product or saved-content access.
// This is deliberately RED until the corresponding implementation lands. Do not skip or weaken it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const DIR = resolve(process.cwd(), 'backend/supabase/migrations');
const BOOTSTRAP = `
CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE anon;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, created_at timestamptz DEFAULT now(), raw_user_meta_data jsonb DEFAULT '{}'::jsonb);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $f$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('request.jwt.claim.role',true),'')::text $f$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT '{}'::jsonb $f$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
CREATE FUNCTION public.uuid_generate_v4() RETURNS uuid LANGUAGE sql AS $f$ SELECT gen_random_uuid() $f$;
CREATE SCHEMA extensions; CREATE SCHEMA storage;
CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,owner uuid,metadata jsonb);
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql AS $f$ SELECT string_to_array(name,'/') $f$;
`;

describe('payment wall: actual current-chain product reads', () => {
    let db: PGlite;
    beforeAll(async () => {
        db = new PGlite();
        await db.exec(BOOTSTRAP);
        for (const file of readdirSync(DIR).filter(f => /^\d{8,14}_.+\.sql$/.test(f)).sort()) {
            await db.exec(readFileSync(resolve(DIR, file), 'utf8'));
        }
    }, 120_000);
    afterAll(async () => { await db.close(); });

    async function asUser<T>(uid: string, work: () => Promise<T>): Promise<T> {
        await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [uid]);
        await db.query("SELECT set_config('request.jwt.claim.role','authenticated',false)");
        await db.exec('SET ROLE authenticated');
        try { return await work(); } finally { await db.exec('RESET ROLE'); }
    }

    async function fixture() {
        const uid = randomUUID();
        await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [uid, `wall-${uid}@example.test`]);
        const lease = randomUUID();
        const session = await asUser(uid, async () => {
            const acquired = (await db.query<{ r: { acquired: boolean } }>(
                "SELECT public.acquire_recording_lease($1::uuid,'payment-wall-test',false) AS r", [lease])).rows[0].r;
            expect(acquired.acquired).toBe(true);
            const created = (await db.query<{ r: { new_session?: { id: string }; error?: string } }>(
                "SELECT public.create_session_and_update_usage($1::jsonb,'private') AS r",
                [JSON.stringify({ title: 'synthetic access proof', duration: 0, total_words: 0, lease_id: lease })])).rows[0].r;
            expect(created.error).toBeUndefined();
            expect(created.new_session?.id).toBeTruthy();
            return created.new_session!.id;
        });
        return { uid, session };
    }

    async function expire(uid: string) {
        await db.query("UPDATE public.user_profiles SET trial_expires_at=now()-interval '1 second' WHERE id=$1", [uid]);
        const usage = await asUser(uid, async () => (await db.query<{ r: { can_start: boolean; error: string } }>(
            'SELECT public.check_usage_limit() AS r')).rows[0].r);
        expect(usage).toMatchObject({ can_start: false, error: 'trial_expired' });
    }

    const count = (uid: string) => asUser(uid, async () =>
        (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM public.sessions WHERE user_id=$1', [uid])).rows[0].n);

    it('keeps real active-trial access and ownership isolation as positive controls', async () => {
        const owner = await fixture();
        const other = await fixture();
        expect(await count(owner.uid)).toBe(1);
        const rows = await asUser(other.uid, () => db.query('SELECT id FROM public.sessions WHERE id=$1', [owner.session]));
        expect(rows.rows).toEqual([]);
    });

    it('denies direct saved-session reads after expiry, not merely recording start', async () => {
        const { uid } = await fixture();
        await expire(uid);
        expect(await count(uid)).toBe(0);
    });

    it('closes reads at the exact server-time boundary, not one second later', async () => {
        const { uid } = await fixture();
        await db.exec('BEGIN');
        try {
            await db.query('UPDATE public.user_profiles SET trial_expires_at=now() WHERE id=$1', [uid]);
            expect(await count(uid)).toBe(0);
        } finally {
            await db.exec('ROLLBACK');
        }
    });

    it('does not treat a bare pro label without a paid subscription as payment', async () => {
        const { uid } = await fixture();
        await expire(uid);
        await db.query("UPDATE public.user_profiles SET subscription_status='pro',stripe_subscription_id=NULL WHERE id=$1", [uid]);
        expect(await count(uid)).toBe(0);
    });

    it('denies the SECURITY DEFINER analytics bypass after expiry', async () => {
        const { uid } = await fixture();
        await expire(uid);
        await expect(asUser(uid, () => db.query('SELECT public.get_analytics_summary($1)', [uid])))
            .rejects.toThrow(/trial_expired|payment_required/i);
    });

    it('denies the SECURITY DEFINER progress-obligations bypass after expiry', async () => {
        const { uid } = await fixture();
        await expire(uid);
        await expect(asUser(uid, () => db.query('SELECT public.get_progress_obligations()')))
            .rejects.toThrow(/trial_expired|payment_required/i);
    });

    it('server-confirmed paid restoration reopens the same retained session', async () => {
        const { uid } = await fixture();
        await expire(uid);
        expect(await count(uid)).toBe(0);
        await db.query("UPDATE public.user_profiles SET subscription_status='pro',stripe_subscription_id='sub_synthetic_wall' WHERE id=$1", [uid]);
        expect(await count(uid)).toBe(1);
    });

    it('keeps the account-deletion status path available after expiry', async () => {
        const { uid } = await fixture();
        await expire(uid);
        const result = await asUser(uid, () => db.query('SELECT public.account_closure_pending_status() AS status'));
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]).toHaveProperty('status');
    });

    it('closes direct reads of saved Focus Points projects', async () => {
        const { uid } = await fixture();
        const project = await asUser(uid, async () => (await db.query<{ id: string }>(
            "SELECT public.issue_objective_project_v1('synthetic saved project') AS id")).rows[0].id);
        const read = () => asUser(uid, () => db.query('SELECT id FROM public.objective_project WHERE id=$1', [project]));
        expect((await read()).rows).toHaveLength(1);
        await expire(uid);
        expect((await read()).rows).toEqual([]);
    });

    it('an explicit Focus Points capability cannot restore product service after an unpaid expiry', async () => {
        const { uid } = await fixture();
        await db.query('INSERT INTO public.objective_account_capability(user_id,enabled) VALUES($1,true) ON CONFLICT(user_id) DO UPDATE SET enabled=true', [uid]);
        await expire(uid);
        await expect(asUser(uid, () => db.query("SELECT public.issue_objective_project_v1('must not create')")))
            .rejects.toThrow(/trial_expired|payment_required|capability required/i);
    });

    it('closes direct reads of saved Progress recommendations and attempts', async () => {
        const { uid, session } = await fixture();
        const recommendation = (await db.query<{ id: string }>(
            `INSERT INTO public.progress_recommendations(user_id,source_session_id,formula_version,
                target_metric,target_direction,target_value,target_units,source_metric_value,shown_text)
             VALUES($1,$2,'clarity_v1','pace','decrease',120,'wpm',140,'synthetic prior recommendation') RETURNING id`,
            [uid, session])).rows[0].id;
        await db.query('INSERT INTO public.progress_recommendation_attempts(user_id,recommendation_id) VALUES($1,$2)', [uid, recommendation]);
        const read = () => asUser(uid, async () => ({
            recommendations: (await db.query('SELECT id FROM public.progress_recommendations WHERE user_id=$1', [uid])).rows,
            attempts: (await db.query('SELECT id FROM public.progress_recommendation_attempts WHERE user_id=$1', [uid])).rows,
        }));
        const before = await read();
        expect(before.recommendations).toHaveLength(1);
        expect(before.attempts).toHaveLength(1);
        await expire(uid);
        expect(await read()).toEqual({ recommendations: [], attempts: [] });
    });
});
