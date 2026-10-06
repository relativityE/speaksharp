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
import { AnalyticsTap, sentDetail, sentVerdict } from '../live/helpers/rwtJourney';

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

describe('sentVerdict — a "sent" row FAILS only when every body was readable', () => {
    it('all expected events seen → PASS, blind or not', () => {
        expect([sentVerdict(true, { blindBeacons: 0 }), sentVerdict(true, { blindBeacons: 3 })]).toEqual(['PASS', 'PASS']);
    });
    it('CASUALTY: an event missing while beacons were blind → HOLD (missing evidence), not FAIL', () => {
        expect(sentVerdict(false, { blindBeacons: 2 })).toBe('HOLD');
    });
    it('an event missing with every body readable → FAIL (an observed absence)', () => {
        expect(sentVerdict(false, { blindBeacons: 0 })).toBe('FAIL');
    });
    it('the HOLD detail names the blind beacons and defers to the received readback; other details are unchanged', () => {
        expect(sentDetail('x left the page', false, { blindBeacons: 2 })).toMatch(/not seen, but 2 PostHog beacon\(s\).*received readback decides/);
        expect(sentDetail('x left the page', true, { blindBeacons: 2 })).toBe('x left the page');
        expect(sentDetail('x left the page', false, { blindBeacons: 0 })).toBe('x left the page');
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
});
