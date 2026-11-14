import { describe, expect, it, vi } from 'vitest';
import { cleanAndVerifyFeedbackFence, cleanFeedbackFence, closeFeedbackFence, fenceCleanupVerdict, fenceRunKey, openFeedbackFence,
    verifyFeedbackFence, type FenceRpcClient } from '../live/helpers/feedbackFence';
import type { RunBinding } from '../live/helpers/runBinding';

const BINDING: RunBinding = { repository: 'relativityE/speaksharp', workflow: 'relativityE/speaksharp/.github/workflows/rc-gates.yml@refs/heads/main',
    runId: '43583228045', runAttempt: '1', role: 'rwt-journey' };
const OWNER = '11111111-1111-4111-8111-111111111111';
const client = (reply: { data: unknown; error: { code?: string } | null }) => {
    const rpc = vi.fn(async () => reply);
    return { admin: { rpc } as unknown as FenceRpcClient, rpc };
};
/** Per-function replies; a function may answer once with a thrown transport failure. */
const routed = (replies: Record<string, { data: unknown; error: { code?: string } | null } | 'throw'>) => {
    const rpc = vi.fn(async (fn: string) => {
        const reply = replies[fn];
        if (reply === 'throw') throw new Error('socket hang up');
        return reply ?? { data: null, error: { code: 'unexpected' } };
    });
    return { admin: { rpc } as unknown as FenceRpcClient, rpc };
};
const openReadback = { exists: true, state: 'open', owner: OWNER, case: 'AHT-02', recorded: 0, keys: 0, remaining: 0, foreign: 0 };

