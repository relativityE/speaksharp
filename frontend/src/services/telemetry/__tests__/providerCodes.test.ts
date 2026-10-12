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
    providerCodeFields,
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
    attempt_2_reason: 'none', attempt_2_status: 200, attempt_2_ms: 9_812,
};

describe('provider code vocabularies match the Edge decoder', () => {
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
