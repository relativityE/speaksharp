// @vitest-environment node
// #1863 payment wall, server side (20261114170000_payment_wall_product_access_1863.sql), beyond the desired-contract
// file trial-read-access-current-chain.integration.test.ts: every guarded SECURITY DEFINER RPC refuses an expired unpaid
// caller and admits the same caller once paid; the renamed bodies are unreachable from every API role; service_role is
// checked against the subject it serves; the pinned record_progress_evaluation is closed by its table guard; and the
// surfaces that must stay open after expiry (account, usage answer, deletion status, lease release) stay open.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const DIR = resolve(process.cwd(), 'backend/supabase/migrations');
// Registered SQL consumer (scripts/lib/nativeTestExecutionEvidence.mjs): the exact migration bytes are executed here.
const CANDIDATE = 'backend/supabase/migrations/20261114170000_payment_wall_product_access_1863.sql';
const consumed: { file: string; sha256: string; beforeSha256: string; afterSha256: string }[] = [];
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const CONTRACT = readFileSync(resolve(process.cwd(), 'tests/db/trial-read-access-current-chain.integration.test.ts'), 'utf8');
const BOOTSTRAP = CONTRACT.split('const BOOTSTRAP = `')[1].split('`;')[0];

// Each guarded RPC, called as its owner with arguments that reach past the guard for an entitled caller.
const GUARDED = [
    'get_analytics_summary', 'get_progress_obligations', 'get_attribution_authority_v1', 'get_session_engine_class_v1',
    'issue_objective_project_v1', 'issue_objective_brief_v1', 'objective_start_session_v1', 'objective_select_action_v1',
    'objective_finalize_evidence_v1', 'objective_dispute_action_v1', 'record_progress_recommendation',
    'record_recommendation_attempt', 'advance_recommendation_attempt', 'consume_ai_suggestion_quota', 'consume_formatter_quota',
] as const;
const PAYMENT_REQUIRED = /payment_required/;