describe('#1811 feedback fence helper', () => {
    it('derives the run key exactly as the database does, and refuses malformed parts', () => {
        expect(fenceRunKey(BINDING, 'AHT-08')).toBe('43583228045-1-AHT-08');
        expect(fenceRunKey(BINDING, 'AHT-07+AHT-08')).toBe('43583228045-1-AHT-07+AHT-08');
        expect(() => fenceRunKey({ ...BINDING, runId: '0' }, 'AHT-02')).toThrow(/invalid run key/);
        expect(() => fenceRunKey(BINDING, 'AHT-03' as never)).toThrow(/invalid run key/);
    });

    it('opens with the exact binding, case and cap, and is CONFIRMED by a read-only readback before any write', async () => {
        const ok = routed({ open_rwt_feedback_fence_v1: { data: '43583228045-1-AHT-02', error: null },
            verify_rwt_feedback_fence_v1: { data: openReadback, error: null } });
        await expect(openFeedbackFence(ok.admin, OWNER, BINDING, 'AHT-02', 1)).resolves.toBe('43583228045-1-AHT-02');
        expect(ok.rpc.mock.calls).toEqual([
            ['open_rwt_feedback_fence_v1', { p_owner: OWNER, p_binding: BINDING, p_case: 'AHT-02', p_key_cap: 1 }],
            ['verify_rwt_feedback_fence_v1', { p_run_key: '43583228045-1-AHT-02' }],
        ]);
        await expect(openFeedbackFence(ok.admin, OWNER, BINDING, 'AHT-02', 0)).rejects.toThrow(/key cap/);
        await expect(openFeedbackFence(ok.admin, OWNER, BINDING, 'AHT-02', 9)).rejects.toThrow(/key cap/);
    });

    it('an UNCERTAIN open (error, lost response, odd payload) is recovered by its key — never by reopening', async () => {
        for (const openReply of [{ data: null, error: { code: '57014' } }, 'throw' as const, { data: 'garbage', error: null }]) {
            // The open actually happened: the readback shows this owner's open fence, so it is accepted without a second open.
            const landed = routed({ open_rwt_feedback_fence_v1: openReply, verify_rwt_feedback_fence_v1: { data: openReadback, error: null } });
            await expect(openFeedbackFence(landed.admin, OWNER, BINDING, 'AHT-02', 1)).resolves.toBe('43583228045-1-AHT-02');
            expect(landed.rpc.mock.calls.filter(([fn]) => fn === 'open_rwt_feedback_fence_v1')).toHaveLength(1);
            // The open did not happen (or is someone else's / not open): HOLD, never a second open.
            for (const readback of [{ exists: false }, { ...openReadback, owner: '22222222-2222-4222-8222-222222222222' },
                { ...openReadback, state: 'closed' }, { ...openReadback, case: 'AHT-07' }]) {
                const absent = routed({ open_rwt_feedback_fence_v1: openReply, verify_rwt_feedback_fence_v1: { data: readback, error: null } });
                await expect(openFeedbackFence(absent.admin, OWNER, BINDING, 'AHT-02', 1)).rejects.toThrow(/fail closed/);
                expect(absent.rpc.mock.calls.filter(([fn]) => fn === 'open_rwt_feedback_fence_v1')).toHaveLength(1);
            }
        }
        // A readback that itself fails is fail-closed too.
        const blind = routed({ open_rwt_feedback_fence_v1: 'throw', verify_rwt_feedback_fence_v1: 'throw' });
        await expect(openFeedbackFence(blind.admin, OWNER, BINDING, 'AHT-02', 1)).rejects.toThrow();
    });

    it('verify is read-only in shape: refuses malformed readbacks', async () => {
        await expect(verifyFeedbackFence(client({ data: { exists: false }, error: null }).admin, 'k')).resolves.toEqual({ exists: false });
        await expect(verifyFeedbackFence(client({ data: { exists: true, state: 'open' }, error: null }).admin, 'k')).rejects.toThrow(/shape/);
        await expect(verifyFeedbackFence(client({ data: null, error: { code: '42501' } }).admin, 'k')).rejects.toThrow(/verify failed/);
    });

    it('close and clean return only counts and states, and fail closed on errors or unexpected shapes', async () => {
        await expect(closeFeedbackFence(client({ data: { state: 'closed', reports: 2, keys: 1 }, error: null }).admin, 'k'))
            .resolves.toEqual({ state: 'closed', reports: 2, keys: 1 });
        await expect(closeFeedbackFence(client({ data: { state: 'open', reports: 0, keys: 0 }, error: null }).admin, 'k')).rejects.toThrow(/shape/);
        await expect(closeFeedbackFence(client({ data: null, error: { code: 'P0002' } }).admin, 'k')).rejects.toThrow(/close failed.*P0002/);
        await expect(cleanFeedbackFence(client({ data: { deleted: 1, residue: 0, foreign: 0, state: 'cleaned' }, error: null }).admin, 'k'))
            .resolves.toEqual({ deleted: 1, residue: 0, foreign: 0, state: 'cleaned' });
        await expect(cleanFeedbackFence(client({ data: { deleted: '1', residue: 0, foreign: 0, state: 'cleaned' }, error: null }).admin, 'k')).rejects.toThrow(/shape/);
        await expect(cleanFeedbackFence(client({ data: null, error: { code: '55000' } }).admin, 'k')).rejects.toThrow(/clean failed.*55000/);
    });

    it('PASSes cleanup only on a zero readback with nothing foreign and no over-deletion', async () => {
        const closed = { state: 'closed' as const, reports: 2, keys: 1 };
        const zero = { exists: true, state: 'cleaned' as const, owner: OWNER, case: 'AHT-02', recorded: 2, keys: 1, remaining: 0, foreign: 0 };
        expect(fenceCleanupVerdict(closed, { deleted: 2, residue: 0, foreign: 0, state: 'cleaned' }, zero).verdict).toBe('PASS');
        // The INDEPENDENT readback is required: clean's own zero alone never PASSes.
        expect(fenceCleanupVerdict(closed, { deleted: 2, residue: 0, foreign: 0, state: 'cleaned' }).verdict).toBe('FAIL');
        expect(fenceCleanupVerdict(closed, { deleted: 2, residue: 0, foreign: 0, state: 'cleaned' }, { ...zero, remaining: 1 }).verdict).toBe('FAIL');
        const both = routed({ clean_rwt_feedback_fence_v1: { data: { deleted: 2, residue: 0, foreign: 0, state: 'cleaned' }, error: null },
            verify_rwt_feedback_fence_v1: { data: zero, error: null } });
        const result = await cleanAndVerifyFeedbackFence(both.admin, 'k');
        expect(fenceCleanupVerdict(closed, result.cleaned, result.readback).verdict).toBe('PASS');
        expect(fenceCleanupVerdict(null, { deleted: 0, residue: 0, foreign: 0, state: 'cleaned' }).verdict).toBe('FAIL');
        expect(fenceCleanupVerdict(closed, null).verdict).toBe('FAIL');
        expect(fenceCleanupVerdict(closed, { deleted: 1, residue: 1, foreign: 0, state: 'closed' }).verdict).toBe('FAIL');
        expect(fenceCleanupVerdict(closed, { deleted: 1, residue: 0, foreign: 1, state: 'closed' }).verdict).toBe('FAIL');
        expect(fenceCleanupVerdict(closed, { deleted: 3, residue: 0, foreign: 0, state: 'cleaned' }).verdict).toBe('FAIL');
    });
});

