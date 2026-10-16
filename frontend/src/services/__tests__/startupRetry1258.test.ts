/**
 * #1258 C10 — `Try again` during a slow start (PM 6205858358 item 3, PM 6207105255 item 1).
 *
 * Driven on the REAL start-attempt registry: an "old hook invocation" is an attempt that settles only when the test lets it
 * return. Controls: a still-busy old invocation, an owner change and a navigation at the suspension, a successor attempt,
 * a take that goes live meanwhile, and failure cleanup that must never touch a successor. The replacement is Start-only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STARTUP_RETRY_UNWIND_FAILED_MESSAGE, cancelStartupAndRetry, type StartupRetryDeps } from '../startupRetry';
import { __resetStartAttemptsForTests, beginStartAttempt, currentStartAttempt } from '../startAttemptRegistry';

type World = {
    waitPending: boolean; captureLive: boolean; runtimeState: string; owner: string | null; mounted: boolean; cancellingFor: string | null;
    waitCleared: number; pending: string | null;
};

/**
 * One slow start in flight (attempt A, unsettled). `duringReset` runs inside the controller's teardown — the suspension
 * point where the world can move. By default the teardown lets A's invocation return (it unwinds).
 */
const harness = (opts: { duringReset?: (w: World, settleA: () => void) => void; rejectReset?: boolean; terminal?: boolean;
    settles?: boolean; world?: Partial<World> } = {}) => {
    __resetStartAttemptsForTests();
    const { attempt: a, settle: settleA } = beginStartAttempt();
    const w: World = { waitPending: true, captureLive: false, runtimeState: 'ENGINE_INITIALIZING', owner: 'user-1', mounted: true, cancellingFor: null,
        waitCleared: 0, pending: null, ...opts.world };
    const calls: string[] = [];
    const deps: StartupRetryDeps = {
        attemptId: a.id,
        ownerAtRender: 'user-1',
        read: () => {
            const latest = currentStartAttempt();
            return {
                attemptId: latest?.id ?? null, attemptSettled: latest?.id === a.id ? a.isSettled() : true,
                waitPending: w.waitPending, captureLive: w.captureLive, runtimeState: w.runtimeState, owner: w.owner, mounted: w.mounted, cancellingFor: w.cancellingFor,
            };
        },
        waitForSettled: (ms) => Promise.race([a.settled.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), ms))]),
        controller: {
            pendingResolutionKind: () => w.pending,
            hardResetAwaited: vi.fn(async () => {
                calls.push('reset');
                w.runtimeState = 'IDLE';
                opts.duringReset?.(w, settleA);
                if (opts.settles !== false && !opts.duringReset) settleA(); // the old invocation returns as it unwinds
                if (opts.rejectReset) throw new Error('destroy rejected');
            }),
            isEngineTerminal: () => opts.terminal ?? true,
        },
        setCancelling: (id) => { w.cancellingFor = id; calls.push(`cancelling:${id === null ? 'none' : id === a.id ? 'A' : 'other'}`); },
        clearWait: () => { w.waitCleared += 1; calls.push('clearWait'); },
        reportFailure: vi.fn((m: string) => { calls.push(`failure:${m}`); }),
        unconfirmedMessage: 'UNCONFIRMED',
        restartStartOnly: vi.fn(async () => { calls.push(`restartStartOnly(cancelling=${w.cancellingFor === null ? 'none' : 'set'})`); }),
        settleMs: 60,
    };
    return { deps, calls, w, a, settleA };
};

