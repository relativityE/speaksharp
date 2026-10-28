// @vitest-environment node
/**
 * #1593 Case 15 follow-up (Sam 1792503928.955419, run 39431939529 on 724c2e9d) — AN UNUSABLE ENTITLEMENT ANSWER IS
 * "UNVERIFIED", NEVER "CANNOT START".
 *
 * Case 15 reported canStart/trialActive/isPro all false before the fixture's 15:30 UTC boundary. At 724c2e9d the tap
 * accepted any `check-usage-limit` JSON without its status, dropped a body that failed to parse, and the rows serialised
 * each field with `=== true`, so an error body, a non-object body or a missing field read exactly like an explicit
 * `false`. These controls hold the tap, the classifier and both receipt rows to the distinction; explicit `false` stays a
 * HOLD for the returning journey and a FAIL for a new account, as before.
 */
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { Page } from '@playwright/test';
import { EntitlementTap, entitlementRow, observeEntitlement, returningAccessRow, type EntitlementResponse } from '../live/helpers/rwtJourney';

type Row = { step: string; verdict: string; detail: string; evidence?: Record<string, unknown> };
const sink = () => {
    const rows: Row[] = [];
    return { rows, row: (step: string, verdict: string, detail: string, evidence?: Record<string, unknown>) => { rows.push({ step, verdict, detail, evidence }); } };
};

/** A page that delivers one `check-usage-limit` response with `status` and a body (or a body that fails to parse). */
function tapWith(status: number, body: unknown | Error): EntitlementTap {
    const page = new EventEmitter();
    const tap = new EntitlementTap();
    tap.attach(page as unknown as Page);
    page.emit('response', {
        url: () => 'https://project.supabase.co/functions/v1/check-usage-limit',
        status: () => status,
        json: () => (body instanceof Error ? Promise.reject(body) : Promise.resolve(body)),
    });
    return tap;
}

const TRIAL_OK = { can_start: true, trial_active: true, is_pro: false, trial_seconds_remaining: 3_600 };

describe('#1593 EntitlementTap keeps what the page actually received', () => {
    it('CASUALTY: a 503 whose body does not parse is recorded as unusable, not dropped', async () => {
        const tap = tapWith(503, new SyntaxError('Unexpected token <'));
        await tap.settle();
        expect(tap.responses).toEqual([{ http: 503, parsed: false }]);
    });

    it('CASUALTY: an error JSON body keeps its status; a null or array body is not an object', async () => {
        for (const [status, body] of [[500, { error: 'boom' }], [200, null], [200, [TRIAL_OK]]] as const) {
            const tap = tapWith(status, body);
            await tap.settle();
            expect(tap.responses[0]).toMatchObject({ http: status, parsed: status === 500 });
        }
    });
});

describe('#1593 observeEntitlement: only a 2xx object with a boolean can_start is an observation', () => {
    const cases: Array<[string, EntitlementResponse | undefined, ReturnType<typeof observeEntitlement>]> = [
        ['no response', undefined, { state: 'unobserved' }],
        ['HTTP 503', { http: 503, parsed: false }, { state: 'unavailable', reason: 'http_503' }],
        ['HTTP 500 with a JSON error body', { http: 500, parsed: true }, { state: 'unavailable', reason: 'http_500' }],
        ['non-object body', { http: 200, parsed: false }, { state: 'unavailable', reason: 'body_not_json_object' }],
        ['missing can_start', { http: 200, parsed: true }, { state: 'unavailable', reason: 'can_start_undefined' }],
        ['null can_start', { http: 200, parsed: true, can_start: null }, { state: 'unavailable', reason: 'can_start_null' }],
        ['string can_start', { http: 200, parsed: true, can_start: 'true' }, { state: 'unavailable', reason: 'can_start_string' }],
        ['explicit false', { http: 200, parsed: true, can_start: false, trial_active: false, is_pro: false },
            { state: 'observed', canStart: false, trialActive: false, isPro: false }],
        ['explicit true, unknown trial flag', { http: 200, parsed: true, can_start: true, is_pro: true },
            { state: 'observed', canStart: true, trialActive: null, isPro: true }],
    ];
    it.each(cases)('%s', (_label, response, expected) => {
        expect(observeEntitlement(response)).toEqual(expected);
    });
});

