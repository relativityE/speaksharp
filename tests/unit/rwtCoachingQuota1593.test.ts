// @vitest-environment node
/**
 * #1593 (PO via Sam 19:40) — PROVIDER QUOTA IS A COMPLETED, QUOTA-LIMITED ATTEMPT, NEVER A PASS.
 *
 * A request-bound provider 429 with its decoded quota code (RESOURCE_EXHAUSTED) and a known provider attempt count within
 * the Edge cap, handled gracefully by the app, is EXTERNAL `provider_quota`: the journey completed its quota handling and
 * the generated-AI output is UNVERIFIED. The product's own per-user limit (Edge `quota_exceeded`) is a different,
 * product-owned outcome and never qualifies. Every missing or malformed piece proves nothing.
 */
import { describe, expect, it } from 'vitest';
import {
    coachingParentVerdict, provenExternalOutcome, providerAttemptsFrom, providerQuotaCodeFrom, takeExchangeEvidence,
    type CoachingFailureEvidence, type GracefulDegradation,
} from '../live/helpers/coachingExternal';
import type { CoachingExchange } from '../live/helpers/coachingGenerationTap';
import { externalParentProofGaps, requiredAutomatedRows, validateReceipt, type ReceiptRow } from '../live/helpers/rwtAcceptance';

const graceful: GracefulDegradation = {
    savedTakeProven: true, reviewState: 'error', unavailableShown: true, retryEnabled: true, requestBoundToSession: true,
};
const QUOTA: CoachingFailureEvidence = {
    httpStatus: 502, reason: 'provider_http_4xx', providerStatus: 429, providerErrorStatus: 'RESOURCE_EXHAUSTED', providerAttempts: 3,
};

describe('provenExternalOutcome — provider quota is proved only by the 429, its quota code AND a known attempt count', () => {
    it('POSITIVE: a provider 429 RESOURCE_EXHAUSTED after a known 1–3 attempts → provider_quota', () => {
        for (const providerAttempts of [1, 2, 3]) expect(provenExternalOutcome({ ...QUOTA, providerAttempts })).toBe('provider_quota');
    });
    it.each([
        ['not an Edge 502', { httpStatus: 429 }],
        ['the product\'s OWN quota (Edge quota_exceeded), never the provider\'s', { httpStatus: 429, reason: 'quota_exceeded', providerStatus: null }],
        ['another 4xx', { providerStatus: 400 }],
        ['a 429 without the decoded quota code', { providerErrorStatus: null }],
        ['a 429 with no recorded attempt count (unknown provider cost)', { providerAttempts: null }],
        ['an attempt count of 0', { providerAttempts: 0 }],
        ['an attempt count beyond the Edge cap', { providerAttempts: 4 }],
        ['a fractional attempt count', { providerAttempts: 1.5 }],
        ['a 429 reported as a 5xx', { reason: 'provider_http_5xx' }],
    ] as const)('NEGATIVE: %s → no proof', (_label, change) => {
        expect(provenExternalOutcome({ ...QUOTA, ...change } as CoachingFailureEvidence)).toBeNull();
    });
});

describe('the closed readers keep only the quota code and an attempt count within the cap', () => {
    it('provider_error_status is kept only as RESOURCE_EXHAUSTED', () => {
        expect(providerQuotaCodeFrom({ diagnostics: { provider_error_status: 'RESOURCE_EXHAUSTED' } })).toBe('RESOURCE_EXHAUSTED');
        for (const value of ['UNAVAILABLE', 'resource_exhausted', 'Quota exceeded for project x', 7, null, undefined]) {
            expect(providerQuotaCodeFrom({ diagnostics: { provider_error_status: value } })).toBeNull();
        }
        expect(providerQuotaCodeFrom(null)).toBeNull();
    });
    it('provider_attempts is kept only as an integer from 1 to the cap', () => {
        expect(providerAttemptsFrom({ diagnostics: { provider_attempts: 2 } })).toBe(2);
        for (const value of [0, 4, -1, 2.5, '3', null, undefined]) expect(providerAttemptsFrom({ diagnostics: { provider_attempts: value } })).toBeNull();
    });
});

describe('the take\'s unique exchange carries the quota evidence, request-bound', () => {
    const exchange = (diagnostics: Record<string, unknown>): CoachingExchange => ({
        sent: { requestId: 'req-1', attemptId: 'att-1', clientAttempt: 1 }, status: 502, diagnostics, suggestions: null, clientMs: 10, at: 1, outcome: 'answered',
    } as unknown as CoachingExchange);
    it('a single answered 502 with the quota diagnostics proves provider_quota', () => {
        const take = takeExchangeEvidence([exchange({ reason: 'provider_http_4xx', provider_status: 429, provider_error_status: 'RESOURCE_EXHAUSTED', provider_attempts: 3, request_id: 'req-1' })]);
        expect(take.unique).toBe(true);
        expect(take.evidence).toMatchObject({ providerErrorStatus: 'RESOURCE_EXHAUSTED', providerAttempts: 3 });
        expect(provenExternalOutcome(take.evidence)).toBe('provider_quota');
    });
    it('an echo naming another request proves nothing, quota or not', () => {
        const take = takeExchangeEvidence([exchange({ reason: 'provider_http_4xx', provider_status: 429, provider_error_status: 'RESOURCE_EXHAUSTED', provider_attempts: 3, request_id: 'req-OTHER' })]);
        expect(take.unique).toBe(false);
        expect(provenExternalOutcome(take.evidence)).toBeNull();
    });
});

