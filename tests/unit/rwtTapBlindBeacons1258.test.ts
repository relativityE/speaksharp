// @vitest-environment node
/**
 * #1258 (RWT run 37514078995, F2) — the sent-side tap reported `feedback_submit` and `session_pdf_downloaded` as never
 * sent, while PostHog received both. posthog-js flushes its queue on page-hide with `sendBeacon(url, new Blob([body]))`,
 * and Chromium exposes no body for a Blob beacon, so the tap silently dropped those requests and the receipt FAILED
 * "sent" rows for events that did leave the page. A blind request is now counted, and an event missing while requests
 * were blind is missing evidence (HOLD — the received readback decides), never an observed failure.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AnalyticsTap, RwtReceipt, exactCountVerdict, sentDetail, sentVerdict, telemetryClassRows } from '../live/helpers/rwtJourney';

type Handler = (request: unknown) => void;
const fakePage = () => {
    const handlers: Handler[] = [];
    return {
        page: { on: (event: string, handler: Handler) => { if (event === 'request') handlers.push(handler); } },
        fire: (request: unknown) => handlers.forEach((h) => h(request)),
    };
};
const request = (url: string, method: string, body: string | null) => ({
    url: () => url,
    method: () => method,
    postDataBuffer: () => (body === null ? null : Buffer.from(body, 'utf8')),
});
const batch = (...events: string[]) => JSON.stringify(events.map((event) => ({ event, properties: { traffic_type: 'canary' } })));

describe('AnalyticsTap — a PostHog body the browser hides is counted, never silently dropped', () => {
    it('CASUALTY: a Blob beacon (POST, no exposed body) is a blind beacon; readable batches still decode', () => {
        const { page, fire } = fakePage();
        const tap = new AnalyticsTap();
        tap.attach(page as never);
        fire(request('https://us.i.posthog.com/e/?ip=0', 'POST', batch('session_saved')));
        fire(request('https://us.i.posthog.com/e/?ip=0&beacon=1', 'POST', null));
        fire(request('https://us.i.posthog.com/e/?ip=0&beacon=1', 'POST', ''));
        expect({ events: tap.events.map((e) => e.event), blind: tap.blindBeacons, undecodable: tap.undecodable })
            .toEqual({ events: ['session_saved'], blind: 2, undecodable: 0 });
    });
    it('a GET to PostHog (flags/config) is not a blind beacon, and non-PostHog hosts are ignored', () => {
        const { page, fire } = fakePage();
        const tap = new AnalyticsTap();
        tap.attach(page as never);
        fire(request('https://us.i.posthog.com/flags/?v=2', 'GET', null));
        fire(request('https://example.com/e/', 'POST', null));
        expect({ blind: tap.blindBeacons, events: tap.events.length }).toEqual({ blind: 0, events: 0 });
    });
});

describe('telemetry decodable — never claims bodies the browser did not expose (Codex r4199883459)', () => {
    const decodable = (fires: Array<ReturnType<typeof request>>) => {
        const { page, fire } = fakePage();
        const t = new AnalyticsTap();
        t.attach(page as never);
        fires.forEach(fire);
        const receipt = new RwtReceipt('unit');
        telemetryClassRows(receipt, t, false);
        return receipt.rows.find((r) => r.step === 'telemetry decodable')!;
    };
    it('CASUALTY: one readable event + one blind beacon cannot yield the absolute "every analytics body decoded"', () => {
        const row = decodable([request('https://us.i.posthog.com/e/?ip=0', 'POST', batch('session_saved')), request('https://us.i.posthog.com/e/?beacon=1', 'POST', null)]);
        expect(row.detail).not.toBe('every analytics body decoded');
        expect(row.detail).toMatch(/^every exposed analytics body decoded; 1 beacon body\(ies\) not exposed/);
        expect(row.evidence).toMatchObject({ events: 1, undecodable: 0, blindBeacons: 1 });
    });
    it('with every body exposed, the absolute claim stands', () => {
        const row = decodable([request('https://us.i.posthog.com/e/?ip=0', 'POST', batch('session_saved'))]);
        expect([row.verdict, row.detail]).toEqual(['PASS', 'every analytics body decoded']);
    });
});

describe('sentVerdict — a "sent" row FAILS only when every body that could carry the event was readable', () => {
    const tap = (...blindAt: number[]) => ({ blindAt });
    it('all expected events seen → PASS, blind or not', () => {
        expect([sentVerdict(true, tap(), 100), sentVerdict(true, tap(150, 200), 100)]).toEqual(['PASS', 'PASS']);
    });
    it('CASUALTY: an event missing while a beacon sent AFTER its step was blind → HOLD (missing evidence), not FAIL', () => {
        expect(sentVerdict(false, tap(150), 100)).toBe('HOLD');
        expect(sentVerdict(false, tap(100), 100)).toBe('HOLD');
    });
    it('CASUALTY r4199883470: a blind beacon from BEFORE the step (an earlier reload) cannot mask a later absence → FAIL', () => {
        expect(sentVerdict(false, tap(10, 50), 100)).toBe('FAIL');
    });
    it('an event missing with every body readable → FAIL (an observed absence)', () => {
        expect(sentVerdict(false, tap(), 100)).toBe('FAIL');
    });
    it('the HOLD detail counts only beacons after the step; other details are unchanged', () => {
        expect(sentDetail('x left the page', false, tap(10, 150, 200), 100)).toMatch(/not seen, but 2 PostHog beacon\(s\) sent after this step.*received readback decides/);
        expect(sentDetail('x left the page', true, tap(150), 100)).toBe('x left the page');
        expect(sentDetail('x left the page', false, tap(10), 100)).toBe('x left the page');
    });
});

/**
 * Codex r4200925124: "revisit is not a generation" is an EXACT-count claim. Window = Stop (100) → count snapshot (500).
 */
