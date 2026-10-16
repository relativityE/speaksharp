/**
 * #1258 C10 — `Try again` during a slow start (PM 6205858358 item 3). The facts are re-read at the destructive boundary;
 * anything that moved means nothing is torn down. A rejected, unconfirmed or stuck teardown starts nothing and reports a
 * truthful failure. Exactly one new start, issued only after the deliberate-cancel marker is cleared.
 */
import { describe, expect, it, vi } from 'vitest';
import { STARTUP_RETRY_UNWIND_FAILED_MESSAGE, cancelStartupAndRetry, type StartupRetryDeps } from '../startupRetry';

const T0 = 1_000;
const harness = (over: Partial<{ startupWaitStartedAt: number | null; captureLive: boolean; runtimeState: string; owner: string | null;
    pending: string | null; reset: () => Promise<void>; terminal: boolean; unwinds: boolean }> = {}) => {
    const state: { startupWaitStartedAt: number | null; captureLive: boolean; runtimeState: string; owner: string | null; cancelling: boolean } = {
        startupWaitStartedAt: 'startupWaitStartedAt' in over ? over.startupWaitStartedAt ?? null : T0,
        captureLive: over.captureLive ?? false,
        runtimeState: over.runtimeState ?? 'ENGINE_INITIALIZING',
        owner: 'owner' in over ? over.owner! : 'user-1',
        cancelling: false,
    };
    const calls: string[] = [];
    const deps: StartupRetryDeps = {
        attemptStartedAt: T0,
        ownerAtRender: 'user-1',
        read: () => ({ ...state }),
        controller: {
            pendingResolutionKind: () => over.pending ?? null,
            hardResetAwaited: vi.fn(async () => {
                calls.push('reset');
                await (over.reset ?? (async () => undefined))();
                // The cancelled attempt's own handler ends its wait as it unwinds.
                if (over.unwinds !== false) state.startupWaitStartedAt = null;
            }),
            isEngineTerminal: () => over.terminal ?? true,
        },
        setCancelling: (v) => { state.cancelling = v; calls.push(`cancelling:${v}`); },
        clearWait: () => { state.startupWaitStartedAt = null; calls.push('clearWait'); },
        reportFailure: vi.fn((m: string) => { calls.push(`failure:${m}`); }),
        unconfirmedMessage: 'UNCONFIRMED',
        restart: vi.fn(async () => { calls.push(`restart(cancelling=${state.cancelling})`); }),
        settleMs: 200,
        sleep: () => new Promise((r) => setTimeout(r, 5)),
    };
    return { deps, calls, state };
};

describe('C10 Try again — re-read at the destructive boundary', () => {
    it('the pending attempt, still slow: confirmed release, then exactly ONE new start with the cancel marker already cleared', async () => {
        const { deps, calls } = harness();
        expect(await cancelStartupAndRetry(deps)).toBe('restarted');
        expect(calls).toEqual(['cancelling:true', 'reset', 'cancelling:false', 'restart(cancelling=false)']);
        expect(deps.restart).toHaveBeenCalledTimes(1);
        expect(deps.reportFailure).not.toHaveBeenCalled();
    });

    it.each([
        ['the take went live meanwhile', { captureLive: true, runtimeState: 'RECORDING' }],
        ['a successor attempt owns the wait', { startupWaitStartedAt: T0 + 5_000 }],
        ['the wait already ended', { startupWaitStartedAt: null }],
        ['the runtime is no longer starting', { runtimeState: 'READY' }],
        ['the owner changed', { owner: 'someone-else' }],
        ['an unresolved save exists', { pending: 'full_save' }],
    ] as const)('%s → nothing is torn down and nothing starts', async (_label, over) => {
        const { deps, calls } = harness(over);
        expect(await cancelStartupAndRetry(deps)).toBe('not_applicable');
        expect(deps.controller.hardResetAwaited).not.toHaveBeenCalled();
        expect(deps.restart).not.toHaveBeenCalled();
        expect(calls).toEqual([]);
    });
});

describe('C10 Try again — a failed teardown starts nothing and says so', () => {
    it('a rejected teardown → the truthful unconfirmed failure, the wait cleared, no new start', async () => {
        const { deps, calls } = harness({ reset: async () => { throw new Error('destroy rejected'); }, unwinds: false });
        expect(await cancelStartupAndRetry(deps)).toBe('release_unconfirmed');
        expect(deps.restart).not.toHaveBeenCalled();
        expect(calls).toEqual(['cancelling:true', 'reset', 'clearWait', 'failure:UNCONFIRMED', 'cancelling:false']);
    });

    it('an engine not proven off → the truthful unconfirmed failure, no new start', async () => {
        const { deps } = harness({ terminal: false });
        expect(await cancelStartupAndRetry(deps)).toBe('release_unconfirmed');
        expect(deps.reportFailure).toHaveBeenCalledWith('UNCONFIRMED');
        expect(deps.restart).not.toHaveBeenCalled();
    });

    it('the cancelled attempt never unwinds → a truthful failure after the bound, no new start', async () => {
        const { deps, state } = harness({ unwinds: false });
        expect(await cancelStartupAndRetry(deps)).toBe('unwind_timeout');
        expect(deps.reportFailure).toHaveBeenCalledWith(STARTUP_RETRY_UNWIND_FAILED_MESSAGE);
        expect(deps.restart).not.toHaveBeenCalled();
        expect(state.startupWaitStartedAt, 'the page leaves "Getting your mic ready…"').toBeNull();
        expect(state.cancelling).toBe(false);
    });

    it('the new start\'s own failure is not swallowed as the cancel', async () => {
        const { deps } = harness();
        deps.restart = vi.fn(async () => { throw new Error('ENGINE_START_FAILED'); });
        await expect(cancelStartupAndRetry(deps)).rejects.toThrow('ENGINE_START_FAILED');
    });
});