describe('C10 Try again — bound to the attempt it was pressed for', () => {
    beforeEach(() => __resetStartAttemptsForTests());

    it('the old invocation returns: confirmed release, marker cleared, then exactly ONE Start-only replacement', async () => {
        const { deps, calls } = harness();
        expect(await cancelStartupAndRetry(deps)).toBe('restarted');
        expect(calls).toEqual(['cancelling:A', 'reset', 'cancelling:none', 'restartStartOnly(cancelling=none)']);
        expect(deps.restartStartOnly).toHaveBeenCalledTimes(1);
    });

    it('STILL-BUSY old invocation (the UI wait may have cleared, the call has not returned): nothing starts, a truthful failure', async () => {
        const { deps, calls } = harness({ settles: false });
        expect(await cancelStartupAndRetry(deps)).toBe('unwind_timeout');
        expect(deps.restartStartOnly).not.toHaveBeenCalled();
        expect(calls).toContain(`failure:${STARTUP_RETRY_UNWIND_FAILED_MESSAGE}`);
        expect(calls[calls.length - 1]).toBe('cancelling:none');
    });

    it.each([
        ['the owner changes', (w: World) => { w.owner = 'someone-else'; }],
        ['the page is left (navigation/unmount)', (w: World) => { w.mounted = false; }],
        ['the take goes live', (w: World) => { w.captureLive = true; w.runtimeState = 'RECORDING'; }],
        ['an unresolved save appears', (w: World) => { w.pending = 'full_save'; }],
    ] as const)('%s at the suspension → superseded: no restart, no report, no successor state touched', async (_label, move) => {
        const { deps, calls } = harness({ duringReset: (w, settleA) => { move(w); settleA(); } });
        expect(await cancelStartupAndRetry(deps)).toBe('superseded');
        expect(deps.restartStartOnly).not.toHaveBeenCalled();
        expect(deps.reportFailure).not.toHaveBeenCalled();
        expect(calls).not.toContain('clearWait');
    });

    it('a SUCCESSOR attempt begins during the teardown → superseded; its wait and marker are untouched, no restart claimed', async () => {
        let successor = '';
        const { deps, calls, w } = harness({ duringReset: (world, settleA) => {
            settleA();
            successor = beginStartAttempt().attempt.id;
            world.cancellingFor = successor; // the successor's own state, which must survive
        } });
        expect(await cancelStartupAndRetry(deps)).toBe('superseded');
        expect(deps.restartStartOnly).not.toHaveBeenCalled();
        expect(calls).not.toContain('clearWait');
        expect(w.cancellingFor, 'the successor\'s marker is not cleared by the retired attempt').toBe(successor);
    });

    it('a failed teardown while a successor owns the page → superseded: the failure is NOT reported into the successor', async () => {
        const { deps, calls } = harness({ rejectReset: true, duringReset: () => { beginStartAttempt(); } });
        expect(await cancelStartupAndRetry(deps)).toBe('superseded');
        expect(deps.reportFailure).not.toHaveBeenCalled();
        expect(calls).not.toContain('clearWait');
    });

    it('a failed or unconfirmed teardown of its OWN attempt → the truthful failure, the wait cleared, no restart', async () => {
        const rejected = harness({ rejectReset: true });
        expect(await cancelStartupAndRetry(rejected.deps)).toBe('release_unconfirmed');
        expect(rejected.calls).toEqual(['cancelling:A', 'reset', 'clearWait', 'failure:UNCONFIRMED', 'cancelling:none']);
        const unconfirmed = harness({ terminal: false });
        expect(await cancelStartupAndRetry(unconfirmed.deps)).toBe('release_unconfirmed');
        expect(unconfirmed.deps.restartStartOnly).not.toHaveBeenCalled();
    });

    it.each([
        ['already live', { captureLive: true, runtimeState: 'RECORDING' }],
        ['not starting', { runtimeState: 'READY' }],
        ['another owner', { owner: 'someone-else' }],
        ['left page', { mounted: false }],
        ['an unresolved save', { pending: 'full_save' }],
    ] as const)('pressed while %s → not applicable: nothing is torn down', async (_label, world) => {
        const { deps, calls } = harness({ world });
        expect(await cancelStartupAndRetry(deps)).toBe('not_applicable');
        expect(deps.controller.hardResetAwaited).not.toHaveBeenCalled();
        expect(calls).toEqual([]);
    });

    it('pressed for an attempt that a successor has replaced, or whose wait has ENDED → not applicable', async () => {
        const replaced = harness();
        beginStartAttempt();
        expect(await cancelStartupAndRetry(replaced.deps)).toBe('not_applicable');
        const ended = harness({ world: { waitPending: false } });
        ended.settleA();
        expect(await cancelStartupAndRetry(ended.deps)).toBe('not_applicable');
        expect(ended.deps.controller.hardResetAwaited).not.toHaveBeenCalled();
    });

    it('PM 6207494433: Start settled at RECORDING without real frames (wait still on, not live) → admitted: one retirement, one Start-only replacement', async () => {
        const { deps, calls, settleA } = harness({ world: { runtimeState: 'RECORDING', waitPending: true, captureLive: false } });
        settleA(); // the controller's Start resolved at FSM RECORDING; the hook's finally ran
        expect(await cancelStartupAndRetry(deps)).toBe('restarted');
        expect(deps.controller.hardResetAwaited).toHaveBeenCalledTimes(1);
        expect(deps.restartStartOnly).toHaveBeenCalledTimes(1);
        expect(calls).toEqual(['cancelling:A', 'reset', 'cancelling:none', 'restartStartOnly(cancelling=none)']);
    });

    it('settled and LIVE (real frames arrived) → not applicable: a recording is never cancelled by Try again', async () => {
        const { deps, settleA } = harness({ world: { runtimeState: 'RECORDING', waitPending: false, captureLive: true } });
        settleA();
        expect(await cancelStartupAndRetry(deps)).toBe('not_applicable');
        expect(deps.controller.hardResetAwaited).not.toHaveBeenCalled();
    });

    it('the replacement\'s own failure propagates (never swallowed as the cancel)', async () => {
        const { deps } = harness();
        deps.restartStartOnly = vi.fn(async () => { throw new Error('ENGINE_START_FAILED'); });
        await expect(cancelStartupAndRetry(deps)).rejects.toThrow('ENGINE_START_FAILED');
    });
});
