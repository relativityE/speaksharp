// @vitest-environment jsdom
/**
 * Sam's ACCEPT of Browser PM 731eb5c0 (cases 13/14): the adverse download-failure row's two observation inputs — the
 * published model-status history and the fault's own failure count — driven through jsdom's real MutationObserver.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { AttemptFaultCounter, armModelStatusLog, downloadFailureVerdict, readModelStatusLog } from '../live/helpers/rwtAdverse';

const root = document.documentElement;
const w = window as unknown as Record<string, unknown>;
afterEach(() => { delete w.__rwtModelStatusLog__; });
const failed = (statuses: string[], observed = true) => downloadFailureVerdict({
    exercised: true, observed, statuses, finalStatus: 'error', retryOffered: true, mode: 'private',
});

describe('the published model-status history is complete (PM 731eb5c0 finding 1)', () => {
    it('keeps the initial state and ready → error inside ONE delivery — "never ready" then FAILs', () => {
        root.setAttribute('data-model-status', 'downloading');
        armModelStatusLog('t-1');
        root.setAttribute('data-model-status', 'loading');
        root.setAttribute('data-model-status', 'ready');
        root.setAttribute('data-model-status', 'error'); // all undelivered when read: drained by takeRecords
        const log = readModelStatusLog();
        expect(log).toEqual({ token: 't-1', statuses: ['downloading', 'loading', 'ready', 'error'] });
        expect(failed(log.statuses)).toMatchObject({ status: 'FAIL', detail: expect.stringContaining('ready') });
    });

    it('the old per-delivery current-value logger lost `ready` in that schedule and passed (the reviewed defect)', async () => {
        root.setAttribute('data-model-status', 'loading');
        const legacy: string[] = [];
        const push = () => { const s = root.getAttribute('data-model-status'); if (s !== null && legacy[legacy.length - 1] !== s) legacy.push(s); };
        push();
        new MutationObserver(push).observe(root, { attributes: true, attributeFilter: ['data-model-status'] });
        root.setAttribute('data-model-status', 'ready');
        root.setAttribute('data-model-status', 'error');
        await Promise.resolve();
        expect(legacy).toEqual(['loading', 'error']);
        expect(failed(legacy).status).toBe('PASS');
    });

    it('distinct deliveries are kept too, and a later read continues the same history', async () => {
        root.setAttribute('data-model-status', 'downloading');
        armModelStatusLog('t-2');
        root.setAttribute('data-model-status', 'error');
        await Promise.resolve();
        expect(readModelStatusLog().statuses).toEqual(['downloading', 'error']);
        root.setAttribute('data-model-status', 'ready');
        expect(readModelStatusLog().statuses).toEqual(['downloading', 'error', 'ready']);
    });

    it('a replaced document has no log (token null), and an incomplete or empty history is HOLD — never "never ready"', () => {
        root.setAttribute('data-model-status', 'error');
        armModelStatusLog('t-3');
        delete w.__rwtModelStatusLog__;
        expect(readModelStatusLog()).toEqual({ token: null, statuses: [] });
        expect(failed(['error'], false).status).toBe('HOLD');
        expect(failed([]).status).toBe('HOLD');
        expect(failed(['downloading', 'error']).status).toBe('PASS');
    });
});

describe('the fault counts only its own attempt\'s failures, armed before induction (PM 731eb5c0 finding 2)', () => {
    const weight = 'https://app.test/models/whisper-base/onnx/decoder_model_merged.onnx';
    const config = 'https://app.test/models/whisper-base/config.json';

    it('a failure delivered DURING the awaited injection counts (armed before), and config of this attempt counts too', async () => {
        const fault = new AttemptFaultCounter<object>();
        const a = {}; const b = {};
        fault.startAttempt();
        fault.onRequest(a, weight);
        fault.onRequest(b, config);
        fault.armFault();
        await new Promise<void>((resolve) => { fault.onFailed(a); resolve(); }); // delivered while the injection is awaited
        fault.onFailed(b);
        expect(fault.failures).toBe(2);
    });

    it('failures before arming, model traffic from before the attempt, non-model requests and failures after disarm never count', () => {
        const fault = new AttemptFaultCounter<object>();
        const early = {}; const pageLoad = {}; const other = {}; const late = {};
        fault.onRequest(pageLoad, config); // before the person's press
        fault.startAttempt();
        fault.onRequest(early, weight);
        fault.onRequest(other, 'https://app.test/api/session');
        fault.onFailed(early); // not armed yet
        fault.armFault();
        fault.onFailed(pageLoad);
        fault.onFailed(other);
        fault.onRequest(late, weight);
        fault.disarm();
        fault.onFailed(late);
        expect(fault.failures).toBe(0);
    });

    it('the spec arms the fault before inducing it and opens the attempt before the press, in both variants', () => {
        const spec = readFileSync('tests/live/rwt-adverse-mic-model.live.spec.ts', 'utf8');
        const route = spec.indexOf('await context.route(MODEL_ASSETS, (route) => route.abort');
        const offline = spec.indexOf('await context.setOffline(true)');
        const armBeforeRoute = spec.lastIndexOf('fault.armFault();', route);
        const armBeforeOffline = spec.lastIndexOf('fault.armFault();', offline);
        expect(armBeforeRoute).toBeGreaterThan(-1);
        expect(armBeforeOffline).toBeGreaterThan(route);
        const press = spec.indexOf("await page.getByTestId('mic-download').click();", route);
        expect(spec.lastIndexOf('fault.startAttempt();', press)).toBeGreaterThan(route);
        expect(spec).not.toMatch(/faultOn/);
        expect(spec).toContain('await page.evaluate(armModelStatusLog, modelStatusToken);');
    });
});
