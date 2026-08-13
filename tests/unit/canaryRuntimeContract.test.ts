// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    classifyCanaryStartResponse,
    sanitizeCanaryDenialCategory,
} from '../canary/canaryRuntimeContract';

describe('production canary authoritative start contract', () => {
    it('surfaces the exact sanitized private_sample_used denial before UI assertions', () => {
        expect(classifyCanaryStartResponse(200, {
            error: 'private_sample_used',
            new_session: null,
            usage_exceeded: true,
        })).toEqual({ ok: false, category: 'private_sample_used' });
    });

    it('never reflects arbitrary response text and fails closed on malformed/HTTP responses', () => {
        expect(sanitizeCanaryDenialCategory('customer email: secret@example.test')).toBe('unknown');
        expect(classifyCanaryStartResponse(503, null)).toEqual({ ok: false, category: 'rpc_http_503' });
        expect(classifyCanaryStartResponse(200, null)).toEqual({ ok: false, category: 'rpc_invalid_response' });
        expect(classifyCanaryStartResponse(200, { usage_exceeded: false, new_session: null }))
            .toEqual({ ok: false, category: 'rpc_missing_session' });
    });

    it('accepts only a successful response with a durable session identity', () => {
        expect(classifyCanaryStartResponse(200, {
            usage_exceeded: false,
            new_session: { id: 'session-1' },
        })).toEqual({ ok: true, sessionId: 'session-1' });
    });

    it('locks runtime RECORDING, during-state, exact Private authority, and current stop control', () => {
        const smoke = readFileSync('tests/canary/smoke.canary.spec.ts', 'utf8');
        expect(smoke).toContain('CANARY_START_DENIED:');
        expect(smoke).toContain('html[data-runtime-state="RECORDING"][data-stt-resolved-mode="private"]');
        expect(smoke).toContain('[data-testid="session-shell"][data-session-state="during"]');
        expect(smoke).toContain('body[data-stt-policy="private"]');
        expect(smoke).toContain('[data-testid="live-session-header"][data-engine="private"][data-recording="true"]');
        expect(smoke).toContain("getByTestId('recorder-stop')");
        expect(smoke).not.toContain('data-engine="browser"');
        expect(smoke).not.toContain('data-engine="cloud"');
        expect(smoke).not.toContain('data-engine="native"');
    });
});
