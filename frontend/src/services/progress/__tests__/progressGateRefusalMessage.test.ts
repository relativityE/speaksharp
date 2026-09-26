import { describe, it, expect } from 'vitest';
import { isProgressGateRefusalMessage, startGateMessage } from '../progressStartGate';

/**
 * Canary 36142201470 — only the Progress gate's OWN refusal copy may be cleared from the recorder status when the gate is
 * published or clears. Any other error keeps its message.
 */
describe('isProgressGateRefusalMessage', () => {
    it('recognises every refusal the Progress gate produces', () => {
        for (const verdict of [
            { allowed: false, reason: 'in_flight', sessionId: 's' },
            { allowed: false, reason: 'queued_debt', sessionId: 's' },
            { allowed: false, reason: 'unresolved_evidence', sessionId: 's' },
            { allowed: false, reason: 'queue_unreadable', failure: 'corrupt' },
        ] as const) {
            expect(isProgressGateRefusalMessage(startGateMessage(verdict))).toBe(true);
        }
    });

    it('never claims another message', () => {
        for (const other of [
            'Checking your saved sessions is taking longer than usual. Press Start again in a moment.',
            'Finish saving your previous recording before starting a new one.',
            'Microphone permission was denied.',
            'Recording is unavailable right now.',
            '',
            null,
            undefined,
        ]) {
            expect(isProgressGateRefusalMessage(other)).toBe(false);
        }
    });
});
