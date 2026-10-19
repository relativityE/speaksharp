/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { armMarkerTimelineInPage, closeMarkerTimelineInPage } from '../live/helpers/rwtMarkerTimeline';

type ObservedWindow = Window & {
    __rwtMicAcquisitions__?: number[];
    __rwtMarkerTimeline__?: { finish(): unknown };
};
const w = window as ObservedWindow;
const WALL = 1_790_000_000_000;
let at = 0;
const point = () => document.querySelector('[data-testid="focus-point-0"]')!;
const arm = () => armMarkerTimelineInPage({ token: 'case3-window', points: 2 });
const close = () => closeMarkerTimelineInPage('case3-window')!;

beforeEach(() => {
    at = 0;
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    vi.spyOn(performance, 'now').mockImplementation(() => at);
    vi.spyOn(Date, 'now').mockImplementation(() => WALL + at);
    document.body.innerHTML = '<section data-testid="focus-points-rail">'
        + '<li data-testid="focus-point-0" data-status="pending"></li>'
        + '<li data-testid="focus-point-1" data-status="pending"></li></section>';
    w.__rwtMicAcquisitions__ = [];
});
afterEach(() => {
    w.__rwtMarkerTimeline__?.finish();
    delete w.__rwtMarkerTimeline__;
    delete w.__rwtMicAcquisitions__;
    vi.restoreAllMocks();
    vi.useRealTimers();
});
const acquire = () => { w.__rwtMicAcquisitions__!.push(WALL + at); };