describe('exactCountVerdict — an exact count is proven only with every in-window body exposed (r4200925124)', () => {
    const tap = (...blindAt: number[]) => ({ blindAt });
    it('CASUALTY: the expected count with a blind beacon INSIDE the window → HOLD (a second request could be hidden)', () => {
        expect(exactCountVerdict(1, 1, tap(250), 100, 500)).toBe('HOLD');
        expect(exactCountVerdict(1, 1, tap(100), 100, 500)).toBe('HOLD');
        expect(exactCountVerdict(1, 1, tap(500), 100, 500)).toBe('HOLD');
    });
    it('a blind beacon only BEFORE Stop, or only AFTER the snapshot, cannot hide a request in the window → PASS', () => {
        expect(exactCountVerdict(1, 1, tap(50), 100, 500)).toBe('PASS');
        expect(exactCountVerdict(1, 1, tap(900), 100, 500)).toBe('PASS');
        expect(exactCountVerdict(1, 1, tap(), 100, 500)).toBe('PASS');
    });
    it('an observed EXTRA request is definitive → FAIL, even with blind beacons', () => {
        expect(exactCountVerdict(2, 1, tap(), 100, 500)).toBe('FAIL');
        expect(exactCountVerdict(2, 1, tap(250), 100, 500)).toBe('FAIL');
    });
    it('fewer than expected: HOLD when a body in the window was hidden, FAIL when every body was exposed', () => {
        expect(exactCountVerdict(0, 1, tap(250), 100, 500)).toBe('HOLD');
        expect(exactCountVerdict(0, 1, tap(), 100, 500)).toBe('FAIL');
    });
    it('SOURCE CONTRACT: both products grade "revisit is not a generation" with exactCountVerdict over Stop → count snapshot', () => {
        const om = readFileSync(resolve(__dirname, '../live/rwt-open-mic-first-session.live.spec.ts'), 'utf8');
        const focus = readFileSync(resolve(__dirname, '../live/helpers/rwtFocusPointsJourney.ts'), 'utf8');
        expect(om).toContain("exactCountVerdict(generationsForFirstTake, 1, tap, stoppedAt, generationsForTake === null ? Date.now() : generationsAt)");
        expect(focus).toContain("exactCountVerdict(generationsForFirstTake, 1, tap, rowsStoppedAt, generationsForTake === null ? Date.now() : rowsGenerationsAt)");
        for (const src of [om, focus]) expect(src).toMatch(/receipt\.row\('revisit is not a generation', generationVerdict,/);
    });
});

describe('AnalyticsTap records WHEN each blind beacon was sent', () => {
    it('blindAt has one timestamp per blind request, in order', () => {
        const { page, fire } = fakePage();
        const t = new AnalyticsTap();
        t.attach(page as never);
        fire(request('https://us.i.posthog.com/e/?beacon=1', 'POST', null));
        fire(request('https://us.i.posthog.com/e/?ip=0', 'POST', batch('session_saved')));
        fire(request('https://us.i.posthog.com/e/?beacon=1', 'POST', null));
        expect({ blind: t.blindBeacons, stamps: t.blindAt.length, ordered: t.blindAt[0] <= t.blindAt[1] }).toEqual({ blind: 2, stamps: 2, ordered: true });
    });
});

describe('SOURCE CONTRACT: no live journey grades a "… sent" row FAIL without sentVerdict', () => {
    it('every `receipt.row(\'… sent\', …)` verdict goes through sentVerdict, never a bare PASS/FAIL ternary', () => {
        const live = resolve(__dirname, '../live');
        const files = [...readdirSync(live).map((f) => join(live, f)), ...readdirSync(join(live, 'helpers')).map((f) => join(live, 'helpers', f))]
            .filter((f) => f.endsWith('.ts'));
        const offenders = files.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/receipt\.row\('([^']* sent)',\s*([^\n]*)/g)]
            .filter((m) => /\? 'PASS' : 'FAIL'/.test(m[2]) && !m[2].includes('sentVerdict('))
            .map((m) => `${f.split('/tests/')[1]}: ${m[1]}`));
        expect(offenders).toEqual([]);
    });
    it('every live sentVerdict/sentDetail call is scoped by a since-marker (three or four arguments)', () => {
        const live = resolve(__dirname, '../live');
        const files = [...readdirSync(live).map((f) => join(live, f)), ...readdirSync(join(live, 'helpers')).map((f) => join(live, 'helpers', f))]
            .filter((f) => f.endsWith('.ts') && !f.endsWith('rwtJourney.ts'));
        const unscoped = files.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/sentVerdict\(([^()]*)\)/g)]
            .filter((m) => m[1].split(',').length < 3).map((m) => `${f.split('/tests/')[1]}: sentVerdict(${m[1]})`));
        expect(unscoped).toEqual([]);
    });
});