describe('#1863 payment wall: guarded RPCs, table guard and open surfaces', () => {
    let db: PGlite;
    beforeAll(async () => {
        db = new PGlite();
        await db.exec(BOOTSTRAP);
        for (const file of readdirSync(DIR).filter(f => /^\d{8,14}_.+\.sql$/.test(f)).sort()) {
            const bytes = readFileSync(resolve(DIR, file));
            await db.exec(bytes.toString('utf8'));
            if (`backend/supabase/migrations/${file}` === CANDIDATE) {
                const beforeSha256 = sha256(bytes);
                const afterSha256 = sha256(readFileSync(resolve(process.cwd(), CANDIDATE)));
                assert.equal(afterSha256, beforeSha256, 'SQL bytes remain unchanged across actual execution');
                consumed.push({ file: CANDIDATE, sha256: beforeSha256, beforeSha256, afterSha256 });
            }
        }
        assert.equal(consumed.length, 1, 'the payment-wall migration was executed');
        // Emulates Supabase's default table grants to API roles (PGlite has none), so the row-level policies decide.
        await db.exec(`GRANT SELECT ON public.user_profiles TO authenticated;
            GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_filler_words TO authenticated;
            GRANT SELECT, INSERT, UPDATE ON public.user_goals TO authenticated; GRANT SELECT ON public.user_goals TO anon;
            GRANT SELECT ON public.progress_recommendations, public.progress_recommendation_attempts,
                public.session_progress_evaluations, public.user_filler_words TO anon;`);
    }, 120_000);
    afterAll(async () => {
        await db?.close();
        const binding = JSON.parse(process.env.TEST_EFFICACY_BINDING ?? 'null');
        if (binding?.sql) writeFileSync(binding.sql.witnessFile, JSON.stringify({ schemaVersion: 1,
            phaseId: binding.phaseId, bindingSha256: createHash('sha256').update(JSON.stringify(binding)).digest('hex'),
            consumer: 'tests/db/payment-wall-guards-1863.integration.test.ts', consumed }));
    });

    async function asRole<T>(role: 'anon' | 'authenticated' | 'service_role', uid: string | null, work: () => Promise<T>): Promise<T> {
        await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [uid ?? '']);
        await db.query("SELECT set_config('request.jwt.claim.role',$1,false)", [role]);
        await db.exec(`SET ROLE ${role}`);
        try { return await work(); } finally { await db.exec('RESET ROLE'); }
    }
    const asUser = <T>(uid: string, work: () => Promise<T>) => asRole('authenticated', uid, work);

    async function fixture() {
        const uid = randomUUID();
        await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [uid, `guard-${uid}@example.test`]);
        const lease = randomUUID();
        const session = await asUser(uid, async () => {
            await db.query("SELECT public.acquire_recording_lease($1::uuid,'payment-wall-guard',false)", [lease]);
            const created = (await db.query<{ r: { new_session?: { id: string } } }>(
                "SELECT public.create_session_and_update_usage($1::jsonb,'private') AS r",
                [JSON.stringify({ title: 'synthetic guard proof', duration: 0, total_words: 0, lease_id: lease })])).rows[0].r;
            return created.new_session!.id;
        });
        return { uid, session, lease };
    }
    const expire = (uid: string) =>
        db.query("UPDATE public.user_profiles SET trial_expires_at=now()-interval '1 second' WHERE id=$1", [uid]);
    const pay = (uid: string) =>
        db.query("UPDATE public.user_profiles SET subscription_status='pro',stripe_subscription_id='sub_synthetic_guard_'||$1::text WHERE id=$1", [uid]);

    function callFor(name: typeof GUARDED[number], uid: string, session: string): [string, unknown[]] {
        const id = randomUUID();
        switch (name) {
            case 'get_analytics_summary': return ['SELECT public.get_analytics_summary($1)', [uid]];
            case 'get_progress_obligations': return ['SELECT public.get_progress_obligations()', []];
            case 'get_attribution_authority_v1': return ['SELECT public.get_attribution_authority_v1($1)', [session]];
            case 'get_session_engine_class_v1': return ['SELECT public.get_session_engine_class_v1($1)', [session]];
            case 'issue_objective_project_v1': return ["SELECT public.issue_objective_project_v1('guard project')", []];
            case 'issue_objective_brief_v1': return ["SELECT public.issue_objective_brief_v1($1,'goal',60,'audience','[]'::jsonb)", [id]];
            case 'objective_start_session_v1': return ["SELECT public.objective_start_session_v1($1,$2,$3,'d','f','k')", [id, id, session]];
            case 'objective_select_action_v1': return ['SELECT public.objective_select_action_v1($1)', [id]];
            case 'objective_finalize_evidence_v1': return ["SELECT public.objective_finalize_evidence_v1($1,'{}'::jsonb)", [id]];
            case 'objective_dispute_action_v1': return ['SELECT public.objective_dispute_action_v1($1)', [id]];
            case 'record_progress_recommendation': return ["SELECT public.record_progress_recommendation($1,'pace','decrease',120,'wpm','t')", [session]];
            case 'record_recommendation_attempt': return ['SELECT public.record_recommendation_attempt($1)', [id]];
            case 'advance_recommendation_attempt': return ["SELECT public.advance_recommendation_attempt($1,'started')", [id]];
            case 'consume_ai_suggestion_quota': return ['SELECT public.consume_ai_suggestion_quota()', []];
            case 'consume_formatter_quota': return ['SELECT public.consume_formatter_quota()', []];
        }
    }

    async function outcome(uid: string, sql: string, params: unknown[]): Promise<string> {
        return asUser(uid, async () => {
            try { await db.query(sql, params); return 'ok'; } catch (e) { return (e as Error).message; }
        });
    }

    it.each(GUARDED)('%s refuses an expired unpaid caller and admits the same caller once paid', async (name) => {
        const { uid, session } = await fixture();
        const [sql, params] = callFor(name, uid, session);
        // CONTROL: while the trial is live the guard is passed (the body may still refuse for its own reasons).
        expect(await outcome(uid, sql, params)).not.toMatch(PAYMENT_REQUIRED);
        await expire(uid);
        expect(await outcome(uid, sql, params)).toMatch(PAYMENT_REQUIRED);
        await db.query("UPDATE public.user_profiles SET subscription_status='pro',stripe_subscription_id=NULL WHERE id=$1", [uid]);
        expect(await outcome(uid, sql, params)).toMatch(PAYMENT_REQUIRED); // a bare pro label is not payment
        await pay(uid);
        expect(await outcome(uid, sql, params)).not.toMatch(PAYMENT_REQUIRED);
    });

    it('keeps each renamed body out of reach of every API role, and each wrapper grant unchanged', async () => {
        const rows = (await db.query<{ name: string; anon: boolean; authed: boolean; service: boolean; definer: boolean }>(
            `SELECT p.proname AS name, has_function_privilege('anon',p.oid,'EXECUTE') AS anon,
                    has_function_privilege('authenticated',p.oid,'EXECUTE') AS authed,
                    has_function_privilege('service_role',p.oid,'EXECUTE') AS service, p.prosecdef AS definer
             FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname = ANY($1)`,
            [GUARDED.flatMap(n => [n, `${n}__unguarded`])])).rows;
        for (const name of GUARDED) {
            const body = rows.filter(r => r.name === `${name}__unguarded`);
            expect(body.map(r => r.name)).toEqual([`${name}__unguarded`]);
            expect(body[0]).toMatchObject({ anon: false, authed: false, service: false });
            const wrapper = rows.filter(r => r.name === name);
            expect(wrapper.map(r => r.name)).toEqual([name]);
            expect(wrapper[0]).toMatchObject({ anon: false, authed: true, definer: true });
        }
    });

    it('the entitlement probe of another account is not executable by end users', async () => {
        const probe = (await db.query<{ authed: boolean; anon: boolean }>(
            `SELECT has_function_privilege('authenticated','public.account_has_product_access(uuid)','EXECUTE') AS authed,
                    has_function_privilege('anon','public.account_has_product_access(uuid)','EXECUTE') AS anon`)).rows[0];
        expect(probe).toEqual({ authed: false, anon: false });
    });

    it('service_role is checked against the subject it serves', async () => {
        const expired = await fixture();
        const paid = await fixture();
        await expire(expired.uid);
        await expire(paid.uid);
        await pay(paid.uid);
        const serve = (uid: string) => asRole('service_role', null, async () => {
            try { await db.query('SELECT public.get_analytics_summary($1)', [uid]); return 'ok'; } catch (e) { return (e as Error).message; }
        });
        expect(await serve(expired.uid)).toMatch(PAYMENT_REQUIRED);
        // A paid subject passes the wall and reaches the body, whose own owner check is unchanged by #1863.
        expect(await serve(paid.uid)).not.toMatch(PAYMENT_REQUIRED);
    });

    it('the pinned record_progress_evaluation stays byte-identical and is closed by its table guard', async () => {
        expect((await db.query<{ ok: boolean }>('SELECT public.retention_content_free_compatible() AS ok')).rows[0].ok).toBe(true);
        const { uid, session } = await fixture();
        // The guard fires BEFORE INSERT for the subject in the request, ahead of any column check, whoever writes the row.
        const write = async () => {
            await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [uid]);
            try {
                await db.query('INSERT INTO public.session_progress_evaluations(user_id,session_id) VALUES($1,$2)', [uid, session]);
                return 'ok';
            } catch (e) { return (e as Error).message; }
        };
        expect(await write()).not.toMatch(PAYMENT_REQUIRED); // CONTROL: a live trial reaches the column checks
        await expire(uid);
        expect(await write()).toMatch(PAYMENT_REQUIRED);
        const trigger = await db.query(
            "SELECT 1 FROM pg_trigger WHERE tgname='ss_payment_wall_evaluation_guard' AND tgrelid='public.session_progress_evaluations'::regclass");
        expect(trigger.rows).toHaveLength(1);
    });

    it('closes the filler-word vocabulary for reads and writes, and restores it on payment', async () => {
        const { uid } = await fixture();
        expect(await outcome(uid, "INSERT INTO public.user_filler_words(user_id,word) VALUES($1,'basically')", [uid])).toBe('ok');
        const words = () => asUser(uid, async () => (await db.query('SELECT word FROM public.user_filler_words WHERE user_id=$1', [uid])).rows);
        expect(await words()).toHaveLength(1);
        await expire(uid);
        expect(await words()).toEqual([]);
        expect(await outcome(uid, "INSERT INTO public.user_filler_words(user_id,word) VALUES($1,'literally')", [uid])).toMatch(/row-level security/);
        await pay(uid);
        expect(await words()).toHaveLength(1);
    });

    it('closes practice-goal writes after expiry and restores them on payment', async () => {
        const { uid } = await fixture();
        expect(await outcome(uid, 'INSERT INTO public.user_goals(user_id,weekly_goal) VALUES($1,5)', [uid])).toBe('ok');
        const goals = () => asUser(uid, async () => (await db.query('SELECT weekly_goal FROM public.user_goals WHERE user_id=$1', [uid])).rows);
        expect(await goals()).toEqual([{ weekly_goal: 5 }]);
        await expire(uid);
        expect(await goals()).toEqual([]);
        // An UPDATE whose USING hides the row changes nothing; read it back as the owner after paying.
        expect(await outcome(uid, 'UPDATE public.user_goals SET weekly_goal=9 WHERE user_id=$1', [uid])).toBe('ok');
        const other = randomUUID();
        await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [other, `guard-${other}@example.test`]);
        await expire(other);
        expect(await outcome(other, 'INSERT INTO public.user_goals(user_id,weekly_goal) VALUES($1,5)', [other])).toMatch(/row-level security/);
        await pay(uid);
        expect(await goals()).toEqual([{ weekly_goal: 5 }]);
        expect(await outcome(uid, 'UPDATE public.user_goals SET weekly_goal=9 WHERE user_id=$1', [uid])).toBe('ok');
        expect(await goals()).toEqual([{ weekly_goal: 9 }]);
    });

    it('signed-out reads of walled tables return nothing instead of raising', async () => {
        await asRole('anon', null, async () => {
            for (const table of ['user_goals', 'progress_recommendations', 'progress_recommendation_attempts',
                'session_progress_evaluations', 'user_filler_words']) {
                expect((await db.query(`SELECT 1 FROM public.${table}`)).rows).toEqual([]);
            }
        });
    });

    it('keeps the account, usage answer, deletion status and lease release open after expiry', async () => {
        const { uid, lease } = await fixture();
        await expire(uid);
        await asUser(uid, async () => {
            expect((await db.query('SELECT id FROM public.user_profiles WHERE id=$1', [uid])).rows).toHaveLength(1);
            const usage = (await db.query<{ r: { can_start: boolean; error: string } }>('SELECT public.check_usage_limit() AS r')).rows[0].r;
            expect(usage).toMatchObject({ can_start: false, error: 'trial_expired' });
            expect((await db.query('SELECT public.account_closure_pending_status() AS s')).rows).toHaveLength(1);
            await expect(db.query('SELECT public.release_recording_lease($1)', [lease])).resolves.toBeTruthy();
        });
    });
});