describe('the parent verdict: completed — quota-limited, AI output unverified, never PASS', () => {
    it('quota + graceful app → EXTERNAL provider_quota, named "completed — quota-limited" and unverified', () => {
        const v = coachingParentVerdict({ rendered: false, evidence: QUOTA, graceful });
        expect(v).toMatchObject({ verdict: 'EXTERNAL', external: 'provider_quota' });
        expect(v.detail).toMatch(/completed — quota-limited.*429 RESOURCE_EXHAUSTED after 3 attempt\(s\).*UNVERIFIED, not passed/);
    });
    it('quota with broken app handling is still the app\'s FAIL', () => {
        for (const broken of [{ savedTakeProven: false }, { retryEnabled: false }, { unavailableShown: false }, { reviewState: 'loading' }]) {
            expect(coachingParentVerdict({ rendered: false, evidence: QUOTA, graceful: { ...graceful, ...broken } }).verdict).toBe('FAIL');
        }
    });
});

describe('the receipt validator recognizes a proved provider_quota parent, and refuses every malformed one', () => {
    const SHA = 'a'.repeat(40);
    const pass = (step: string): ReceiptRow => ({ step, verdict: 'PASS', detail: 'ok' });
    const QUOTA_PARENT_EVIDENCE = Object.freeze({
        reviewState: 'error', httpStatus: 502, failureReason: 'provider_http_4xx', providerStatus: 429, providerErrorStatus: 'RESOURCE_EXHAUSTED',
        providerAttempts: 3, takeExchangeUnique: true, externalOutcome: 'provider_quota', savedTakeProven: true, unavailableShown: true, retryEnabled: true,
    });
    const quotaParent = (evidence: Record<string, unknown> = {}): ReceiptRow => ({
        step: 'coaching rendered', verdict: 'EXTERNAL', detail: 'completed — quota-limited', evidence: { ...QUOTA_PARENT_EVIDENCE, ...evidence } as ReceiptRow['evidence'],
    });
    const openMic = (rows: ReceiptRow[]) => {
        const base: ReceiptRow[] = [
            { step: 'journey telemetry received', verdict: 'HOLD', detail: 'p' }, { step: 'signup-stage telemetry received', verdict: 'HOLD', detail: 'p' },
            pass('telemetry decodable'), pass('signup-stage telemetry (user class)'), pass('journey telemetry (canary class)'), pass('receipt content-free'),
            ...requiredAutomatedRows('open-mic-first-session')!.product.map((s) => (s === 'base_q4 primary' ? { step: s, verdict: 'HOLD' as const, detail: 'p' } : pass(s))),
        ];
        return { suite: 'open-mic-first-session', release: SHA, meta: { fixtureKind: 'synthetic' },
            rows: [...base.filter((b) => !rows.some((r) => r.step === b.step)), ...rows],
            readback: { journeys: [{ journeyId: 'j', stages: ['session_during'] }], reportedJourneyIds: [], missingBindings: [] } };
    };
    const quotaErrors = (row: ReceiptRow) => validateReceipt(openMic([row])).errors.filter((e) => e.includes('coaching rendered')).join(' | ');

    it('POSITIVE: the proved quota parent validates', () => {
        expect(externalParentProofGaps(quotaParent())).toEqual([]);
        expect(quotaErrors(quotaParent())).toBe('');
    });
    it.each([
        ['failureReason', 'provider_http_5xx', /failureReason is not provider_http_4xx/],
        ['providerStatus', 503, /providerStatus is not 429/],
        ['providerErrorStatus', null, /providerErrorStatus is not RESOURCE_EXHAUSTED/],
        ['providerAttempts', null, /providerAttempts is not a known count/],
        ['providerAttempts', 4, /providerAttempts is not a known count/],
        ['httpStatus', 429, /httpStatus is not 502/],
        ['takeExchangeUnique', false, /take exchange is not unique/],
        ['savedTakeProven', false, /saved take is not proven/],
    ] as const)('NEGATIVE: %s=%s is refused', (key, value, message) => {
        expect(externalParentProofGaps(quotaParent({ [key]: value })).join(' | ')).toMatch(message);
        expect(quotaErrors(quotaParent({ [key]: value }))).toMatch(/is EXTERNAL without its proof/);
    });
});
