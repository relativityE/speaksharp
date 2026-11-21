// @vitest-environment jsdom
/**
 * J1 option B (Sam, 21 Nov): takes 3 and 4 are SAVE takes, so they must record past the product's 5 s minimum before Stop.
 * Live run 44955832135 stopped them at ~2 s and the product discarded both. These checks prove the hold's verdict, that the
 * final poll is taken at or after the deadline, that a recorder replaced at any point (including the last interval or just
 * before Stop) neither passes nor receives the Stop, and that only J1 opts in (Focus keeps its probes; the short Stop is unchanged).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    SAVE_HOLD_BUFFER_MS, SAVE_MINIMUM_MS, type SaveHoldDeps, type StopClick,
    holdThenStop, holdThenStopWith, pageSaveHoldDeps, saveHoldVerdict, stopClickVerdict,
} from '../live/helpers/rwtSaveHold';

const src = (f: string) => readFileSync(resolve(__dirname, '../..', f), 'utf8');
const ENOUGH = SAVE_MINIMUM_MS + SAVE_HOLD_BUFFER_MS;
const ok = { same: true, stopEnabled: true };

describe('saveHoldVerdict / stopClickVerdict', () => {
    it('passes only when the LAST validated observation is at or past the minimum plus buffer', () => {
        expect(saveHoldVerdict(0, [{ t: 100, ...ok }, { t: ENOUGH, ...ok }])).toEqual({ ok: true, heldMs: ENOUGH, reason: null });
        for (const t of [2_200, SAVE_MINIMUM_MS, ENOUGH - 1]) {
            expect(saveHoldVerdict(0, [{ t, ...ok }])).toMatchObject({ ok: false, reason: 'the take was not held past the 5 s save minimum' });
        }
    });
    it('a dropped, replaced, unstoppable or unobserved recorder fails whatever the time', () => {
        expect(saveHoldVerdict(0, [{ t: 1, ...ok }, { t: ENOUGH, same: false, stopEnabled: true }])).toMatchObject({ ok: false, reason: 'the recording was dropped or replaced during the hold' });
        expect(saveHoldVerdict(0, [{ t: ENOUGH, same: null, stopEnabled: true }])).toMatchObject({ ok: false });
        expect(saveHoldVerdict(0, [{ t: ENOUGH, same: true, stopEnabled: false }])).toMatchObject({ ok: false, reason: 'the recording stopped being stoppable during the hold' });
        expect(saveHoldVerdict(0, [])).toMatchObject({ ok: false, reason: 'the recording was never observed during the hold' });
    });
    it('only a click on the pinned recorder\'s own Stop completes a good hold', () => {
        const good = { ok: true, heldMs: ENOUGH, reason: null };
        expect(stopClickVerdict(good, 'clicked')).toEqual(good);
        for (const c of ['replaced', 'not-stoppable', 'unreadable', null] as const) expect(stopClickVerdict(good, c).ok).toBe(false);
        const bad = { ok: false, heldMs: 1, reason: 'x' };
        expect(stopClickVerdict(bad, 'clicked')).toBe(bad);
    });
});

describe('holdThenStopWith on a fake clock', () => {
    const fake = (o: { readAt?: (t: number) => { same: boolean; stopEnabled: boolean }; click?: () => StopClick; pin?: boolean } = {}) => {
        let t = 0;
        const reads: number[] = [];
        let clicks = 0;
        const deps: SaveHoldDeps = {
            pin: async () => o.pin ?? true,
            read: async () => { reads.push(t); return o.readAt ? o.readAt(t) : ok; },
            clickPinnedStop: async () => { clicks += 1; return o.click ? o.click() : 'clicked'; },
            now: () => t,
            sleep: async (ms) => { t += ms; },
        };
        return { deps, reads, clicks: () => clicks };
    };
    it('a full hold takes its final poll AT the deadline, then clicks the pinned Stop once', async () => {
        const f = fake();
        const r = await holdThenStopWith(f.deps, 0, 250);
        expect(r).toEqual({ hold: { ok: true, heldMs: ENOUGH, reason: null }, clicked: true });
        expect(f.reads.at(-1)).toBe(ENOUGH);
        expect(f.clicks()).toBe(1);
    });
    it('Sam on b3455e86: a recorder replaced in the FINAL interval fails and receives no Stop', async () => {
        const f = fake({ readAt: (t) => (t >= ENOUGH - 100 ? { same: false, stopEnabled: true } : ok) });
        const r = await holdThenStopWith(f.deps, 0, 250);
        expect(r.hold).toMatchObject({ ok: false, reason: 'the recording was dropped or replaced during the hold' });
        expect(r.clicked).toBe(false);
        expect(f.clicks()).toBe(0);
    });
    it('a recorder replaced between the last poll and the Stop fails at the atomic click', async () => {
        const f = fake({ click: () => 'replaced' });
        const r = await holdThenStopWith(f.deps, 0, 250);
        expect(r).toEqual({ hold: { ok: false, heldMs: ENOUGH, reason: 'the recording was replaced just before Stop' }, clicked: false });
    });
    it('an early Stop never happens: a replacement mid-hold ends it at once, short of the minimum', async () => {
        const f = fake({ readAt: (t) => (t >= 2_000 ? { same: false, stopEnabled: true } : ok) });
        const r = await holdThenStopWith(f.deps, 0, 250);
        expect(r.hold.ok).toBe(false);
        expect(r.hold.heldMs).toBeLessThan(ENOUGH);
        expect(f.clicks()).toBe(0);
    });
    it('no recorder to pin is never a hold, and nothing is clicked', async () => {
        const f = fake({ pin: false });
        expect(await holdThenStopWith(f.deps, 0, 250)).toMatchObject({ hold: { ok: false }, clicked: false });
        expect(f.clicks()).toBe(0);
    });
});

describe('the page seams, against a real DOM', () => {
    const page = { evaluate: (fn: (a: unknown) => unknown, arg: unknown) => Promise.resolve(fn(arg)), waitForTimeout: async () => undefined };
    const bar = () => {
        const el = document.createElement('div');
        el.setAttribute('data-testid', 'recorder-bar');
        const stop = document.createElement('button');
        stop.setAttribute('data-testid', 'recorder-stop');
        let clicked = 0;
        stop.addEventListener('click', () => { clicked += 1; });
        el.appendChild(stop);
        return { el, stop, clicked: () => clicked };
    };
    afterEach(() => { document.body.innerHTML = ''; });
    it('pins the rendered bar, sees it unchanged, and clicks its own Stop', async () => {
        const b = bar();
        document.body.appendChild(b.el);
        const r = await holdThenStop(page as never, Date.now() - ENOUGH - 10);
        expect(r.hold.ok).toBe(true);
        expect(r.clicked).toBe(true);
        expect(b.clicked()).toBe(1);
    });
    it('a bar replaced after pinning is seen as replaced, and the new bar\'s Stop is never clicked', async () => {
        const first = bar();
        document.body.appendChild(first.el);
        const deps = pageSaveHoldDeps(page as never);
        expect(await deps.pin()).toBe(true);
        const second = bar();
        first.el.replaceWith(second.el);
        expect(await deps.read()).toEqual({ same: false, stopEnabled: false });
        expect(await deps.clickPinnedStop()).toBe('replaced');
        expect(second.clicked()).toBe(0);
        expect(first.clicked()).toBe(0);
    });
    it('a disabled Stop on the pinned bar is not stoppable and is not clicked', async () => {
        const b = bar();
        b.stop.disabled = true;
        document.body.appendChild(b.el);
        const deps = pageSaveHoldDeps(page as never);
        expect(await deps.pin()).toBe(true);
        expect(await deps.read()).toEqual({ same: true, stopEnabled: false });
        expect(await deps.clickPinnedStop()).toBe('not-stoppable');
        expect(b.clicked()).toBe(0);
    });
});

describe('wiring: J1 holds takes 3 and 4; Focus and the J1.c short Stop do not', () => {
    const journey = src('tests/live/helpers/rwtJourney.ts');
    const j1 = src('tests/live/rwt-open-mic-first-session.live.spec.ts');
    const focus = src('tests/live/helpers/rwtFocusPointsJourney.ts');
    it('each helper confirms the Stop the hold clicked, falls back to a plain Stop only after a failed hold, and fails its row', () => {
        expect(journey).toContain('const held = opts.holdRepeatPastSaveMinimum && ev.repeatRecordingAt ? await holdThenStop(page, ev.repeatRecordingAt) : null;');
        expect(journey).toContain('if (held?.clicked) await confirmBenchmarkStopped(page, `${label}-again`);');
        expect(journey).toContain('const held = opts.holdPastSaveMinimum ? await holdThenStop(page, recordingAt) : null;');
        expect(journey).toContain('if (held?.clicked) await confirmBenchmarkStopped(page, label);');
        expect(journey).toContain('const offOk = ev.stopped && ev.liveTracksAfterStop === 0 && (ev.saveHold == null || ev.saveHold.ok);');
        expect(journey).toContain('const offOk = next.stopped && next.liveTracksAfterStop === 0 && holdOk;');
        const shortStop = journey.slice(journey.indexOf('export async function shortStopEvidence('), journey.indexOf('export async function shortStopEvidence(') + 4_000);
        expect(shortStop).not.toContain('holdThenStop');
    });
    it('only J1 opts in; Focus calls both helpers without a hold; J1 still designs four saves', () => {
        expect(j1).toContain('holdRepeatPastSaveMinimum: true');
        expect(j1).toContain("nextStartEvidence(page, `${SUITE}-next`, () => captureGate().confirm(), { holdPastSaveMinimum: true })");
        expect(focus).not.toMatch(/holdRepeatPastSaveMinimum|holdPastSaveMinimum|holdThenStop/);
        expect(j1).toContain("const AHT01_DESIGNED_SAVES: readonly TakeSaveExpectation[] = Object.freeze(['saved', 'saved', 'uncaptured', 'uncaptured', 'probe'] as const);");
    });
});