describe('#1593 Case 15 returning-user access row', () => {
    it('CASUALTY: an unusable answer is HOLD "eligibility unverified" with null evidence — never reported as false', async () => {
        const r = sink();
        await returningAccessRow(r, tapWith(503, new SyntaxError('bad')));
        expect(r.rows).toEqual([{
            step: 'returning-user access', verdict: 'HOLD',
            detail: 'eligibility unverified: the check-usage-limit response was unusable (http_503)',
            evidence: { entitlement: 'unavailable', canStart: null, trialActive: null, isPro: null, reason: 'http_503' },
        }]);
    });

    it('CONTROL: an explicit can_start false stays the "cannot start" HOLD, with observed false evidence', async () => {
        const r = sink();
        await returningAccessRow(r, tapWith(200, { can_start: false, trial_active: false, is_pro: false }));
        expect(r.rows[0]).toMatchObject({ verdict: 'HOLD', evidence: { entitlement: 'observed', canStart: false, trialActive: false, isPro: false } });
        expect(r.rows[0].detail).toMatch(/cannot start a recording/);
    });

    it('CONTROL: an explicit can_start true is PASS; no response at all is the existing HOLD', async () => {
        const ok = sink();
        await returningAccessRow(ok, tapWith(200, TRIAL_OK));
        expect(ok.rows[0]).toMatchObject({ verdict: 'PASS', evidence: { canStart: true, trialActive: true, isPro: false } });
        const none = sink();
        const tap = new EntitlementTap();
        tap.attach(new EventEmitter() as unknown as Page);
        await returningAccessRow(none, tap);
        expect(none.rows[0]).toMatchObject({ verdict: 'HOLD', detail: 'no check-usage-limit response was observed' });
    });
});

describe('#1593 EntitlementTap keeps the order the page RECEIVED responses (Codex P2 r4342116414)', () => {
    it('CASUALTY: a slow-parsing valid first response stays first when a later response fails to parse sooner', async () => {
        const page = new EventEmitter();
        const tap = new EntitlementTap();
        tap.attach(page as unknown as Page);
        let releaseFirst: (body: unknown) => void = () => undefined;
        const firstBody = new Promise<unknown>((resolve) => { releaseFirst = resolve; });
        const response = (status: number, json: () => Promise<unknown>) =>
            ({ url: () => 'https://project.supabase.co/functions/v1/check-usage-limit', status: () => status, json });
        page.emit('response', response(200, () => firstBody));
        page.emit('response', response(503, () => Promise.reject(new SyntaxError('Unexpected token <'))));
        await Promise.resolve();
        releaseFirst(TRIAL_OK);
        const r = sink();
        await returningAccessRow(r, tap);
        expect(tap.responses.map((x) => x.http)).toEqual([200, 503]);
        expect(r.rows[0]).toMatchObject({ verdict: 'PASS', evidence: { canStart: true } });
    });
});

describe('#1593 new-account entitlement row (shared by the recording journeys)', () => {
    const receiptOf = (r: ReturnType<typeof sink>) => r as unknown as Parameters<typeof entitlementRow>[0];

    it('CASUALTY: an unusable answer is HOLD "entitlement unverified", not FAIL "did not entitle"', async () => {
        for (const [status, body] of [[503, new SyntaxError('bad')], [200, { error: 'missing fields' }]] as const) {
            const r = sink();
            await entitlementRow(receiptOf(r), tapWith(status, body), 120);
            expect(r.rows[0]).toMatchObject({ step: 'new-account entitlement', verdict: 'HOLD', evidence: { entitlement: 'unavailable', canStart: null } });
        }
    });

    it('CONTROL: an observed refusal is still FAIL, and an entitled trial with headroom is PASS', async () => {
        const refused = sink();
        await entitlementRow(receiptOf(refused), tapWith(200, { can_start: false, trial_active: false, is_pro: false }), 120);
        expect(refused.rows[0]).toMatchObject({ verdict: 'FAIL', evidence: { entitlement: 'observed', canStart: false } });
        const ok = sink();
        await entitlementRow(receiptOf(ok), tapWith(200, TRIAL_OK), 120);
        expect(ok.rows[0]).toMatchObject({ verdict: 'PASS', evidence: { canStart: true, trialActive: true } });
    });
});
