/**
 * #1258 (PO 2026-10-12) — the coaching provider's decoded codes reach analytics, and nothing else does.
 * The client re-validates every field against the Edge vocabularies; parity with the Edge source is pinned here.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectEventProps } from '@/services/telemetryAllowlist';
import {
    PROVIDER_ATTEMPT_REASONS, PROVIDER_BLOCK_REASONS, PROVIDER_ERROR_INFO_REASONS, PROVIDER_ERROR_STATUSES, PROVIDER_FINISH_REASONS,
    COACHING_CANONICAL_ERROR_STRINGS, coachingErrorMessage, providerCodeFields,
} from '../providerCodes';

const EDGE_DIR = path.resolve(__dirname, '../../../../../backend/supabase/functions/get-ai-suggestions');
const edgeDecode = readFileSync(path.join(EDGE_DIR, 'providerDecode.ts'), 'utf8');
const edgeIndex = readFileSync(path.join(EDGE_DIR, 'index.ts'), 'utf8');
const edgeList = (name: string): string[] => {
    const m = edgeDecode.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const;`));
    if (!m) throw new Error(`${name} not found in providerDecode.ts`);
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
};

const ECHO = 'provider echoed secret words';
const decoded = {
    provider_error_status: 'RESOURCE_EXHAUSTED', provider_error_reason: 'RATE_LIMIT_EXCEEDED',
    provider_finish_reason: 'STOP', provider_block_reason: null,
    provider_prompt_tokens: 812, provider_output_tokens: 46, provider_thinking_tokens: 1903, provider_total_tokens: 2761,
    attempt_1_reason: 'provider_timeout', attempt_1_status: null, attempt_1_ms: 20_004,
    attempt_2_reason: 'provider_http_5xx', attempt_2_status: 503, attempt_2_ms: 1_204,
    // #1258 option A: the third attempt and the content-free retry facts.
    attempt_3_reason: 'none', attempt_3_status: 200, attempt_3_ms: 9_812,
    provider_wait_ms_total: 2_500, retry_after_present: true, retry_after_malformed: false, retry_after_s: 2,
    stopped_over_budget: false,
};

describe('provider code vocabularies match the Edge decoder', () => {
    it('#1742 fixed canonical display descriptions agree with the Edge catalog', () => {
        const block = edgeDecode.match(/const CANONICAL_ERROR_STRINGS = Object.freeze\(\{([\s\S]*?)\}\);/)?.[1];
        expect(block).toBeTruthy();
        const actual = Object.fromEntries([...block!.matchAll(/([A-Z_]+): '([^']+)'/g)].map(m => [m[1], m[2]]));
        expect(COACHING_CANONICAL_ERROR_STRINGS).toEqual(actual);
        expect(Object.keys(actual)).toEqual(edgeList('PROVIDER_ERROR_STATUSES'));
    });
    it('error statuses, finish and block reasons are the Edge lists plus the client fallbacks', () => {
        expect(PROVIDER_ERROR_STATUSES).toEqual([...edgeList('PROVIDER_ERROR_STATUSES'), 'other', 'unparseable']);
        expect(PROVIDER_FINISH_REASONS).toEqual([...edgeList('PROVIDER_FINISH_REASONS'), 'other']);
        expect(PROVIDER_BLOCK_REASONS).toEqual([...edgeList('PROVIDER_BLOCK_REASONS'), 'other']);
        expect(PROVIDER_ERROR_INFO_REASONS).toEqual([...edgeList('PROVIDER_ERROR_INFO_REASONS'), 'other']);
    });
    it('every attempt reason is `none` or one of the Edge CoachingFailureReason members', () => {
        const union = edgeIndex.match(/export type CoachingFailureReason =([\s\S]*?);/)?.[1] ?? '';
        const edgeReasons = [...union.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
        expect(edgeReasons.length).toBeGreaterThan(5);
        expect([...PROVIDER_ATTEMPT_REASONS]).toEqual(['none', ...edgeReasons]);
    });
});

describe('#1742 closed coaching display provenance', () => {
    const provider = (http: number, canonical = 'RESOURCE_EXHAUSTED') => ({
        status: 502, reason: http >= 500 ? 'provider_http_5xx' : 'provider_http_4xx',
        provider_status: http, provider_error_status: canonical,
        error_descriptor: { origin: 'provider', http_status: http, canonical_status: canonical, local_code: null },
    });
    it('separates credit depletion, rate limits and provider availability from the outer 502', () => {
        for (const [http, canonical, expected] of [
            [402, 'RESOURCE_EXHAUSTED', 'RESOURCE_EXHAUSTED: The service credit balance is depleted.'],
            [429, 'RESOURCE_EXHAUSTED', 'RESOURCE_EXHAUSTED: The service rate limit was exceeded.'],
            [503, 'UNAVAILABLE', 'UNAVAILABLE: The service is temporarily unavailable.'],
            [500, 'UNKNOWN', 'UNKNOWN: Unknown error.'],
        ] as const) {
            const server = provider(http, canonical);
            expect(coachingErrorMessage(server, server.reason, 502)).toBe(expected);
        }
    });
    it('keeps local normalization and timeout distinct from observed Google UNKNOWN', () => {
        expect(coachingErrorMessage({ status: 502, reason: 'provider_http_5xx', provider_status: 503,
            provider_error_status: 'unparseable', error_descriptor: { origin: 'local_normalization',
                http_status: 503, canonical_status: 'UNKNOWN', local_code: 'provider_http_5xx' } }, 'provider_http_5xx', 502)).toBe('UNKNOWN (local normalization): Unknown error.');
        expect(coachingErrorMessage({ status: 502, reason: 'provider_timeout', provider_status: null, provider_error_status: null, error_descriptor: {
            origin: 'local_timeout', http_status: null, canonical_status: null, local_code: 'provider_timeout',
        } }, 'provider_timeout', 502)).toBe('provider_timeout: The local coaching deadline was exceeded.');
    });
    it('refuses local-normalized HTTP-class contradictions instead of treating an HTTP200 as a5xx', () => {
        for (const [wireCode, http] of [['provider_http_5xx', 200], ['provider_http_4xx', 503],
            ['provider_http_5xx', 429], ['provider_http_4xx', null]] as const) {
            expect(coachingErrorMessage({ status: 502, reason: wireCode, provider_status: http,
                provider_error_status: 'unparseable', error_descriptor: { origin: 'local_normalization',
                    http_status: http, canonical_status: 'UNKNOWN', local_code: wireCode } }, wireCode, 502)).toBeNull();
        }
    });
    it.each(['200', Number.NaN, 0, 700, undefined])('refuses malformed timeout scalar status %s before selecting prose', (provider_status) => {
        expect(coachingErrorMessage({ status: 502, reason: 'provider_timeout', provider_status, provider_error_status: null,
            error_descriptor: { origin: 'local_timeout', http_status: null, canonical_status: null, local_code: 'provider_timeout' },
        }, 'provider_timeout', 502)).toBeNull();
    });
    it('refuses echoed timeout error-status scalars but preserves a genuine timeout after HTTP200 headers', () => {
        const server = { status: 502, reason: 'provider_timeout', provider_status: 200, provider_error_status: ECHO,
            error_descriptor: { origin: 'local_timeout', http_status: null, canonical_status: null, local_code: 'provider_timeout' } };
        expect(coachingErrorMessage(server, 'provider_timeout', 502)).toBeNull();
        expect(coachingErrorMessage({ ...server, provider_error_status: null }, 'provider_timeout', 502))
            .toBe('provider_timeout: The local coaching deadline was exceeded.');
    });
    it('rejects mismatched wire codes, scalar diagnostics, origins, extra keys and echoed prose', () => {
        const good = provider(503, 'UNAVAILABLE');
        for (const server of [
            { ...good, provider_status: 429 }, { ...good, provider_error_status: 'UNKNOWN' },
            { ...good, reason: ECHO }, { ...good, error_descriptor: { ...good.error_descriptor, origin: ECHO } },
            { ...good, error_descriptor: { ...good.error_descriptor, canonical_status: ECHO } },
            { ...good, error_descriptor: { ...good.error_descriptor, message: ECHO } },
            { ...good, error_descriptor: { ...good.error_descriptor, local_code: '__proto__' } },
        ]) expect(coachingErrorMessage(server, 'provider_http_5xx', 502)).toBeNull();
        for (const outer of [401, 403, 404, 409, 429, 503, null]) {
            expect(coachingErrorMessage(good, good.reason, outer)).toBeNull();
        }
        expect(coachingErrorMessage(good, ECHO, 502)).toBeNull();
        expect(coachingErrorMessage(null, ECHO, 502)).toBeNull();
    });
});

describe('providerCodeFields — re-validates, never forwards free text', () => {
    it('keeps a fully decoded diagnostic', () => {
        expect(providerCodeFields(decoded)).toEqual(decoded);
    });
    it('nulls anything outside its vocabulary or range', () => {
        const fields = providerCodeFields({
            provider_error_status: ECHO, provider_error_reason: ECHO, provider_finish_reason: 'stop',
            provider_thinking_tokens: -1, provider_prompt_tokens: 1.5, attempt_1_reason: ECHO, attempt_1_status: 42, attempt_1_ms: 700_000,
        });
        expect(Object.values(fields).every((v) => v === null)).toBe(true);
        expect(JSON.stringify(fields)).not.toContain(ECHO);
    });
    it('#1258 option A: retry facts outside their type or range are null — never forwarded', () => {
        const fields = providerCodeFields({
            attempt_3_reason: 'request_cancelled', attempt_3_status: 700, provider_wait_ms_total: -1,
            retry_after_present: 'yes', retry_after_malformed: 1, retry_after_s: 61, stopped_over_budget: ECHO,
        });
        expect(fields.attempt_3_reason).toBe('request_cancelled');
        expect([fields.attempt_3_status, fields.provider_wait_ms_total, fields.retry_after_present, fields.retry_after_malformed,
            fields.retry_after_s, fields.stopped_over_budget]).toEqual([null, null, null, null, null, null]);
        expect(JSON.stringify(fields)).not.toContain(ECHO);
    });
    it('a missing server diagnostic yields all-null fields', () => {
        expect(Object.values(providerCodeFields(null)).every((v) => v === null)).toBe(true);
    });
});

describe('the governed ai_coaching_diagnostic event carries the codes', () => {
    it('every decoded field passes the allowlist, and an echoed message would be dropped', () => {
        const projected = projectEventProps('ai_coaching_diagnostic', { ...decoded, provider_error_message: ECHO });
        expect(projected.props).toMatchObject(Object.fromEntries(Object.entries(decoded).filter(([, v]) => v !== null)));
        expect(projected.dropped).toEqual(['provider_error_message']);
    });
    it('an error reason outside the closed list is dropped, including an UPPER_SNAKE content-shaped token (PM 6134462030)', () => {
        for (const value of [ECHO, 'SECRET_TRANSCRIPT_WORDS']) {
            expect(projectEventProps('ai_coaching_diagnostic', { provider_error_reason: value }).dropped).toEqual(['provider_error_reason']);
            expect(providerCodeFields({ provider_error_reason: value }).provider_error_reason).toBeNull();
        }
    });
});
