// AHT-04 `deliberate-recovery-saved`: the recovery take after an abandoned cold Start is driven only from a settled Start or
// Download, and PASSes only when exactly one completed session, bound by the page, keeps its transcript.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    type RecoveryControl, type RecoveryPressIo, driveRecoveryPress, recoveryPressVerdict, recoveryTakePlan, recoveryTakeVerdict,
} from '../live/helpers/rwtPendingStartRecovery';
import type { SessionRowFacts } from '../live/helpers/rwtSaveRetry';

const here = path.dirname(fileURLToPath(import.meta.url));
const row = (over: Partial<SessionRowFacts> = {}): SessionRowFacts => ({
    id: 's1', status: 'completed', hasIdempotencyKey: true, transcriptState: 'available', transcriptLength: 120, ...over,
});

describe('recoveryTakePlan', () => {
    it('drives the take from a settled Start or Download', () => {
        expect(recoveryTakePlan(true, 'mic-start')).toEqual({ drive: true, control: 'mic-start' });
        expect(recoveryTakePlan(true, 'mic-download')).toEqual({ drive: true, control: 'mic-download' });
    });
    it('HOLDs, and presses nothing, when the return never settled', () => {
        const plan = recoveryTakePlan(false, 'mic-start');
        expect(plan.drive).toBe(false);
        expect(!plan.drive && plan.verdict.status).toBe('HOLD');
        expect(recoveryTakePlan(true, null).drive).toBe(false);
    });
    it('HOLDs on a Retry return (a model failure is not the deliberate recovery) and on an unknown control', () => {
        const retry = recoveryTakePlan(true, 'mic-retry');
        expect(!retry.drive && retry.verdict).toMatchObject({ status: 'HOLD', detail: expect.stringMatching(/Retry/) });
        expect(recoveryTakePlan(true, 'session-start-stop-button').drive).toBe(false);
    });
});

describe('recoveryTakeVerdict', () => {
    it('one completed, keyed row bound by the page with its transcript → PASS', () => {
        expect(recoveryTakeVerdict([], [row()], 's1').status).toBe('PASS');
    });
    it('a session left over from the abandoned Start → FAIL, even when the take itself saved', () => {
        expect(recoveryTakeVerdict(['old'], [row({ id: 'old' }), row()], 's1').status).toBe('FAIL');
    });
    it('no saved identity bound → FAIL', () => {
        expect(recoveryTakeVerdict([], [row()], null)).toMatchObject({ status: 'FAIL', detail: expect.stringMatching(/recovery take/) });
    });
    it('two rows, the wrong row, not completed, no key, or no transcript → FAIL', () => {
        expect(recoveryTakeVerdict([], [row(), row({ id: 's2' })], 's1').status).toBe('FAIL');
        expect(recoveryTakeVerdict([], [row({ id: 's2' })], 's1').status).toBe('FAIL');
        expect(recoveryTakeVerdict([], [row({ status: 'pending' })], 's1').status).toBe('FAIL');
        expect(recoveryTakeVerdict([], [row({ hasIdempotencyKey: false })], 's1').status).toBe('FAIL');
        expect(recoveryTakeVerdict([], [row({ transcriptState: 'expired', transcriptLength: 0 })], 's1').status).toBe('FAIL');
        expect(recoveryTakeVerdict([], [], 's1').status).toBe('FAIL');
    });
});

describe('the AHT-04 spec wiring', () => {
    const spec = readFileSync(path.resolve(here, '../live/rwt-pending-start-navigation.live.spec.ts'), 'utf8');
    it('runs the recovery take after the return is judged, outside the fault phase, and writes its row', () => {
        const returnRow = spec.indexOf("receipt.row('return does not resume abandoned recording'");
        const faultOff = spec.indexOf('watch.setFaultPhase(false);');
        const plan = spec.indexOf('recoveryTakePlan(returned.settled');
        const take = spec.indexOf('const pressed = await driveRecoveryPress({');
        const verdict = spec.indexOf('recoveryTakeVerdict(priorIds, rows, recoveryId)');
        expect(returnRow).toBeGreaterThan(0);
        expect(returnRow).toBeLessThan(faultOff);
        expect(faultOff).toBeLessThan(plan);
        expect(plan).toBeLessThan(take);
        expect(take).toBeLessThan(verdict);
        expect(spec.match(/'deliberate recovery take saved'/g)).toHaveLength(3);
    });
    it('the recovery uses the guarded driver: no engine-ready wait, no generic Start helper, a press verdict before speech', () => {
        const recovery = spec.slice(spec.indexOf('const priorIds = await readSessionIds(uid);'), spec.indexOf('recoveryTakeVerdict(priorIds, rows, recoveryId)'));
        expect(spec).not.toContain('waitForPrivateEngineReady');
        expect(recovery).not.toMatch(/startBenchmarkRecording|preparePrivateModelIfPrompted/);
        const drive = recovery.indexOf('const pressed = await driveRecoveryPress({');
        const verdict = recovery.indexOf('const pressVerdict = recoveryPressVerdict(pressed);');
        const row = recovery.indexOf("receipt.row('deliberate recovery take saved', pressVerdict.status, pressVerdict.detail,");
        const speak = recovery.indexOf('await page.waitForTimeout(Math.round((fixture.entry.speechSeconds + 4) * 1000));');
        for (const [x, y] of [[drive, verdict], [verdict, row], [row, speak]]) { expect(x).toBeGreaterThan(-1); expect(y).toBeGreaterThan(x); }
        expect(recovery).toContain('pressOnce: (control) => pressRecoveryControl(page, control),');
        expect(recovery).toContain('}, plan.control);');
    });
    it('raises the Start budget to the two designed presses and lets only the recovery session ask for coaching', () => {
        expect(spec).toContain("{ total: 2, perControl: { 'mic-download': 2, 'mic-start': 1 } }");
        expect(spec).toContain('recoveryId ? { maximum: 1, oneRequestPerSession: [recoveryId] } : { maximum: 0 }');
        expect(spec).toContain('test.setTimeout(2_400_000);');
    });
});

