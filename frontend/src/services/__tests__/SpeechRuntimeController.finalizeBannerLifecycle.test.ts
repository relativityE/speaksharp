// @vitest-environment jsdom
/**
 * #1314 C6 — the "Finalizing your transcript…" banner must follow the controller lifecycle.
 *
 * Actual defect sequence (real-device run): the controller reached a resting/terminal state in ~4s
 * while the independently-managed `isTranscriptFinalizing` latch stayed true, so the banner remained
 * visible and the record control stayed disabled — a false "stuck session". The banner must clear
 * through the ONE transition reducer on every resting/terminal state; no path may leave it latched.
 *
 * These tests drive the REAL controller transition boundary (not an extracted helper). The 4-minute
 * safety timeout is out of scope and untouched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpeechRuntimeController } from '../SpeechRuntimeController';
import { useSessionStore } from '@/stores/useSessionStore';

vi.mock('../../lib/logger', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

type PrivateController = {
    transition: (state: string, error?: Error, token?: unknown) => Promise<void>;
    state: string;
    service: unknown;
    sessionId: string | null;
};

function priv(): PrivateController {
    return SpeechRuntimeController.getInstance() as unknown as PrivateController;
}

describe('#1314 C6 finalization banner lifecycle', () => {
    beforeEach(() => {
        useSessionStore.getState().resetSession?.();
        const c = priv();
        c.service = null;
        c.sessionId = null;
    });

    it.each(['READY', 'IDLE', 'TERMINATED', 'FAILED', 'FAILED_VISIBLE'])(
        'clears the finalization latch when the controller transitions to %s',
        async (terminal) => {
            const c = priv();
            c.state = 'STOPPING';
            useSessionStore.getState().setTranscriptFinalizing(true);
            expect(useSessionStore.getState().isTranscriptFinalizing).toBe(true);

            await c.transition(terminal);

            expect(useSessionStore.getState().isTranscriptFinalizing).toBe(false);
        },
    );

    it('keeps the banner during a genuinely pending finalization (STOPPING)', async () => {
        const c = priv();
        c.state = 'RECORDING';
        useSessionStore.getState().setTranscriptFinalizing(true);

        await c.transition('STOPPING');

        expect(useSessionStore.getState().isTranscriptFinalizing).toBe(true);
    });
});
