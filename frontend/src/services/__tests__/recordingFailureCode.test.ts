/**
 * #1258 (PO 2026-10-12) — a recording that reaches FAILED says which failure, as a closed code. The alpha baseline and
 * the 2026-10-06 failure all reported `transition_cause: "Error"`, so a revoked lease, a refused save and an engine
 * error were indistinguishable. These pin the mapping, its coverage of every authored controller error, and that the
 * message never becomes telemetry.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectEventProps } from '@/services/telemetryAllowlist';
import { LEASE_NOT_HELD_MESSAGE, LEASE_UNCONFIRMED_MESSAGE } from '@/services/recordingLeasePolicy';
import { RECORDING_FAILURE_CODES, recordingFailureCode, withFailureCode } from '../recordingFailureCode';

const controllerSource = readFileSync(path.resolve(__dirname, '../SpeechRuntimeController.ts'), 'utf8');
const ECHO = 'echoed transcript words';

describe('recordingFailureCode — authored failures map to closed codes', () => {
    it('the stop-path save failures are told apart', () => {
        expect(recordingFailureCode(new Error(LEASE_NOT_HELD_MESSAGE))).toBe('lease_not_held');
        expect(recordingFailureCode(new Error(LEASE_UNCONFIRMED_MESSAGE))).toBe('lease_unconfirmed');
        expect(recordingFailureCode(new Error('Session save failed'))).toBe('session_save_failed');
        expect(recordingFailureCode(new Error('Usage limit exceeded: over the daily cap'))).toBe('usage_exceeded');
        expect(recordingFailureCode(new Error('SESSION_COMPLETION_FAILED'))).toBe('session_completion_failed');
        expect(recordingFailureCode(new Error('attestation failed (transient — retryable)'))).toBe('attestation_failed');
    });

    it('classes and browser names map by name; a finalize timeout is its own code', () => {
        const timeout = Object.assign(new Error('Finalization exceeded 30000ms'), { name: 'FinalizationTimeoutError' });
        expect(recordingFailureCode(timeout)).toBe('finalize_timeout');
        expect(recordingFailureCode(new DOMException('x', 'NotAllowedError'))).toBe('mic_not_allowed');
        expect(recordingFailureCode(new DOMException('x', 'AbortError'))).toBe('aborted');
    });

    it('an engine error is tagged at its source; an unknown error is `other`; no error is null', () => {
        expect(recordingFailureCode(withFailureCode(new Error(ECHO), 'engine_error'))).toBe('engine_error');
        expect(recordingFailureCode(new Error(ECHO))).toBe('other');
        expect(recordingFailureCode({ message: ECHO })).toBe('other');
        expect(recordingFailureCode(undefined)).toBeNull();
    });

    it('a variable suffix never changes the code, and the code never carries the message', () => {
        const code = recordingFailureCode(new Error(`RECORDING_START_GATE_CLOSED:${ECHO}`));
        expect(code).toBe('start_gate_closed');
        expect(RECORDING_FAILURE_CODES).toContain(code);
        expect(String(code)).not.toContain('echoed');
    });
});

describe('coverage — every authored controller error has a real code', () => {
    it('each literal UPPER_SNAKE error the controller raises maps to a code other than `other`', () => {
        const literals = [...controllerSource.matchAll(/new Error\(['`]([A-Z][A-Z0-9_]{3,})(:?)/g)].map((m) => m[1] + m[2]);
        expect(literals.length).toBeGreaterThan(8);
        const unmapped = [...new Set(literals)].filter((text) => recordingFailureCode(new Error(`${text}${text.endsWith(':') ? 'x' : ''}`)) === 'other');
        expect(unmapped).toEqual([]);
    });

    it('the engine-error path tags its error, and the transition names the code only for FAILED', () => {
        // #1258 (Codex P2 4265905975): the code comes from the engine's own error, not the display heuristic.
        expect(controllerSource).toMatch(/withFailureCode\(new Error\(displayMessage\), engineFailureCode\(error\)\)/);
        expect(controllerSource).toMatch(/newState === 'FAILED' \? recordingFailureCode\(error\) : null/);
    });
});

describe('the governed recording_state event', () => {
    it('carries a known code and drops free text in its place', () => {
        expect(projectEventProps('recording_state', { from_state: 'STOPPING', to_state: 'FAILED', failure_code: 'lease_not_held' }).dropped).toEqual([]);
        expect(projectEventProps('recording_state', { failure_code: ECHO }).dropped).toEqual(['failure_code']);
    });
});