// ── Runner integration over a stateful fake of the fence RPCs (Sam, #1859 review: lost open/close responses, interrupted cleanup) ──
import { JourneyFeedbackFence } from '../live/helpers/feedbackFence';
import { recoverInterruptedRuns, recoveryDeleteAck, type RunAttemptState } from '../live/helpers/rwtInterruptedRunRecovery';

type Fence = { owner: string; case: string; state: 'open' | 'closed' | 'cleaned'; reports: string[]; binding: unknown };
/** A fake database: open/close/clean/verify with the migration's semantics; `lose` drops the NEXT answer of a function after it ran. */
function fakeDb() {
    const fences = new Map<string, Fence>();
    const reports = new Map<string, string | null>(); // id → owner (null: ownerless)
    const lose = new Set<string>();
    const fail = new Set<string>();
    const rpc = vi.fn(async (fn: string, a: Record<string, unknown>) => {
        if (fail.has(fn)) { fail.delete(fn); throw new Error('connection reset'); }
        let reply: { data: unknown; error: { code?: string } | null };
        const key = a.p_run_key !== undefined ? String(a.p_run_key)
            : a.p_binding ? `${(a.p_binding as RunBinding).runId}-${(a.p_binding as RunBinding).runAttempt}-${a.p_case}` : '';
        const f = fences.get(key);
        if (fn === 'open_rwt_feedback_fence_v1') {
            if (f || [...fences.values()].some((x) => x.owner === a.p_owner)) reply = { data: null, error: { code: '23505' } };
            else { fences.set(key, { owner: String(a.p_owner), case: String(a.p_case), state: 'open', reports: [], binding: a.p_binding }); reply = { data: key, error: null }; }
        } else if (fn === 'list_unresolved_rwt_feedback_fences_v1') {
            reply = { data: [...fences.entries()].filter(([, x]) => x.state !== 'cleaned')
                .map(([run_key, x]) => ({ run_key, state: x.state, binding: x.binding, opened_at: '2026-11-14T00:00:00Z' })), error: null };
        } else if (!f) reply = fn === 'verify_rwt_feedback_fence_v1' ? { data: { exists: false }, error: null } : { data: null, error: { code: 'P0002' } };
        else if (fn === 'close_rwt_feedback_fence_v1') { if (f.state === 'open') f.state = 'closed'; reply = { data: { state: f.state, reports: f.reports.length, keys: f.reports.length }, error: null }; }
        else if (fn === 'clean_rwt_feedback_fence_v1') {
            if (f.state === 'open') reply = { data: null, error: { code: '55000' } };
            else {
                let deleted = 0;
                for (const id of f.reports) { const o = reports.get(id); if (reports.has(id) && (o === null || o === f.owner)) { reports.delete(id); deleted += 1; } }
                const residue = f.reports.filter((id) => reports.has(id)).length;
                if (residue === 0) f.state = 'cleaned';
                reply = { data: { deleted, residue, foreign: residue, state: f.state }, error: null };
            }
        } else {
            const remaining = f.reports.filter((id) => reports.has(id) && (reports.get(id) === null || reports.get(id) === f.owner)).length;
            const foreign = f.reports.filter((id) => reports.has(id) && reports.get(id) !== null && reports.get(id) !== f.owner).length;
            reply = { data: { exists: true, state: f.state, owner: f.owner, case: f.case, recorded: f.reports.length, keys: f.reports.length, remaining, foreign }, error: null };
        }
        if (lose.has(fn)) { lose.delete(fn); throw new Error('response lost'); }
        return reply;
    });
    /** The product's insert, recorded by the trigger only while the account's fence is open. */
    const write = (owner: string, id: string) => {
        const f = [...fences.values()].find((x) => x.owner === owner);
        if (f && f.state !== 'open') return false;
        reports.set(id, owner); f?.reports.push(id); return true;
    };
    return { admin: { rpc } as unknown as FenceRpcClient, rpc, fences, reports, lose, fail, write };
}
const rows = () => { const list: Array<[string, string]> = []; return { list, sink: { row: (n: string, v: string) => { list.push([n, v]); } } }; };
const SHA = 'a'.repeat(40);
/** The governed recovery, from a LATER run, with NO run-owned account left to list: fences are found by the database's own listing. */
async function recover(db: ReturnType<typeof fakeDb>, state: RunAttemptState = 'terminal') {
    for (const [k, v] of Object.entries({ GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: BINDING.repository, GITHUB_WORKFLOW_REF: BINDING.workflow,
        GITHUB_RUN_ID: '49999999999', GITHUB_RUN_ATTEMPT: '1' })) vi.stubEnv(k, v);
    const runState = vi.fn(async () => state);
    const listUsers = vi.fn(async () => ({ data: { users: [] }, error: null }));
    const report = await recoverInterruptedRuns({ admin: { auth: { admin: { listUsers } }, rpc: db.rpc } as never, nowMs: Date.now(),
        ack: recoveryDeleteAck(SHA), sha: SHA, domain: 'rwt.example.org', minAgeMs: 0, runState });
    vi.unstubAllEnvs();
    return { report, runState };
}

