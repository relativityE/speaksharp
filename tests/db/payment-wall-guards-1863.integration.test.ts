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
        // Hosted Auth has this column; the bootstrap does not. The closure path and the J1.f discard require it.
        await db.exec('ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz');
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

    it('expiry mid-recording: a take admitted in trial is refused at save after expiry, stores nothing, and its lease still releases', async () => {
        const { uid, lease: setupLease } = await fixture();
        await asUser(uid, () => db.query('SELECT public.release_recording_lease($1)', [setupLease]));
        const lease = randomUUID();
        // The take starts while the trial is live: the server admits it with a recording lease.
        const admitted = await asUser(uid, async () => (await db.query<{ r: { acquired: boolean } }>(
            "SELECT public.acquire_recording_lease($1::uuid,'payment-wall-mid-take',false) AS r", [lease])).rows[0].r);
        expect(admitted).toMatchObject({ acquired: true });
        const count = async () => Number((await db.query<{ n: string }>('SELECT count(*) AS n FROM public.sessions WHERE user_id=$1', [uid])).rows[0].n);
        const before = await count();
        // The trial ends while recording; Stop then asks the server to save the take.
        await expire(uid);
        const saved = await asUser(uid, async () => (await db.query<{ r: Record<string, unknown> }>(
            "SELECT public.create_session_and_update_usage($1::jsonb,'private') AS r",
            [JSON.stringify({ title: 'synthetic mid-take', duration: 42, total_words: 0, lease_id: lease })])).rows[0].r);
        expect(saved.new_session ?? null).toBeNull();
        expect(saved).toMatchObject({ usage_exceeded: true, error: 'trial_expired' });
        expect(await count()).toBe(before);
        await asUser(uid, async () => {
            await expect(db.query('SELECT public.release_recording_lease($1)', [lease])).resolves.toBeTruthy();
        });
    });

    // J1.f (Sam, 2026-11-15): an unpaid user can finish account deletion after an interrupted save, and the take is
    // never marked saved. The take's placeholder row was written in trial; the trial then ended, so the server refuses
    // to complete the row (complete_session_v2 says trial_expired) and its admitted save obligation can never settle.
    // Before #1863's discard, that obligation blocked the deletion claim and the auth.users delete forever.
    describe('J1.f: deletion after an interrupted save', () => {
        const unsettled = async (uid: string) => (await db.query<{ lease_id: string; phase: string }>(
            "SELECT lease_id,phase FROM public.account_save_obligations WHERE user_id=$1 AND phase<>'completed'", [uid])).rows;
        const discard = (uid: string) => asUser(uid, async () => (await db.query<{ r: Record<string, unknown> }>(
            'SELECT public.discard_unsaved_recordings_for_closure_v1() AS r')).rows[0].r);
        const deleteUser = async (uid: string) => {
            try { await db.query('DELETE FROM auth.users WHERE id=$1', [uid]); return 'deleted'; } catch (e) { return (e as Error).message; }
        };
        async function confirmDeletion(uid: string) {
            const hash = createHash('sha256').update(uid).digest('hex');
            await db.query('UPDATE auth.users SET email_confirmed_at=now() WHERE id=$1', [uid]);
            await asRole('service_role', null, async () => {
                await db.query('SELECT public.issue_account_closure_pending_token($1,$2)', [uid, hash]);
                await db.query('SELECT public.begin_account_closure_pending($1,$2,true)', [uid, hash]);
            });
            expect((await db.query("SELECT 1 FROM public.account_closure_attempts WHERE user_id=$1 AND phase='pending'", [uid])).rows).toHaveLength(1);
        }
        async function interruptedTake() {
            const uid = randomUUID();
            await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [uid, `j1f-${uid}@example.test`]);
            const lease = randomUUID();
            // Start, in trial: the lease and the take's placeholder row.
            const session = await asUser(uid, async () => {
                await db.query("SELECT public.acquire_recording_lease($1::uuid,'j1f-take',false)", [lease]);
                return (await db.query<{ r: { new_session: { id: string } } }>(
                    "SELECT public.create_session_and_update_usage($1::jsonb,'private') AS r",
                    [JSON.stringify({ title: 'synthetic j1f take', duration: 0, total_words: 0, lease_id: lease })])).rows[0].r.new_session.id;
            });
            await expire(uid);
            // Stop, after expiry: the save is refused, then the lease is released. Nothing settles the obligation.
            const completion = await asUser(uid, async () => (await db.query<{ r: Record<string, unknown> }>(
                "SELECT public.complete_session_v2($1,'completed',42) AS r", [session])).rows[0].r);
            expect(completion).toMatchObject({ success: false, error: 'trial_expired' });
            await asUser(uid, () => db.query('SELECT public.release_recording_lease($1)', [lease]));
            return { uid, lease, session };
        }

        it('an expired user finishes deletion: the unsaved take is discarded, never marked saved, and fenced', async () => {
            const { uid, lease, session } = await interruptedTake();
            // CONTROL (fails before the fix): the interrupted save blocks deletion.
            expect(await unsettled(uid)).toEqual([{ lease_id: lease, phase: 'admitted' }]);
            expect(await deleteUser(uid)).toMatch(/account admitted save unsettled/);
            // Nothing is discarded outside the owner's own confirmed, pending deletion.
            expect(await discard(uid)).toMatchObject({ discarded: 0, reason: 'no_pending_deletion' });
            expect(await unsettled(uid)).toHaveLength(1);

            await confirmDeletion(uid);
            expect(await discard(uid)).toMatchObject({ discarded: 1, outcome: 'discarded_not_saved' });
            expect(await unsettled(uid)).toEqual([]);
            // Recorded as discarded, not saved: no obligation was marked completed, the row is not completed.
            expect((await db.query('SELECT phase FROM public.account_save_obligations WHERE user_id=$1 AND lease_id=$2', [uid, lease])).rows).toEqual([]);
            expect((await db.query('SELECT outcome FROM public.recording_start_abandonments WHERE user_id=$1 AND lease_id=$2', [uid, lease])).rows)
                .toEqual([{ outcome: 'discarded_not_saved' }]);
            expect((await db.query<{ status: string }>('SELECT status FROM public.sessions WHERE id=$1', [session])).rows[0].status).not.toBe('completed');
            // Refused at the table triggers, whatever path tries it: the abandonment fence refuses completing the row,
            // and a new lease for the identity is refused (by the pending deletion, and by the fence behind it).
            const raw = async (text: string, params: unknown[]) => {
                try { await db.query(text, params); return 'ok'; } catch (e) { return (e as Error).message; }
            };
            expect(await raw("UPDATE public.sessions SET status='completed' WHERE id=$1", [session])).toMatch(/abandoned recording identity cannot be bound/);
            expect(await raw("INSERT INTO public.active_recording_lease(user_id,lease_id,holder_label,started_at,heartbeat_at) VALUES($1,$2,'j1f-reuse',now(),now())",
                [uid, lease])).toMatch(/abandoned recording identity|account closure pending/);
            // Repeating it changes nothing, and the account can now be deleted.
            expect(await discard(uid)).toMatchObject({ discarded: 0 });
            expect(await deleteUser(uid)).toBe('deleted');
        });

        it('a take still recording is never discarded', async () => {
            const uid = randomUUID();
            await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [uid, `j1f-live-${uid}@example.test`]);
            // A take started in trial is still heartbeating when the owner confirms deletion.
            await asUser(uid, () => db.query("SELECT public.acquire_recording_lease($1::uuid,'j1f-live',false)", [randomUUID()]));
            await confirmDeletion(uid);
            expect(await discard(uid)).toMatchObject({ discarded: 0, reason: 'recording_live' });
            expect((await unsettled(uid)).length).toBeGreaterThan(0);
            expect((await db.query('SELECT 1 FROM public.recording_start_abandonments WHERE user_id=$1', [uid])).rows).toEqual([]);
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

    // The real payment path, not a direct profile write: the checkout an expired user starts stays open, access stays
    // closed while that checkout is unpaid, the webhook's confirmed (active, approved-price) snapshot restores it, and a
    // later terminal snapshot closes it again. Stripe is never called; these are the rows its webhook would write.
    it('an expired user can check out, and only the confirmed payment snapshot restores access', async () => {
        const { uid, session } = await fixture();
        const [sql, params] = callFor('get_analytics_summary', uid, session);
        const access = () => asUser(uid, async () =>
            (await db.query<{ a: boolean }>('SELECT public.current_account_has_product_access() AS a')).rows[0].a);
        const service = (text: string, values: unknown[]) => asRole('service_role', null, () => db.query<{ r: unknown }>(text, values));
        const sub = `sub_synthetic_checkout_${uid}`, cus = `cus_synthetic_checkout_${uid}`, cs = `cs_synthetic_${uid}`;
        await expire(uid);
        expect(await outcome(uid, sql, params)).toMatch(PAYMENT_REQUIRED);

        const op = (await service('SELECT public.begin_account_checkout($1) AS r', [uid])).rows[0].r as string;
        await service('SELECT public.record_account_checkout($1,$2,$3)', [uid, op, cs]);
        expect(await access()).toBe(false);
        expect(await outcome(uid, sql, params)).toMatch(PAYMENT_REQUIRED);

        const paid = (await service("SELECT public.apply_account_checkout_snapshot($1,$2,$3,$4,$5,$6,'active',true) AS r",
            [uid, op, cs, `evt_synthetic_paid_${uid}`, sub, cus])).rows[0].r;
        expect(paid).toMatchObject({ success: true, entitlement: 'pro' });
        expect((await db.query('SELECT phase FROM public.account_checkout_operations WHERE operation_id=$1', [op])).rows)
            .toEqual([{ phase: 'settled' }]);
        expect(await access()).toBe(true);
        expect(await outcome(uid, sql, params)).toBe('ok');

        // As the webhook sends a subscription deletion: no user id, so the snapshot finds the account by its binding.
        const ended = (await service("SELECT public.apply_stripe_subscription_snapshot($1,$2,$3,'canceled',false,false,NULL,NULL) AS r",
            [`evt_synthetic_canceled_${uid}`, sub, cus])).rows[0].r;
        expect(ended).toMatchObject({ success: true });
        expect(await access()).toBe(false);
        expect(await outcome(uid, sql, params)).toMatch(PAYMENT_REQUIRED);
    });
});
