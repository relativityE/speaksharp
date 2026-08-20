// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    classifyCanaryStartResponse,
    classifyCanaryUsageEntitlement,
    sanitizeCanaryDenialCategory,
} from '../canary/canaryRuntimeContract';

describe('production canary authoritative start contract', () => {
    it('sanitizes every advisory entitlement denial before emitting it to CI', () => {
        expect(classifyCanaryUsageEntitlement({
            subscription_status: 'pro', is_pro: true, can_start: false, error: 'trial_expired',
        }, 'active-trial')).toEqual({ ok: false, category: 'trial_expired' });
        for (const error of [
            'customer@example.test',
            'database said: permission denied',
            'punctuation-bearing-message!',
        ]) {
            expect(classifyCanaryUsageEntitlement({
                subscription_status: 'pro', is_pro: true, can_start: false, error,
            }, 'active-trial')).toEqual({ ok: false, category: 'unknown' });
        }
    });

    it('fails closed on non-Pro advisory entitlement fields', () => {
        expect(classifyCanaryUsageEntitlement({ subscription_status: 'free', is_pro: false, can_start: true }, 'active-trial'))
            .toEqual({ ok: false, category: 'subscription_status' });
        expect(classifyCanaryUsageEntitlement({ subscription_status: 'pro', is_pro: false, can_start: true }, 'active-trial'))
            .toEqual({ ok: false, category: 'is_pro' });
        expect(classifyCanaryUsageEntitlement({
            subscription_status: 'pro', is_pro: true, can_start: true,
            trial_active: true, trial_expires_at: '2026-09-01T00:00:00Z',
        }, 'active-trial'))
            .toEqual({ ok: true });
        expect(classifyCanaryUsageEntitlement({
            subscription_status: 'pro', is_pro: true, can_start: true,
            trial_active: false, trial_expires_at: null,
        }, 'paid-continuation')).toEqual({ ok: true });
        expect(classifyCanaryUsageEntitlement({
            subscription_status: 'pro', is_pro: true, can_start: true,
            trial_active: false, trial_expires_at: null,
        }, 'active-trial')).toEqual({ ok: false, category: 'trial_inactive' });
        expect(classifyCanaryUsageEntitlement({
            subscription_status: 'pro', is_pro: true, can_start: true,
            trial_active: true, trial_expires_at: '2026-09-01T00:00:00Z',
        }, 'paid-continuation')).toEqual({ ok: false, category: 'paid_marked_trial' });
    });

    it('surfaces an exact sanitized server denial before UI assertions', () => {
        expect(classifyCanaryStartResponse(200, {
            error: 'trial_expired',
            new_session: null,
            usage_exceeded: true,
        })).toEqual({ ok: false, category: 'trial_expired' });
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
        expect(smoke).toContain('CANARY_ENTITLEMENT_DENIED:');
        expect(smoke).toContain('classifyCanaryUsageEntitlement(u, CANARY_USER.lane)');
        expect(smoke).toContain("if (CANARY_USER.lane === 'paid-continuation')");
        expect(smoke).toContain("page.getByTestId(TEST_IDS.PRO_BADGE)).toHaveCount(0)");
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
