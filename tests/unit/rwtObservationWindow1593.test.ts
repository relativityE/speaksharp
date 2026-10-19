// @vitest-environment jsdom
/**
 * #1593 case 11 (Sam RETURN on c8e5d59f) — the in-page observation window, driven through jsdom's real MutationObserver and
 * fake microphone tracks: interruptions between any two reads, activity after a read, and a replaced document.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TAKEOVER_BOUNDARY_MARGIN_MS, armTakeoverGesture, closeObservationWindow, leaseRefusalWindowVerdict, openObservationWindow, type ObservationClose } from '../live/helpers/rwtAbandonTakeover';

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

    /** A changes at `gestureOffset` from B's gesture; the observer delivers at the end of that task, as in a browser. */
    const aAt = async (gestureOffset: number, change: () => void) => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(10_000);
        page();
        open('w-a');
        vi.setSystemTime(10_000 + 1_000 + gestureOffset);
        change();
        await Promise.resolve();
        vi.setSystemTime(10_000 + 2_000);
        return closeObservationWindow({ until: 10_000 + 1_000, marginMs: TAKEOVER_BOUNDARY_MARGIN_MS });
    };

    it('A interrupted just BEFORE the gesture (beyond the margin) is in the refusal window', async () => {
        const a = await aAt(-200, () => { root.setAttribute('data-runtime-state', 'STOPPING'); root.setAttribute('data-runtime-state', 'RECORDING'); });
        expect(a).toMatchObject({ boundary: 'time', boundaryUncertain: false, runtimeTransitions: ['RECORDING', 'STOPPING', 'RECORDING'] });
    });

    it('A displaced AFTER the gesture (the legitimate take-over) is excluded; a track stopped then is excluded too', async () => {
        const [track] = page();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(20_000);
        open('w-a');
        vi.setSystemTime(21_500);
        root.setAttribute('data-runtime-state', 'READY');
        track.stop();
        await Promise.resolve();
        const a = closeObservationWindow({ until: 21_000, marginMs: TAKEOVER_BOUNDARY_MARGIN_MS });
        expect(a).toMatchObject({ boundary: 'time', boundaryUncertain: false, runtimeTransitions: ['RECORDING'], tracksStoppedSinceOpen: 0 });
    });

    it('an A change within the margin of the gesture is uncertain (HOLD), never assigned to either window', async () => {
        const a = await aAt(TAKEOVER_BOUNDARY_MARGIN_MS / 2, () => root.setAttribute('data-runtime-state', 'STOPPING'));
        expect(a.boundaryUncertain).toBe(true);
        const b: ObservationClose = { token: 'w-b', boundary: 'gesture', boundaryUncertain: false, gestureAt: 11_000, runtimeTransitions: ['READY'], runtimeNow: 'READY',
            modelTransitions: ['download-required'], modelNow: 'download-required', micAcquisitionsSinceOpen: 0, tracksStoppedSinceOpen: 0, liveTracksAtOpen: 0, liveTracks: 0, recorderVisible: false };
        expect(leaseRefusalWindowVerdict({ observed: true, refusalCopyShown: true, cold: true, modelRequests: 0, a, b }).status).toBe('HOLD');
    });
});
