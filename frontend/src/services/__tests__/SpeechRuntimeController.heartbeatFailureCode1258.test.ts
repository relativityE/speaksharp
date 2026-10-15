// @vitest-environment jsdom
/**
 * #1258 (Codex P2 4265721146) — A HEARTBEAT OUTAGE IS RECORDED AS `heartbeat_failure`, WHATEVER THE NETWORK THREW.
 *
 * When `heartbeatSession()` keeps rejecting, the controller fails the take with the error it caught. A normal network
 * rejection (`TypeError: Failed to fetch`, a `TimeoutError`) carries no authored message, so it was classified by name
 * or fell through to `other` — the dedicated heartbeat category never fired for the most common heartbeat outage.
 * These run the REAL heartbeat loop (fake timers; only the heartbeat request is stubbed) and read the error the
 * controller fails the take with.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { heartbeatSession } from '../../lib/storage';
import { SpeechRuntimeController } from '../SpeechRuntimeController';
import { recordingFailureCode } from '../recordingFailureCode';

vi.mock('../../lib/logger', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../lib/storage', () => ({
    saveSession: vi.fn(),
    heartbeatSession: vi.fn(),
    completeSession: vi.fn(),
}));

type HeartbeatHarness = {
    startHeartbeat: (sessionId: string, service: { getState: () => string }) => void;
    stopHeartbeat: () => void;
    transition: (state: string, error?: unknown) => Promise<void>;
};

const harness = (): { c: HeartbeatHarness; failedWith: () => unknown } => {
    const c = Object.create(SpeechRuntimeController.prototype) as HeartbeatHarness & Record<string, unknown>;
    c.heartbeatVersion = 0;
    c.heartbeatInterval = null;
    c.HEARTBEAT_PERIOD_MS = 1_000;
    c.MAX_HEARTBEAT_FAILURES = 3;
    const transition = vi.fn(async (_state: string, _error?: unknown) => undefined);
    c.transition = transition;
    return { c, failedWith: () => transition.mock.calls.find((call) => call[0] === 'FAILED')?.[1] };
};

const recording = { getState: () => 'RECORDING' };

beforeEach(() => { vi.useFakeTimers(); vi.mocked(heartbeatSession).mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe('#1258 — heartbeat outages carry the heartbeat failure code', () => {
    it.each([
        ['a network TypeError', () => new TypeError('Failed to fetch')],
        ['a TimeoutError', () => Object.assign(new Error('signal timed out'), { name: 'TimeoutError' })],
        ['a generic Error', () => new Error('upstream 502')],
    ])('%s on every beat fails the take as heartbeat_failure, keeping the original error', async (_label, make) => {
        const thrown = make();
        vi.mocked(heartbeatSession).mockRejectedValue(thrown);
        const { c, failedWith } = harness();
        c.startHeartbeat('session-1', recording);
        for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(1_000);

        const error = failedWith();
        expect(error, 'the threshold failed the take').toBeDefined();
        expect(recordingFailureCode(error)).toBe('heartbeat_failure');
        expect(error, 'the same error object — its message still drives the status line').toBe(thrown);
        c.stopHeartbeat();
    });

    it('a non-Error rejection is still heartbeat_failure', async () => {
        vi.mocked(heartbeatSession).mockRejectedValue('offline');
        const { c, failedWith } = harness();
        c.startHeartbeat('session-1', recording);
        for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(1_000);
        expect(recordingFailureCode(failedWith())).toBe('heartbeat_failure');
        c.stopHeartbeat();
    });
});