// Sam, 2026-11-15 (#1869 on 26896492): behavioural controls for the recovery press, on a fake page.
describe('driveRecoveryPress: one observed activation of the planned control, then a recording', () => {
    function page(o: { recorder?: boolean | 'throws'; offered?: string | null; activated?: boolean | 'throws'; records?: boolean }) {
        const presses: RecoveryControl[] = [];
        const io: RecoveryPressIo = {
            recorderPresent: async () => { if (o.recorder === 'throws') throw new Error('unreadable'); return o.recorder === true; },
            offeredControl: async () => (o.offered === undefined ? null : o.offered),
            pressOnce: async (control) => {
                presses.push(control);
                if (o.activated === 'throws') throw new Error('click failed');
                return o.activated === false ? { activated: false, reason: 'the click did not reach the planned control' } : { activated: true };
            },
            recordingAfterPress: async () => o.records === true,
        };
        return { io, presses };
    }
    it('warm success: the planned Start is pressed once and recording follows → no press verdict (the save decides)', async () => {
        const p = page({ offered: 'mic-start', records: true });
        const out = await driveRecoveryPress(p.io, 'mic-start');
        expect(out).toEqual({ kind: 'recorded', control: 'mic-start' });
        expect(recoveryPressVerdict(out)).toBeNull();
        expect(p.presses).toEqual(['mic-start']);
    });
    it('cold success: the planned Download is pressed once and recording follows', async () => {
        const p = page({ offered: 'mic-download', records: true });
        expect(await driveRecoveryPress(p.io, 'mic-download')).toEqual({ kind: 'recorded', control: 'mic-download' });
        expect(p.presses).toEqual(['mic-download']);
    });
    it('the model flips to Retry (or any other control) before the press: nothing is pressed, HOLD, no recovery credit', async () => {
        for (const offered of ['mic-retry', 'mic-download', null]) {
            const p = page({ offered, records: true });
            const out = await driveRecoveryPress(p.io, 'mic-start');
            expect(out).toEqual({ kind: 'control-changed', planned: 'mic-start', offered });
            expect(recoveryPressVerdict(out)?.status).toBe('HOLD');
            expect(p.presses).toEqual([]);
        }
    });
    it('a recorder already running (or an unreadable check) is no deliberate recovery: FAIL, nothing pressed', async () => {
        for (const recorder of [true, 'throws'] as const) {
            const p = page({ recorder, offered: 'mic-start', records: true });
            const out = await driveRecoveryPress(p.io, 'mic-start');
            expect(out).toEqual({ kind: 'stale-recorder' });
            expect(recoveryPressVerdict(out)).toEqual({ status: 'FAIL', detail: expect.stringMatching(/already running before the recovery press/) });
            expect(p.presses).toEqual([]);
        }
    });
    it('an unobserved or failed activation is HOLD, never credit, and is not retried', async () => {
        for (const activated of [false, 'throws'] as const) {
            const p = page({ offered: 'mic-start', activated, records: true });
            const out = await driveRecoveryPress(p.io, 'mic-start');
            expect(out.kind).toBe('press-unobserved');
            expect(recoveryPressVerdict(out)?.status).toBe('HOLD');
            expect(p.presses).toEqual(['mic-start']);
        }
    });
    it('a proven press that never records is the named FAIL (not a harness timeout), for Start and for a cold Download', async () => {
        for (const control of ['mic-start', 'mic-download'] as const) {
            const p = page({ offered: control, records: false });
            const out = await driveRecoveryPress(p.io, control);
            expect(out).toEqual({ kind: 'pressed-no-recording', control });
            expect(recoveryPressVerdict(out)).toEqual({ status: 'FAIL', detail: `a proven press of ${control} for the recovery take did not start recording` });
        }
    });
});