describe('case3 pre-Start marker collector — actual MutationObserver', () => {
    it.each([8_900, 9_100])('retains the change at %ims before a later 9.4s poll', async (when) => {
        arm();
        at = 100; acquire();
        at = when - 50;
        vi.advanceTimersByTime(50);
        at = when;
        point().setAttribute('data-status', 'covered');
        await Promise.resolve();
        at = 9_400;
        const result = close();
        expect(result.changes).toEqual([{ point: 0, from: 'pending', to: 'covered', earliestMs: when - 50, observedMs: when }]);
        expect(result.observationFailures).toEqual([]);
        expect(result.audioOnsetVerified).toBe(false);
    });

    it('a delayed callback retains an interval crossing the deadline rather than inventing a late mutation', async () => {
        arm(); acquire();
        at = 8_800;
        vi.advanceTimersByTime(50);
        at = 8_900;
        point().setAttribute('data-status', 'covered');
        at = 9_400; // Same occupied turn; mutation has not been delivered yet.
        await Promise.resolve();
        const change = close().changes[0];
        expect(change.earliestMs).toBe(8_800);
        expect(change.observedMs).toBe(9_400);
        expect(change.earliestMs).toBeLessThan(9_020);
        expect(change.observedMs).toBeGreaterThan(9_020);
    });

    it('drains a pre-Start cold-auto-resume change even when close precedes callback delivery', () => {
        arm();
        at = 10; acquire();
        at = 20; point().setAttribute('data-status', 'partial');
        const result = close();
        expect(result.changes[0]).toMatchObject({ from: 'pending', to: 'partial', observedMs: 20 });
        expect(result.acquisitionRequestWallMs).toEqual([WALL + 10]);
        expect(result.observationFailures).toEqual([]);
        expect(closeMarkerTimelineInPage('case3-window')).toBeNull();
    });

    it('preserves covered then pending within a single observer batch', () => {
        arm(); acquire();
        at = 100;
        point().setAttribute('data-status', 'covered');
        point().setAttribute('data-status', 'pending');
        expect(close().changes.map(({ from, to }) => [from, to])).toEqual([
            ['pending', 'covered'], ['covered', 'pending'],
        ]);
    });

    it('records content-free rendered observations and never claims authoritative committed text', () => {
        arm(); acquire();
        at = 100;
        document.body.insertAdjacentHTML('beforeend', '<div data-testid="live-transcript"><span>budget</span> '
            + '<span data-testid="live-interim">um</span></div>');
        const result = close();
        expect(result.rendered).toEqual([{ earliestMs: 0, observedMs: 100,
            visibleCharacters: 9, interimCharacters: 2, committedCharacters: null }]);
        expect(JSON.stringify(result)).not.toContain('budget');
    });

    it('a same-URL replacement cannot borrow an old realm token', () => {
        arm(); acquire();
        const oldState = w.__rwtMarkerTimeline__!;
        delete w.__rwtMarkerTimeline__;
        expect(closeMarkerTimelineInPage('case3-window')).toBeNull();
        oldState.finish();
    });

    it('rejects another take token without consuming the owned observer', () => {
        arm(); acquire();
        expect(closeMarkerTimelineInPage('other-window')).toBeNull();
        expect(close().token).toBe('case3-window');
    });

    it.each(['pagehide', 'beforeunload'])('%s preserves observation loss', (event) => {
        arm(); acquire();
        window.dispatchEvent(new Event(event));
        expect(close().observationFailures).toContain('document_observation_lost');
    });

    it.each([0, 2])('%i acquisitions cannot establish a unique take', (count) => {
        arm();
        for (let i = 0; i < count; i += 1) acquire();
        expect(close().observationFailures).toContain('take_acquisition_not_unique');
    });

    it('pre-arm acquisitions are excluded from the selected take window', () => {
        acquire();
        arm();
        at = 100; acquire();
        expect(close().acquisitionRequestWallMs).toEqual([WALL + 100]);
    });

    it('replacement/reset of the microphone instrumentation cannot look like zero new acquisitions', () => {
        arm(); acquire();
        w.__rwtMicAcquisitions__ = [];
        expect(close().observationFailures).toContain('microphone_observation_lost');
    });

    it('unavailable microphone instrumentation is explicit observation loss', () => {
        delete w.__rwtMicAcquisitions__;
        arm();
        expect(close().observationFailures).toContain('microphone_observer_unavailable');
    });

    it('a clock jump invalidates the acquisition/marker clock join', () => {
        arm(); acquire();
        vi.mocked(Date.now).mockImplementation(() => WALL + at + 1_000);
        expect(close().observationFailures).toContain('wall_clock_changed');
    });

    it('an unreadable marker status remains unqualified', () => {
        arm(); acquire();
        point().removeAttribute('data-status');
        expect(close().observationFailures).toContain('marker_status_unreadable');
    });

    it('a replacement rail or point cannot silently inherit the original window', () => {
        arm(); acquire();
        const rail = document.querySelector('[data-testid="focus-points-rail"]')!;
        rail.replaceWith(rail.cloneNode(true));
        const result = close();
        expect(result.observationFailures).toContain('rail_replaced_or_removed');
        expect(result.observationFailures).toContain('point_replaced_or_removed');
    });

    it('arming an existing window cannot overwrite its evidence', () => {
        arm(); acquire();
        expect(arm).toThrow(/already armed/);
        expect(close().token).toBe('case3-window');
    });

    it('non-neutral initial markers remain explicit rather than being accepted as live detections', () => {
        point().setAttribute('data-status', 'covered');
        arm(); acquire();
        expect(close().observationFailures).toContain('rail_not_neutral_at_arm');
    });

    it('arming after a take starts cannot claim coverage before the first press', () => {
        document.body.insertAdjacentHTML('beforeend', '<button data-testid="recorder-stop"></button>');
        arm(); acquire();
        expect(close().observationFailures).toContain('armed_after_recording_started');
    });

    it('duplicate point identities cannot be hidden by querySelector choosing the first', () => {
        arm(); acquire();
        point().parentElement!.append(point().cloneNode(true));
        expect(close().observationFailures).toContain('point_identity_ambiguous');
    });

    it('the returned arm clock anchors the exact request to the monotonic observation interval', () => {
        arm();
        at = 200; acquire();
        const result = close();
        expect(result.armedWallMs).toBe(WALL);
        expect(result.acquisitionRequestWallMs[0] - result.armedWallMs).toBe(200);
        expect(result.audioOnsetVerified).toBe(false);
    });
});
