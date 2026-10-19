// @vitest-environment jsdom
/**
 * #1593 case 11 (Sam RETURN on c8e5d59f) — the in-page observation window, driven through jsdom's real MutationObserver and
 * fake microphone tracks: interruptions between any two reads, activity after a read, and a replaced document.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { armTakeoverGesture, crossRealmBoundary, measureRealmClock, closeObservationWindow, leaseRefusalWindowVerdict, openObservationWindow, type ObservationClose } from '../live/helpers/rwtAbandonTakeover';

class FakeTrack extends EventTarget {
    readyState = 'live';
    stop() { this.readyState = 'ended'; }
}
const w = window as unknown as Record<string, unknown>;
const root = document.documentElement;
const page = (o: { runtime?: string; model?: string; tracks?: FakeTrack[] } = {}) => {
    root.setAttribute('data-runtime-state', o.runtime ?? 'RECORDING');
    root.setAttribute('data-model-status', o.model ?? 'ready');
    const tracks = o.tracks ?? [new FakeTrack()];
    w.__rwtMicStreams__ = [{ getAudioTracks: () => tracks }];
    w.__rwtMicAcquisitionLog__ = tracks.map((_, id) => ({ id, outcome: 'granted' }));
    return tracks;
};
const open = (token = 'w-1') => openObservationWindow({ token, recorderTestId: 'recorder-bar' });

afterEach(() => { vi.useRealTimers(); delete w.__rwtObservationWindow__; delete w.__rwtMicStreams__; delete w.__rwtMicAcquisitionLog__; delete w.__rwtMicAcquisitions__; });

describe('in-page observation window (case 11)', () => {
    it('a clean window: no transitions, no stopped track, no acquisition, same token', () => {
        page();
        expect(open()).toBe(true);
        expect(closeObservationWindow()).toMatchObject({ token: 'w-1', runtimeTransitions: ['RECORDING'], modelTransitions: ['ready'], tracksStoppedSinceOpen: 0, micAcquisitionsSinceOpen: 0, liveTracksAtOpen: 1, runtimeNow: 'RECORDING', liveTracks: 1 });
    });

    it('c8e5 #1: A stops and resumes between any two reads — both transitions are captured, even undelivered at close', () => {
        page();
        open();
        root.setAttribute('data-runtime-state', 'STOPPING');
        root.setAttribute('data-runtime-state', 'RECORDING'); // same delivery, never a sampled endpoint
        expect(closeObservationWindow().runtimeTransitions).toEqual(['RECORDING', 'STOPPING', 'RECORDING']);
    });

    it('c8e5 #1: a track stopped and a new one acquired (stop/resume through the microphone) is captured', () => {
        const [track] = page();
        open();
        track.stop();
        const fresh = new FakeTrack();
        (w.__rwtMicStreams__ as { getAudioTracks: () => FakeTrack[] }[]).push({ getAudioTracks: () => [fresh] });
        (w.__rwtMicAcquisitionLog__ as unknown[]).push({ id: 1, outcome: 'granted' });
        expect(closeObservationWindow()).toMatchObject({ tracksStoppedSinceOpen: 1, micAcquisitionsSinceOpen: 1, liveTracks: 1 });
    });

    it('c8e5 #1: a track that ENDS by itself (no stop call) is captured', () => {
        const [track] = page();
        open();
        track.readyState = 'ended';
        track.dispatchEvent(new Event('ended'));
        expect(closeObservationWindow().tracksStoppedSinceOpen).toBe(1);
    });

    it('c8e5 #2: late model-status activity and an acquire/release right before the close are in the one closing read', () => {
        page({ runtime: 'READY', model: 'download-required', tracks: [] });
        open();
        root.setAttribute('data-model-status', 'loading');
        root.setAttribute('data-model-status', 'download-required');
        (w.__rwtMicAcquisitionLog__ as unknown[]).push({ id: 0, outcome: 'granted' }); // acquired and already released
        const closed = closeObservationWindow();
        expect(closed.modelTransitions).toEqual(['download-required', 'loading', 'download-required']);
        expect(closed.micAcquisitionsSinceOpen).toBe(1);
        expect(closed.modelNow).toBe('download-required');
    });

    it('c8e5 #3: a replaced document (same URL or not) has no window — the close reports token null, never a clean window', () => {
        page();
        open();
        delete w.__rwtObservationWindow__; // a new document's realm: the opened window does not exist there
        expect(closeObservationWindow()).toMatchObject({ token: null, micAcquisitionsSinceOpen: null });
    });

    it('04920bce opening state: an A already STOPPING (with a live track) at open is the FIRST recorded value', () => {
        page({ runtime: 'STOPPING' });
        open();
        root.setAttribute('data-runtime-state', 'RECORDING');
        expect(closeObservationWindow()).toMatchObject({ runtimeTransitions: ['STOPPING', 'RECORDING'], liveTracksAtOpen: 1 });
    });

    it('an unavailable acquisition counter is reported as unknown, never zero', () => {
        page();
        delete w.__rwtMicAcquisitionLog__;
        open();
        expect(closeObservationWindow().micAcquisitionsSinceOpen).toBeNull();
    });
});

describe('16:15 tail RETURN — the refusal window ends at the take-over GESTURE (B: the event; A: B\'s gesture time)', () => {
    const clickB = () => document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    it('PM 6271723435 tail: B changes after the old reads but BEFORE the gesture are counted; the take-over\'s own changes are not', () => {
        page({ runtime: 'READY', model: 'download-required', tracks: [] });
        open('w-b');
        armTakeoverGesture({ acceptUntrusted: true });
        root.setAttribute('data-model-status', 'loading'); // the tail the old sequence never observed
        (w.__rwtMicAcquisitionLog__ as unknown[]).push({ id: 0, outcome: 'granted' });
        clickB();
        root.setAttribute('data-runtime-state', 'RECORDING'); // the take-over itself: after the gesture
        (w.__rwtMicAcquisitionLog__ as unknown[]).push({ id: 1, outcome: 'granted' });
        const b = closeObservationWindow();
        expect(b).toMatchObject({ boundary: 'gesture', modelTransitions: ['download-required', 'loading'], micAcquisitionsSinceOpen: 1, runtimeTransitions: ['READY'] });
        expect(b.gestureAt).not.toBeNull();
    });

    it('a clean tail: nothing before the gesture, take-over activity after it — B\'s portion is clean', () => {
        page({ runtime: 'READY', model: 'download-required', tracks: [] });
        open('w-b');
        armTakeoverGesture({ acceptUntrusted: true });
        clickB();
        root.setAttribute('data-model-status', 'loading');
        root.setAttribute('data-runtime-state', 'RECORDING');
        expect(closeObservationWindow()).toMatchObject({ boundary: 'gesture', modelTransitions: ['download-required'], runtimeTransitions: ['READY'], micAcquisitionsSinceOpen: 0 });
    });

    it('only the FIRST trusted click marks the gesture; an untrusted click does not (production arming)', () => {
        page({ runtime: 'READY', model: 'download-required', tracks: [] });
        open('w-b');
        armTakeoverGesture();
        clickB(); // jsdom events are untrusted
        expect(closeObservationWindow()).toMatchObject({ boundary: 'none', gestureAt: null });
    });

    /**
     * A's realm with its heartbeat on fake timers: open at 10 000, B's gesture at 11 000. `advance` runs the page's tasks
     * (ticks every 10 ms); `stall` jumps the clock with NO task running in between (a blocked event loop).
     */
    const realmA = () => {
        vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
        vi.setSystemTime(10_000);
        const tracks = page();
        open('w-a');
        return {
            tracks,
            advance: (ms: number) => vi.advanceTimersByTime(ms),
            stall: (to: number) => vi.setSystemTime(to),
            close: (marginMs = 5) => closeObservationWindow({ until: 11_000, marginMs }),
        };
    };
    const deliver = () => Promise.resolve(); // the observer delivers at the end of the mutating task

    it('A interrupted well BEFORE the gesture, with ticks after it, is in the refusal window', async () => {
        const a = realmA();
        a.advance(800);
        root.setAttribute('data-runtime-state', 'STOPPING');
        root.setAttribute('data-runtime-state', 'RECORDING');
        await deliver();
        a.advance(400);
        expect(a.close()).toMatchObject({ boundary: 'time', boundaryUncertain: false, runtimeTransitions: ['RECORDING', 'STOPPING', 'RECORDING'] });
    });

    it('A displaced AFTER the gesture, past a post-gesture tick (the legitimate take-over), is excluded', async () => {
        const a = realmA();
        a.advance(1_200);
        root.setAttribute('data-runtime-state', 'READY');
        a.tracks[0].stop();
        await deliver();
        a.advance(100);
        expect(a.close()).toMatchObject({ boundary: 'time', boundaryUncertain: false, runtimeTransitions: ['RECORDING'], tracksStoppedSinceOpen: 0 });
    });

    it('delayed-observation RETURN: a change made BEFORE the gesture but delivered after it (a stalled loop, no tick between) is uncertain — HOLD', async () => {
        const a = realmA();
        a.advance(900); // last tick 10 900
        root.setAttribute('data-runtime-state', 'STOPPING'); // made at 10 900, before the gesture...
        a.stall(11_100); // ...but the task runs on: no tick until well after the gesture (beyond the clock margin)
        await deliver(); // delivered at 11 100 — after B's gesture
        a.advance(300); // the loop resumes; ticks after the gesture
        const closed = a.close();
        expect(closed.boundaryUncertain, 'never silently excluded as post-take-over').toBe(true);
        const b: ObservationClose = { token: 'w-b', boundary: 'gesture', boundaryUncertain: false, gestureAt: 11_000, runtimeTransitions: ['READY'], runtimeNow: 'READY',
            modelTransitions: ['download-required'], modelNow: 'download-required', micAcquisitionsSinceOpen: 0, tracksStoppedSinceOpen: 0, liveTracksAtOpen: 0, liveTracks: 0, recorderVisible: false };
        expect(leaseRefusalWindowVerdict({ observed: true, refusalCopyShown: true, cold: true, modelRequests: 0, a: closed, b }).status).toBe('HOLD');
    });

    it('a heartbeat that never ticked after the gesture leaves every post-gesture entry uncertain (HOLD)', async () => {
        const a = realmA();
        a.advance(900);
        a.stall(11_400);
        root.setAttribute('data-runtime-state', 'READY');
        await deliver();
        expect(a.close().boundaryUncertain).toBe(true);
    });

    it('an A change within the MEASURED clock margin of the gesture is uncertain (HOLD) even with ticks around it', async () => {
        const a = realmA();
        a.advance(1_020);
        root.setAttribute('data-runtime-state', 'STOPPING');
        await deliver();
        a.advance(200);
        expect(a.close(40).boundaryUncertain, 'a 40 ms measured margin covers +20 ms').toBe(true);
    });

    it('coalesced records: a change before the gesture and one after it, delivered together after it, are uncertain (HOLD)', async () => {
        const a = realmA();
        a.advance(900);
        root.setAttribute('data-runtime-state', 'STOPPING'); // before the gesture
        a.stall(11_100);
        root.setAttribute('data-runtime-state', 'RECORDING'); // after it — same task, one coalesced delivery
        await deliver();
        a.advance(200);
        const closed = a.close();
        expect(closed.boundaryUncertain).toBe(true);
        expect(closed.runtimeTransitions, 'neither record is silently assigned').toEqual(['RECORDING']);
    });

    describe('the cross-realm clock mapping is measured, not assumed', () => {
        it('measureRealmClock keeps the tightest round-trip sample and reports its error; an unreadable clock is null', async () => {
            const host = [1_000, 1_010, 2_000, 2_002, 3_000, 3_040];
            let h = 0;
            const realm = [1_505, 2_501, 3_520];
            let r = 0;
            const clock = await measureRealmClock({ evaluate: async () => realm[r++] }, () => host[h++]);
            expect(clock).toEqual({ offset: 500, error: 1 });
            expect(await measureRealmClock({ evaluate: async () => { throw new Error('closed'); } })).toBeNull();
        });

        it('crossRealmBoundary maps B\'s gesture into A\'s clock with the measured margin (skewed realms)', () => {
            // B runs 300 ms ahead of the host, A 200 ms behind: B's 11 300 is A's 10 800.
            expect(crossRealmBoundary(11_300, { offset: -200, error: 3 }, { offset: 300, error: 4 })).toEqual({ until: 10_800, marginMs: 9 });
        });
    });

});
