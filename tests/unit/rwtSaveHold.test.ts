// @vitest-environment node
/**
 * J1 option B (Sam, 21 Nov): takes 3 and 4 are SAVE takes, so they must record past the product's 5 s minimum before Stop.
 * Live run 44955832135 stopped them at ~2 s and the product discarded both. These checks prove the hold's verdict, that an
 * early end or a dropped / replaced recorder never counts as a completed hold, and that only J1 opts in (Focus keeps its probes).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SAVE_HOLD_BUFFER_MS, SAVE_MINIMUM_MS, holdPastSaveMinimum, saveHoldVerdict } from '../live/helpers/rwtJourney';

const src = (f: string) => readFileSync(resolve(__dirname, '../..', f), 'utf8');
const live = { connected: true, stopEnabled: true };
const ENOUGH = SAVE_MINIMUM_MS + SAVE_HOLD_BUFFER_MS;

describe('saveHoldVerdict: only a full hold of the same live recording passes', () => {
    it('passes at the minimum plus buffer with every poll live', () => {
        expect(saveHoldVerdict(ENOUGH, [live, live, live])).toEqual({ ok: true, heldMs: ENOUGH, reason: null });
    });
    it('an early Stop (held under 5 s + buffer) fails, including the ~2 s of run 44955832135', () => {
        for (const ms of [2_200, SAVE_MINIMUM_MS, ENOUGH - 1]) {
            expect(saveHoldVerdict(ms, [live])).toMatchObject({ ok: false, reason: 'the take was not held past the 5 s save minimum' });
        }
    });
    it('a dropped or replaced recorder, an unstoppable one, or no observation fails whatever the time', () => {
        expect(saveHoldVerdict(ENOUGH, [live, { connected: false, stopEnabled: true }])).toMatchObject({ ok: false, reason: 'the recording was dropped or replaced during the hold' });
        expect(saveHoldVerdict(ENOUGH, [live, { connected: null, stopEnabled: true }])).toMatchObject({ ok: false });
        expect(saveHoldVerdict(ENOUGH, [{ connected: true, stopEnabled: false }])).toMatchObject({ ok: false, reason: 'the recording stopped being stoppable during the hold' });
        expect(saveHoldVerdict(ENOUGH, [{ connected: true, stopEnabled: null }])).toMatchObject({ ok: false });
        expect(saveHoldVerdict(ENOUGH, [])).toMatchObject({ ok: false, reason: 'the recording was never observed during the hold' });
    });
});

describe('holdPastSaveMinimum on a fake page', () => {
    const fakePage = (o: { connected: () => boolean; stopEnabled: () => boolean; bar?: boolean }) => {
        let disposed = false;
        const handle = { evaluate: async () => o.connected(), dispose: async () => { disposed = true; } };
        const page = {
            getByTestId: (id: string) => id === 'recorder-stop' || id.includes('stop')
                ? { isEnabled: async () => o.stopEnabled() }
                : { elementHandle: async () => (o.bar === false ? null : handle) },
            waitForTimeout: (ms: number) => new Promise((r) => setTimeout(r, Math.min(ms, 5))),
        };
        return { page, disposed: () => disposed };
    };
    it('holds the same live recorder until the minimum plus buffer has passed, then disposes its handle', async () => {
        const f = fakePage({ connected: () => true, stopEnabled: () => true });
        const hold = await holdPastSaveMinimum(f.page as never, Date.now() - ENOUGH + 30, 5);
        expect(hold.ok).toBe(true);
        expect(hold.heldMs).toBeGreaterThanOrEqual(ENOUGH);
        expect(f.disposed()).toBe(true);
    });
    it('a recorder that is replaced mid-hold ends the hold at once as a failure', async () => {
        let n = 0;
        const f = fakePage({ connected: () => (n += 1) < 3, stopEnabled: () => true });
        const hold = await holdPastSaveMinimum(f.page as never, Date.now(), 5);
        expect(hold).toMatchObject({ ok: false, reason: 'the recording was dropped or replaced during the hold' });
        expect(hold.heldMs).toBeLessThan(ENOUGH);
    });
    it('no recorder at the start is never a hold', async () => {
        const f = fakePage({ connected: () => true, stopEnabled: () => true, bar: false });
        expect(await holdPastSaveMinimum(f.page as never, Date.now() - ENOUGH, 5)).toMatchObject({ ok: false });
    });
});

describe('wiring: J1 holds takes 3 and 4; Focus and the J1.c short Stop do not', () => {
    const journey = src('tests/live/helpers/rwtJourney.ts');
    const j1 = src('tests/live/rwt-open-mic-first-session.live.spec.ts');
    const focus = src('tests/live/helpers/rwtFocusPointsJourney.ts');
    it('each helper holds before its Stop, only when asked, and a failed hold fails its stopped row', () => {
        const again = journey.indexOf("ev.saveHold = opts.holdRepeatPastSaveMinimum && ev.repeatRecordingAt ? await holdPastSaveMinimum(page, ev.repeatRecordingAt) : null;");
        expect(again).toBeGreaterThan(0);
        expect(journey.indexOf('await stopBenchmarkRecording(page, `${label}-again`);', again)).toBeGreaterThan(again);
        const next = journey.indexOf('const saveHold = opts.holdPastSaveMinimum ? await holdPastSaveMinimum(page, recordingAt) : null;');
        expect(next).toBeGreaterThan(0);
        expect(journey.indexOf('await stopBenchmarkRecording(page, label);', next)).toBeGreaterThan(next);
        expect(journey).toContain("const offOk = ev.stopped && ev.liveTracksAfterStop === 0 && (ev.saveHold == null || ev.saveHold.ok);");
        expect(journey).toContain('const offOk = next.stopped && next.liveTracksAfterStop === 0 && holdOk;');
        // The short Stop never holds.
        const shortStop = journey.slice(journey.indexOf('export async function shortStopEvidence('), journey.indexOf('export async function shortStopEvidence(') + 4_000);
        expect(shortStop).not.toContain('holdPastSaveMinimum');
    });
    it('only J1 opts in; Focus calls both helpers without a hold', () => {
        expect(j1).toContain('holdRepeatPastSaveMinimum: true');
        expect(j1).toContain("nextStartEvidence(page, `${SUITE}-next`, () => captureGate().confirm(), { holdPastSaveMinimum: true })");
        expect(focus).not.toMatch(/holdRepeatPastSaveMinimum|holdPastSaveMinimum/);
        // J1's design still expects takes 3 and 4 to save; nothing was relabelled.
        expect(j1).toContain("const AHT01_DESIGNED_SAVES: readonly TakeSaveExpectation[] = Object.freeze(['saved', 'saved', 'uncaptured', 'uncaptured', 'probe'] as const);");
    });
});
