// @vitest-environment jsdom
/**
 * #1593 ledger case 3 (run 39180659914) — the take-bound marker observer, driven through jsdom's real MutationObserver.
 * The original oracle polled every 500 ms and stamped after sequential reads, so a timely transition could be first seen
 * late. Each change is only known to lie in (previous delivery, its own callback]; these controls exercise the actual page
 * helper and that interval. jsdom proves no live Chromium/audio alignment.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    armMarkerObserverInPage, bindTakeAcquisition, classifyMarkerTiming, disposeMarkerObserver, disposeMarkerObserverInPage,
    freezeMarkerObserver, freezeMarkerObserverInPage, markerTimingStatus, MARKER_RAIL_TEST_ID, MARKER_ROW_PREFIX,
} from '../live/helpers/rwtMarkerObserver';

const w = window as unknown as Record<string, unknown>;
let now = 0;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const rail = (statuses: string[]) => {
    const list = document.createElement('div');
    list.setAttribute('data-testid', MARKER_RAIL_TEST_ID);
    statuses.forEach((s, i) => {
        const row = document.createElement('div');
        row.setAttribute('data-testid', `${MARKER_ROW_PREFIX}${i}`);
        row.setAttribute('data-status', s);
        list.appendChild(row);
    });
    document.body.appendChild(list);
    return list;
};
const row = (i: number) => document.querySelector(`[data-testid="${MARKER_ROW_PREFIX}${i}"]`) as HTMLElement;
const arm = (token = 'mo-1', count = 2) => armMarkerObserverInPage({ token, count, railTestId: MARKER_RAIL_TEST_ID, rowPrefix: MARKER_ROW_PREFIX });
// Point 0 spoken 2–6.21 s, point 1 from 9.02 s: point 0's earliest is 1.0 s, its deadline min(6.21 + 5, 9.02) = 9.02 s.
const windows: ([number, number] | null)[] = [[2, 6.21], [9.02, 12]];
const INVOKED = 100_000;
const at = (sec: number) => INVOKED + Math.round(sec * 1000);
// The page re-renders constantly during a take (live transcript): any delivery advances the lower bound.
const heartbeat = async (sec: number) => {
    now = at(sec);
    document.body.appendChild(document.createElement('span'));
    await flush();
};
const verdict = (observations: Parameters<typeof classifyMarkerTiming>[0]['observations'], wins = windows, expectsLive = [true, false]) =>
    classifyMarkerTiming({ windows: wins, observations, invokedAtMs: INVOKED, expectsLive });

beforeEach(() => {
    now = INVOKED;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const t of ['mo-1', 'mo-2', 'mo-9']) disposeMarkerObserverInPage(t);
    delete w.__rwtMarkerObserver__;
    delete w.__rwtMicAcquisitionLog__;
    delete w.__rwtMicAcquisitions__;
    document.body.innerHTML = '';
});

describe('take-bound marker observer (#1593 case 3)', () => {
    it('a timely transition is bounded inside the window, where 500 ms polling stamped it after the deadline', async () => {
        rail(['pending', 'pending']);
        expect(arm()).toEqual({ ok: true });
        await heartbeat(8.5);
        now = at(8.9); // the real transition, inside the 9.02 s deadline
        row(0).setAttribute('data-status', 'partial');
        await flush();
        now = at(9.4);
        const sealed = freezeMarkerObserverInPage('mo-1')!;
        expect(sealed.observations).toEqual([{ point: 0, status: 'partial', afterMs: at(8.5), observedAtMs: at(8.9), seq: 0, railGeneration: 1 }]);
        const v = verdict(sealed.observations);
        expect(v[0]).toBe('ok@8.500..8.900');
        expect(markerTimingStatus(v)).toBe('PASS');
        // RED for the old model: the same transition, first read by the poll at 9.40 s, is judged late.
        expect(verdict([{ point: 0, status: 'partial', afterMs: at(9.4), observedAtMs: at(9.4), seq: 0, railGeneration: 1 }])[0]).toBe('late@9.400..9.400');
    });

    it('a truly late transition still fails', async () => {
        rail(['pending', 'pending']);
        arm();
        await heartbeat(9.1);
        now = at(9.3);
        row(0).setAttribute('data-status', 'covered');
        await flush();
        const v = verdict(freezeMarkerObserverInPage('mo-1')!.observations);
        expect(v[0]).toBe('late@9.100..9.300');
        expect(markerTimingStatus(v)).toBe('FAIL');
    });

    it('a delayed callback cannot manufacture a PASS: across the deadline the interval is uncertain, never ok', async () => {
        rail(['pending', 'pending']);
        arm();
        await heartbeat(8.5);
        now = at(8.9);
        row(0).setAttribute('data-status', 'partial'); // mutated in time…
        now = at(9.6); // …but the callback runs late
        await flush();
        const v = verdict(freezeMarkerObserverInPage('mo-1')!.observations);
        expect(v[0]).toBe('uncertain-late@8.500..9.600');
        expect(markerTimingStatus(v)).toBe('HOLD');
    });

    it('Sam 7:34 #1: a delayed callback cannot hide an EARLY change (transition 0.50, callback 3.00, earliest 1.91)', async () => {
        rail(['pending', 'pending']);
        arm(); // armed at 0.00: the last delivery before the change
        now = at(0.5);
        row(0).setAttribute('data-status', 'partial');
        now = at(3);
        await flush();
        const early: ([number, number] | null)[] = [[2.91, 6.21], [9.02, 12]];
        const v = verdict(freezeMarkerObserverInPage('mo-1')!.observations, early);
        expect(v[0]).toBe('uncertain-early@0.000..3.000');
        expect(markerTimingStatus(v)).toBe('HOLD');
        // A definitely-early change is a FAIL.
        expect(verdict([{ point: 0, status: 'partial', afterMs: at(0.2), observedAtMs: at(0.6), seq: 0, railGeneration: 1 }], early)[0]).toBe('early@0.200..0.600');
    });

    it('batched transients are kept: an unspoken point that flickers is still marked-though-never-spoken', async () => {
        rail(['pending', 'pending']);
        arm();
        now = at(3);
        row(1).setAttribute('data-status', 'partial');
        row(1).setAttribute('data-status', 'pending'); // same delivery: the final state alone would hide it
        await flush();
        const sealed = freezeMarkerObserverInPage('mo-1')!;
        expect(sealed.observations.map((o) => `${o.point}:${o.status}`)).toEqual(['1:partial', '1:pending']);
        const v = verdict(sealed.observations, [[2, 6.21], null], [false, false]);
        expect(v[1]).toBe('marked-though-never-spoken');
        expect(markerTimingStatus(v)).toBe('FAIL');
    });

    it('Sam 7:34 #2: an unspoken row that flickers and is then replaced before the callback keeps its pre-removal evidence', async () => {
        const old = rail(['pending', 'pending']);
        arm();
        now = at(3);
        const unspoken = row(1);
        unspoken.setAttribute('data-status', 'partial'); // attached at mutation time: eligible evidence
        old.remove();
        unspoken.setAttribute('data-status', 'covered'); // after its rail's removal: stale, never accepted
        rail(['pending', 'pending']); // the replacement shows nothing marked
        await flush();
        const sealed = freezeMarkerObserverInPage('mo-1')!;
        // Kept as generation-1 evidence. jsdom delivers no transient post-removal record to name the value it set, so it is
        // 'unknown' (a browser's transient record would name 'partial'); the later 'covered' write is never accepted.
        expect(sealed.observations).toContainEqual({ point: 1, status: 'unknown', afterMs: at(0), observedAtMs: at(3), seq: 0, railGeneration: 1 });
        expect(sealed.observations.some((o) => o.status === 'covered')).toBe(false);
        expect(sealed.railGenerations).toBe(2);
        const v = verdict(sealed.observations, [[2, 6.21], null], [false, false]);
        expect(v[1]).toBe('uncertain-unspoken-change@0.000..3.000'); // not ok-unspoken: the gap is non-PASS
        expect(markerTimingStatus(v)).toBe('HOLD');
        // With the transient record a browser delivers, the value is named and the flicker is a definite FAIL.
        expect(verdict([{ point: 1, status: 'partial', afterMs: at(0), observedAtMs: at(3), seq: 0, railGeneration: 1 }], [[2, 6.21], null], [false, false])[1])
            .toBe('marked-though-never-spoken');
    });

    it('an expected rail replacement is followed (new generation); a change after the removal is refused as stale', async () => {
        const old = rail(['pending', 'pending']);
        arm();
        await heartbeat(3.5);
        const detachedRow = row(0);
        now = at(4);
        old.remove();
        rail(['partial', 'pending']); // the re-render carries the take's real progress
        detachedRow.setAttribute('data-status', 'covered'); // the old rail's row, after its removal
        await flush();
        const sealed = freezeMarkerObserverInPage('mo-1')!;
        expect(sealed.railGenerations).toBe(2);
        expect(sealed.observations).toEqual([{ point: 0, status: 'partial', afterMs: at(3.5), observedAtMs: at(4), seq: 0, railGeneration: 2 }]);
    });

    it('Stop-only detection: a change after the freeze is refused, the sealed window is unchanged, and the point has no live change', async () => {
        rail(['pending', 'pending']);
        arm();
        const sealed = freezeMarkerObserverInPage('mo-1')!;
        now = at(13);
        row(0).setAttribute('data-status', 'covered');
        await flush();
        expect(freezeMarkerObserverInPage('mo-1')).toEqual(sealed); // idempotent; nothing changed it
        const v = verdict(sealed.observations);
        expect(v[0]).toBe('no-live-change');
        expect(markerTimingStatus(v)).toBe('FAIL');
    });

    it('arms only on a clean rail and refuses a second live observer', () => {
        rail(['partial', 'pending']);
        expect(arm()).toEqual({ ok: true });
        expect(freezeMarkerObserverInPage('mo-1')!.initialAllPending).toBe(false);
        disposeMarkerObserverInPage('mo-1');
        expect(arm('mo-2')).toEqual({ ok: true });
        expect(arm('mo-9')).toEqual({ ok: false, reason: 'another-observer-active' });
        expect(disposeMarkerObserverInPage('mo-2')).toBe(true);
        expect(disposeMarkerObserverInPage('mo-2')).toBe(false); // idempotent
    });
});

describe('Sam 7:34 #3: the acquisition copy is sealed with the window, in one token-validated evaluation', () => {
    it('freeze copies the log and stamps at freeze time; later acquisitions cannot change the sealed copy', () => {
        rail(['pending', 'pending']);
        w.__rwtMicAcquisitionLog__ = [{ id: 0, outcome: 'granted' }];
        w.__rwtMicAcquisitions__ = [50_000];
        arm();
        (w.__rwtMicAcquisitionLog__ as { id: number; outcome: string }[]).push({ id: 1, outcome: 'granted' });
        (w.__rwtMicAcquisitions__ as number[]).push(INVOKED);
        const sealed = freezeMarkerObserverInPage('mo-1')!;
        expect(sealed.acquisitionsAtArm).toBe(1);
        expect(sealed.acquisitionLog).toEqual([{ id: 0, outcome: 'granted' }, { id: 1, outcome: 'granted' }]);
        expect(sealed.acquisitionMarks).toEqual([50_000, INVOKED]);
        (w.__rwtMicAcquisitionLog__ as { id: number; outcome: string }[]).push({ id: 2, outcome: 'granted' });
        expect(freezeMarkerObserverInPage('mo-1')!.acquisitionLog).toHaveLength(2);
        expect(bindTakeAcquisition(sealed.acquisitionLog, sealed.acquisitionMarks, sealed.acquisitionsAtArm)).toEqual({ ok: true, id: 1, invokedAtMs: INVOKED });
    });

    it('a replaced document (the token\'s state gone, another observer present) seals nothing: null, so the journey HOLDs', () => {
        rail(['pending', 'pending']);
        arm('mo-1');
        delete w.__rwtMarkerObserver__; // a navigation drops the old document's window state
        arm('mo-9');
        expect(freezeMarkerObserverInPage('mo-1')).toBeNull();
    });
});

describe('the take is bound to exactly one fresh granted acquisition', () => {
    const marks = [50_000, 100_000, 100_500];
    it('binds the one fresh granted invocation', () => {
        expect(bindTakeAcquisition([{ id: 0, outcome: 'granted' }, { id: 1, outcome: 'granted' }], marks, 1)).toEqual({ ok: true, id: 1, invokedAtMs: 100_000 });
    });
    it('rejects old, missing, ambiguous, denied, unsettled and unstamped acquisitions', () => {
        expect(bindTakeAcquisition([{ id: 0, outcome: 'granted' }], marks, 1)).toEqual({ ok: false, reason: 'missing' });
        expect(bindTakeAcquisition([{ id: 1, outcome: 'granted' }, { id: 2, outcome: 'granted' }], marks, 1)).toEqual({ ok: false, reason: 'ambiguous' });
        expect(bindTakeAcquisition([{ id: 1, outcome: 'NotAllowedError' }], marks, 1)).toEqual({ ok: false, reason: 'denied' });
        expect(bindTakeAcquisition([{ id: 1, outcome: 'pending' }], marks, 1)).toEqual({ ok: false, reason: 'unsettled' });
        expect(bindTakeAcquisition([{ id: 5, outcome: 'granted' }], marks, 1)).toEqual({ ok: false, reason: 'unstamped' });
    });
});

describe('bounded cleanup through the finalizer, and the journey wiring', () => {
    it('a hung or closed page cannot stall freeze or disposal', async () => {
        vi.useFakeTimers();
        const hung = { evaluate: () => new Promise(() => undefined) } as never;
        const disposal = disposeMarkerObserver(hung, 'mo-1', 3_000);
        const freeze = freezeMarkerObserver(hung, 'mo-1', 5_000);
        await vi.advanceTimersByTimeAsync(5_000);
        await expect(disposal).resolves.toBe(false);
        await expect(freeze).resolves.toBeNull();
        const closed = { evaluate: () => Promise.reject(new Error('Target closed')) } as never;
        await expect(disposeMarkerObserver(closed, 'mo-1')).resolves.toBe(false);
        await expect(disposeMarkerObserver(closed, null)).resolves.toBe(false);
    });

    it('arms before preparePrivateModelIfPrompted, freezes before the verdict and Stop, classifies only the sealed copy, disposes once', () => {
        const src = readFileSync('tests/live/helpers/rwtFocusPointsJourney.ts', 'utf8');
        const armedAt = src.indexOf('await armMarkerObserver(page, points.length)');
        expect(armedAt).toBeGreaterThan(-1);
        expect(armedAt).toBeLessThan(src.indexOf('await preparePrivateModelIfPrompted(page, 900_000)'));
        const frozenAt = src.indexOf('await freezeMarkerObserver(page, armed.token)');
        expect(frozenAt).toBeGreaterThan(armedAt);
        expect(frozenAt).toBeLessThan(src.indexOf("receipt.row('marker timing vs audio'"));
        expect(frozenAt).toBeLessThan(src.indexOf('await stopBenchmarkRecording(page, suite, 180_000)'));
        expect(src).toContain('bindTakeAcquisition(sealed.acquisitionLog, sealed.acquisitionMarks, sealed.acquisitionsAtArm)');
        expect(src).not.toMatch(/micAcquisitionLog\(page\)/);
        expect(src).toContain('const status = markerTimingStatus(verdicts);');
        const finalization = src.slice(src.indexOf('finalizer.once(async () => {'));
        expect(finalization).toContain("await steps.step('marker observer dispose', () => disposeMarkerObserver(page, markerToken));");
        expect(src).not.toMatch(/startedAt \+ 1_000/); // the Node-clock acquisition cutoff is gone
    });
});