describe('#1811 JourneyFeedbackFence — the runner sequence', () => {
    it('the designed run: open → write → close → account deletion (report ownerless) → clean → independent zero', async () => {
        const db = fakeDb(); const r = rows();
        const fence = new JourneyFeedbackFence(db.admin, 'AHT-02', 1);
        expect(fence.writable).toBe(false);
        expect(await fence.open(OWNER, BINDING)).toBe(true);
        expect(fence.writable).toBe(true);
        db.write(OWNER, 'r1');
        expect((await fence.close(r.sink))?.reports).toBe(1);
        expect(fence.writable).toBe(false);
        db.reports.set('r1', null); // the account deletion (ON DELETE SET NULL); the retention proof reads it here
        expect(await fence.cleanRow(r.sink)).toBe('PASS');
        expect(db.reports.size).toBe(0);
        expect(r.list).toEqual([['feedback fence close', 'PASS'], ['feedback fence cleanup', 'PASS']]);
    });
    it('a LOST open response is recovered by the key (one open only); a fence that never opened HOLDs with no write', async () => {
        const db = fakeDb();
        db.lose.add('open_rwt_feedback_fence_v1');
        const fence = new JourneyFeedbackFence(db.admin, 'AHT-08', 1);
        expect(await fence.open(OWNER, BINDING)).toBe(true);
        expect(db.rpc.mock.calls.filter(([fn]) => fn === 'open_rwt_feedback_fence_v1')).toHaveLength(1);
        const none = fakeDb();
        none.fail.add('open_rwt_feedback_fence_v1'); // transport failed before the database ran it
        const held = new JourneyFeedbackFence(none.admin, 'AHT-08', 1);
        expect(await held.open(OWNER, BINDING)).toBe(false);
        expect(held.writable).toBe(false);
        expect(held.heldReason).toMatch(/fail closed/);
        const r = rows(); held.openRow(r.sink);
        expect(r.list).toEqual([['feedback fence open', 'HOLD']]);
        expect(none.fences.size).toBe(0);
    });
    it('stopWriter() stops writes while the fence stays open, so close still runs and records the drained writer', async () => {
        const db = fakeDb(); const r = rows();
        const fence = new JourneyFeedbackFence(db.admin, 'AHT-07', 4);
        expect(await fence.open(OWNER, BINDING)).toBe(true);
        expect(fence.writable).toBe(true);
        fence.stopWriter();
        expect(fence.writable).toBe(false);
        expect(fence.isOpen).toBe(true);
        expect((await fence.close(r.sink))?.reports).toBe(0);
        expect(r.list).toEqual([['feedback fence close', 'PASS']]);
    });
    it('no run binding (a local run) never opens and never writes', async () => {
        const db = fakeDb();
        const fence = new JourneyFeedbackFence(db.admin, 'AHT-01', 1);
        expect(await fence.open(OWNER, null)).toBe(false);
        expect(db.rpc).not.toHaveBeenCalled();
    });
    it('a LOST close response FAILs the row and never cleans; recovery then closes (idempotent) and cleans by run key', async () => {
        const db = fakeDb(); const r = rows();
        const fence = new JourneyFeedbackFence(db.admin, 'AHT-07', 4);
        await fence.open(OWNER, BINDING);
        db.write(OWNER, 'r1'); db.write(OWNER, 'r2');
        db.lose.add('close_rwt_feedback_fence_v1');
        expect(await fence.close(r.sink)).toBeNull();
        expect(db.write(OWNER, 'late')).toBe(false); // the close DID run: later writes are refused
        expect(await fence.cleanRow(r.sink)).toBe('FAIL');
        expect(db.reports.size).toBe(2); // nothing deleted without an acknowledged close
        const { report } = await recover(db);
        expect(report).toMatchObject({ status: 'RECOVERED', feedback: { listed: 1, fences: 1, deleted: 2, residue: 0, foreign: 0, held: 0 } });
        expect(db.reports.size).toBe(0);
    });
    it('an INTERRUPTED cleanup FAILs (never PASS on clean\'s own word); recovery finishes it and the readback reads zero', async () => {
        const db = fakeDb(); const r = rows();
        const fence = new JourneyFeedbackFence(db.admin, 'AHT-07', 4);
        await fence.open(OWNER, BINDING);
        db.write(OWNER, 'r1');
        await fence.close(r.sink);
        db.lose.add('clean_rwt_feedback_fence_v1'); // the delete ran, its answer was lost
        expect(await fence.cleanRow(r.sink, 'zero residue')).toBe('FAIL');
        expect(r.list.at(-1)).toEqual(['zero residue', 'FAIL']);
        // The clean DID run (only its answer was lost): the fence is cleaned, so recovery lists nothing to do, and the
        // independent read-only readback confirms zero remaining.
        const { report } = await recover(db);
        expect(report).toMatchObject({ status: 'NOTHING_TO_RECOVER', feedback: { listed: 0, fences: 0 } });
        const { verifyFeedbackFence } = await import('../live/helpers/feedbackFence');
        expect(await verifyFeedbackFence(db.admin, '43583228045-1-AHT-07')).toMatchObject({ exists: true, state: 'cleaned', remaining: 0, foreign: 0 });
    });
    it('a recorded report now owned by ANOTHER account is never deleted, and FAILs both the run and recovery', async () => {
        const db = fakeDb(); const r = rows();
        const fence = new JourneyFeedbackFence(db.admin, 'AHT-07', 4);
        await fence.open(OWNER, BINDING);
        db.write(OWNER, 'r1');
        await fence.close(r.sink);
        db.reports.set('r1', '22222222-2222-4222-8222-222222222222');
        expect(await fence.cleanRow(r.sink)).toBe('FAIL');
        expect(db.reports.get('r1')).toBe('22222222-2222-4222-8222-222222222222');
        const { report } = await recover(db);
        expect(report.status).toBe('FAILED');
        expect(report.feedback.foreign).toBeGreaterThan(0);
        expect(db.reports.get('r1')).toBe('22222222-2222-4222-8222-222222222222');
    });
    it('THE POST-DELETION WINDOW (Sam, #1860): committed → closed → account deleted → runner lost → a separate recovery cleans only those ids', async () => {
        const db = fakeDb(); const r = rows();
        const fence = new JourneyFeedbackFence(db.admin, 'AHT-02', 1);
        await fence.open(OWNER, BINDING);
        db.write(OWNER, 'r1');
        db.reports.set('someone-elses', '22222222-2222-4222-8222-222222222222'); // never recorded by this fence
        await fence.close(r.sink);
        db.reports.set('r1', null); // the journey deletes its account (ON DELETE SET NULL) ...
        // ... and the runner is lost before fence.cleanRow. The account no longer exists to be listed.
        const { report, runState } = await recover(db);
        expect(runState).toHaveBeenCalledTimes(1); // the run attempt was checked BEFORE anything was touched
        expect(report).toMatchObject({ status: 'RECOVERED', eligible: 0, feedback: { listed: 1, fences: 1, deleted: 1, residue: 0, foreign: 0 } });
        expect([...db.reports.keys()]).toEqual(['someone-elses']);
        expect([...db.fences.values()][0].state).toBe('cleaned');
    });
    it.each(['active', 'unverifiable'] as const)('a %s run attempt: NOTHING is closed or deleted, and the run is reported held', async (state) => {
        const db = fakeDb(); const r = rows();
        const fence = new JourneyFeedbackFence(db.admin, 'AHT-07', 4);
        await fence.open(OWNER, BINDING);
        db.write(OWNER, 'r1');
        void r;
        const before = db.rpc.mock.calls.length;
        const { report } = await recover(db, state);
        expect(report).toMatchObject({ status: 'HOLD_ACTIVE_RUN', feedback: { listed: 1, fences: 0, deleted: 0, held: 1 } });
        const after = db.rpc.mock.calls.slice(before).map(([fn]) => fn);
        expect(after).toEqual(['list_unresolved_rwt_feedback_fences_v1']); // no close, clean or verify
        expect([...db.fences.values()][0].state).toBe('open');
        expect(db.reports.has('r1')).toBe(true);
    });
});
