// @vitest-environment jsdom
/**
 * #1593 ledger case 3 (run 39180659914) — the take-bound marker observer, driven through jsdom's real MutationObserver.
 * The original oracle polled every 500 ms and stamped after sequential reads, so a timely transition could be first seen
 * late. These controls exercise the actual page helper; jsdom proves no live Chromium/audio alignment.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    armMarkerObserverInPage, bindTakeAcquisition, classifyMarkerTiming, disposeMarkerObserver, disposeMarkerObserverInPage,
    freezeMarkerObserver, freezeMarkerObserverInPage, MARKER_RAIL_TEST_ID, MARKER_ROW_PREFIX,
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
// Point 0 spoken 2–6 s, point 1 spoken 9.02–12 s: point 0's deadline is min(6 + 5, 9.02) = 9.02 s (the case 3 shape).
const windows: ([number, number] | null)[] = [[2, 6.21], [9.02, 12]];
const INVOKED = 100_000;
const at = (sec: number) => INVOKED + Math.round(sec * 1000);

beforeEach(() => {
    now = INVOKED;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    disposeMarkerObserverInPage('mo-1');
    delete w.__rwtMarkerObserver__;
    delete w.__rwtMicAcquisitionLog__;
    document.body.innerHTML = '';
});

describe('take-bound marker observer (#1593 case 3)', () => {
    it('a timely transition is observed at its own time, where 500 ms polling stamped it after the deadline', async () => {
        rail(['pending', 'pending']);
        expect(arm()).toEqual({ ok: true });
        now = at(8.9); // the real transition: inside the 9.02 s deadline
        row(0).setAttribute('data-status', 'partial');
        await flush();
        now = at(9.4);
        const sealed = freezeMarkerObserverInPage('mo-1')!;
        expect(sealed.observations).toEqual([{ point: 0, status: 'partial', observedAtMs: at(8.9), seq: 0, railGeneration: 1 }]);
        const expectsLive = [true, false];
        expect(classifyMarkerTiming({ windows, observations: sealed.observations, invokedAtMs: INVOKED, expectsLive })[0]).toMatch(/^ok@8\.9/);
        // RED for the old model: the same transition, first read by the poll at 9.40 s, fails the deadline.
        const polled = [{ point: 0, status: 'partial', observedAtMs: at(9.4), seq: 0, railGeneration: 1 }];
        expect(classifyMarkerTiming({ windows, observations: polled, invokedAtMs: INVOKED, expectsLive })[0]).toMatch(/^late@9\.4/);
    });

    it('a truly late transition still fails', async () => {
        rail(['pending', 'pending']);
        arm();
        now = at(9.3);
        row(0).setAttribute('data-status', 'covered');
        await flush();
        const sealed = freezeMarkerObserverInPage('mo-1')!;
        expect(classifyMarkerTiming({ windows, observations: sealed.observations, invokedAtMs: INVOKED, expectsLive: [true, false] })[0]).toMatch(/^late@9\.3/);
    });

    it('a delayed callback cannot manufacture a PASS: the stamp is observation time, never backdated', async () => {
        rail(['pending', 'pending']);
        arm();
        now = at(8.9);
        row(0).setAttribute('data-status', 'partial'); // mutated in time…
        now = at(9.6); // …but the callback runs later
        await flush();
        const sealed = freezeMarkerObserverInPage('mo-1')!;
        expect(sealed.observations[0].observedAtMs).toBe(at(9.6));
        expect(classifyMarkerTiming({ windows, observations: sealed.observations, invokedAtMs: INVOKED, expectsLive: [true, false] })[0]).toMatch(/^late@9\.6/);
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
        expect(classifyMarkerTiming({ windows: [[2, 6.21], null], observations: sealed.observations, invokedAtMs: INVOKED, expectsLive: [false, false] })[1])
            .toBe('marked-though-never-spoken');
    });

    it('Stop-only detection: a change after the freeze is refused, the sealed window is unchanged, and the point has no live change', async () => {
        rail(['pending', 'pending']);
        arm();
        const sealed = freezeMarkerObserverInPage('mo-1')!;
        now = at(13);
        row(0).setAttribute('data-status', 'covered');
        await flush();
        expect(freezeMarkerObserverInPage('mo-1')).toEqual(sealed); // idempotent; nothing changed it
        expect(classifyMarkerTiming({ windows, observations: sealed.observations, invokedAtMs: INVOKED, expectsLive: [true, false] })[0]).toBe('no-live-change');
    });

    it('an expected rail replacement is followed (new generation); events on the detached rail are refused as stale', async () => {
        const old = rail(['pending', 'pending']);
        arm();
        const detachedRow = row(0);
        now = at(4);
        // The old rail's row changes, then the rail is replaced before the callback runs: at delivery the record's row is
        // detached, so its 'covered' is stale and refused; only the replacement's own state is accepted.
        detachedRow.setAttribute('data-status', 'covered');
        old.remove();
        rail(['partial', 'pending']); // the re-render carries the take's real progress
        await flush();
        now = at(5);
        detachedRow.setAttribute('data-status', 'missing'); // later: not in the observed tree, never delivered
        await flush();
        const sealed = freezeMarkerObserverInPage('mo-1')!;
        expect(sealed.railGenerations).toBe(2);
        expect(sealed.observations).toEqual([{ point: 0, status: 'partial', observedAtMs: at(4), seq: 0, railGeneration: 2 }]);
        expect(sealed.rejected).toEqual([{ reason: 'detached', point: 0 }]);
    });

    it('arms only on a clean rail and refuses a second live observer', () => {
        rail(['partial', 'pending']);
        expect(arm()).toEqual({ ok: true });
        expect(freezeMarkerObserverInPage('mo-1')!.initialAllPending).toBe(false);
        disposeMarkerObserverInPage('mo-1');
        expect(arm('mo-2')).toEqual({ ok: true });
        expect(arm('mo-3')).toEqual({ ok: false, reason: 'another-observer-active' });
        expect(disposeMarkerObserverInPage('mo-2')).toBe(true);
        expect(disposeMarkerObserverInPage('mo-2')).toBe(false); // idempotent
    });

    it('records the acquisitions already logged at arm, so only a later acquisition can be the take', () => {
        rail(['pending', 'pending']);
        w.__rwtMicAcquisitionLog__ = [{ id: 0, outcome: 'granted' }];
        arm();
        expect(freezeMarkerObserverInPage('mo-1')!.acquisitionsAtArm).toBe(1);
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

describe('bounded cleanup through the finalizer', () => {
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
        vi.useRealTimers();
    });

    it('the journey arms before preparePrivateModelIfPrompted, freezes before the verdict, and disposes in its one finalization', () => {
        const src = readFileSync('tests/live/helpers/rwtFocusPointsJourney.ts', 'utf8');
        const armedAt = src.indexOf('await armMarkerObserver(page, points.length)');
        expect(armedAt).toBeGreaterThan(-1);
        expect(armedAt).toBeLessThan(src.indexOf('await preparePrivateModelIfPrompted(page, 900_000)'));
        const frozenAt = src.indexOf('await freezeMarkerObserver(page, armed.token)');
        expect(frozenAt).toBeGreaterThan(armedAt);
        expect(frozenAt).toBeLessThan(src.indexOf("receipt.row('marker timing vs audio'"));
        expect(frozenAt).toBeLessThan(src.indexOf('await stopBenchmarkRecording(page, suite, 180_000)'));
        const finalization = src.slice(src.indexOf('finalizer.once(async () => {'));
        expect(finalization).toContain("await steps.step('marker observer dispose', () => disposeMarkerObserver(page, markerToken));");
        expect(src).not.toMatch(/startedAt \+ 1_000/); // the Node-clock acquisition cutoff is gone
    });
});
