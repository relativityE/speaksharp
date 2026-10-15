// @vitest-environment jsdom
/**
 * #1258 (Codex P2 4265905975) — AN ENGINE FAILURE IS CLASSIFIED BY WHAT IT IS, NOT BY A SUBSTRING.
 *
 * `handleError` decided "microphone permission" with `/permission|not-allowed|service-not-allowed|microphone|mic/i`, so a
 * module-load failure ("Failed to fetch dynamically imported module" — the "mic" in "dynamically") was recorded as
 * `mic_permission`. It also rebuilt the error from its message, discarding a definitive browser name such as
 * `NotReadableError`. These drive the REAL `handleError` (only `transition` and the queue are stubbed) and read the
 * code the controller fails the take with. The on-screen message is out of scope and is asserted unchanged.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSessionStore } from '@/stores/useSessionStore';
import { SpeechRuntimeController } from '../SpeechRuntimeController';
import { recordingFailureCode } from '../recordingFailureCode';

vi.mock('../../lib/logger', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

type Harness = { handleError: (error: Error) => void };

const harness = (): { c: Harness; failedWith: () => unknown } => {
    const c = Object.create(SpeechRuntimeController.prototype) as Harness & Record<string, unknown>;
    c.serviceGeneration = 0;
    const transition = vi.fn(async (_state: string, _error?: unknown, _token?: unknown) => undefined);
    c.transition = transition;
    c.enqueue = (work: (token: { cancelled: boolean; version: number }) => Promise<void>) => work({ cancelled: false, version: 0 });
    return { c, failedWith: () => transition.mock.calls.find((call) => call[0] === 'FAILED')?.[1] };
};

const named = (name: string, message: string) => Object.assign(new Error(message), { name });

beforeEach(() => { useSessionStore.getState().setSTTStatus({ type: 'idle', message: '' }); });

describe('#1258 — engine failures carry their real code', () => {
    it.each([
        ['a module-load failure ("dynamically" contains "mic")', new TypeError('Failed to fetch dynamically imported module: /assets/x.js'), 'engine_error'],
        ['a generic engine message mentioning a microphone', new Error('Microphone track ended unexpectedly'), 'engine_error'],
        ['NotReadableError (device busy)', named('NotReadableError', 'Could not start audio source'), 'mic_not_readable'],
        ['NotAllowedError (permission denied)', named('NotAllowedError', 'Permission denied'), 'mic_not_allowed'],
        ['a Web Speech not-allowed error', new Error('not-allowed'), 'mic_permission'],
        ['a Web Speech service-not-allowed error', new Error('service-not-allowed'), 'mic_permission'],
        ['a permission message', new Error('Microphone permission denied by the user'), 'mic_permission'],
        ['an unrelated engine failure', new Error('worker crashed'), 'engine_error'],
    ])('%s → %s', async (_label, error, expected) => {
        const { c, failedWith } = harness();
        c.handleError(error);
        await Promise.resolve();
        expect(recordingFailureCode(failedWith())).toBe(expected);
    });
});
