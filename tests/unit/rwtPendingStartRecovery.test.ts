// AHT-04 `deliberate-recovery-saved`: the recovery take after an abandoned cold Start is driven only from a settled Start or
// Download, and PASSes only when exactly one completed session, bound by the page, keeps its transcript.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    PENDING_START_CONSENT_MODE, type ColdStartPressIo, type RecoveryControl, type RecoveryPressIo, coldStartPress, consentRefusalReason, driveRecoveryPress,
    recoveryPressVerdict, recoveryTakePlan, recoveryTakeVerdict,
} from '../live/helpers/rwtPendingStartRecovery';
import { CONSENT_MODES, captureConsentGate, type ChoiceClient } from '../live/helpers/rwtPracticeConsent';
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
        expect(recovery).toContain('pressOnce: (control, beforeClick) => pressRecoveryControl(page, control, beforeClick),');
        // The guard is armed per attempt and ALWAYS disarmed in finally (Sam, #1869 on c0c085ac).
        const press = spec.slice(spec.indexOf('async function pressRecoveryControl('), spec.indexOf('\n}\n', spec.indexOf('async function pressRecoveryControl(')));
        expect(press).toContain('await target.evaluate(armRecoveryClickGuard, { id: control, recorderStopId: RECORDER_STOP, token });');
        const fin = press.indexOf('} finally {');
        expect(fin).toBeGreaterThan(press.indexOf('target.click('));
        expect(press.slice(fin)).toContain('await page.evaluate(disarmRecoveryClickGuard, token)');
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
            confirmConsent: async () => undefined,
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
    it('a recorder that starts between discovery and activation (caught by the click guard) is the same FAIL, not a HOLD', async () => {
        const presses: RecoveryControl[] = [];
        const io: RecoveryPressIo = {
            recorderPresent: async () => false, offeredControl: async () => 'mic-start',
            pressOnce: async (c) => { presses.push(c); return { activated: false, staleRecorder: true, reason: 'a recorder was running at activation' }; },
            recordingAfterPress: async () => true,
            confirmConsent: async () => undefined,
        };
        const out = await driveRecoveryPress(io, 'mic-start');
        expect(out).toEqual({ kind: 'stale-recorder' });
        expect(recoveryPressVerdict(out)?.status).toBe('FAIL');
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

// J5.a (#1835, Sam Nov 20): no proven choice, no press. The owner's own row is read back immediately before EACH capture-capable
// press: the cold Start it abandons, and the recovery press on return.
describe('J5.a consent before every capture-capable press', () => {
    const spec = readFileSync(path.resolve(here, '../live/rwt-pending-start-navigation.live.spec.ts'), 'utf8');
    const OWNER = 'owner-1';
    const SAVE_ON = { user_id: OWNER, transcript_save: true, ai_coaching: false, consent_version: 1 };
    /** The owner's row as the server returns it right now: a row, none, or an unreadable answer. */
    const clientOf = (current: { row: Record<string, unknown> | null | 'broken' }): ChoiceClient => ({
        from: () => ({
            select: () => ({
                eq: () => ({ maybeSingle: async () => current.row === 'broken' ? { data: null, error: { code: '57014' } } : { data: current.row, error: null } }),
                limit: async () => ({ data: [], error: null }),
            }),
        }),
    });
    const gateOver = (current: { row: Record<string, unknown> | null | 'broken' }) => {
        const rows: Array<{ status: string; reason: string }> = [];
        const gate = captureConsentGate({ consent: { build: 'includes_1835', choice: CONSENT_MODES.save_on, mode: 'save_on' }, client: clientOf(current),
            ownerId: OWNER, mode: PENDING_START_CONSENT_MODE, record: (status, _d, e) => rows.push({ status, reason: e.reason }) });
        return { gate, rows };
    };
    /** The recovery press with the real gate as its consent step; counts the presses that actually happened. */
    /**
     * The recovery press modelled as the spec's pressRecoveryControl: setup (find the control, the human reflex, arm the guard;
     * `duringSetup` runs here), then `beforeClick`, then the click. A refusal returns `consentUnproven` and clicks nothing.
     */
    const recoveryOver = (confirmConsent: () => Promise<void>, duringSetup: () => void = () => undefined) => {
        const presses: RecoveryControl[] = [];
        const io: RecoveryPressIo = {
            recorderPresent: async () => false, offeredControl: async () => 'mic-start',
            pressOnce: async (c, beforeClick) => {
                duringSetup();
                try { await beforeClick(); } catch (error) { return { activated: false, consentUnproven: consentRefusalReason(error) }; }
                presses.push(c);
                return { activated: true };
            },
            recordingAfterPress: async () => true, confirmConsent,
        };
        return { io, presses };
    };

    it('the fixed choice is Save: Yes, Coaching: No (the recovery keeps its transcript; coaching is only a ceiling)', () => {
        expect(CONSENT_MODES[PENDING_START_CONSENT_MODE]).toEqual({ transcriptSave: true, aiCoaching: false });
        expect(spec).not.toMatch(/consentModeFrom|RWT_PRACTICE_CONSENT/);
    });

    it('the prompt is settled on Practice before Open Mic, and the cold Start is confirmed the statement before its press', () => {
        const practice = spec.indexOf("await page.goto('/practice');");
        const settle = spec.indexOf('const consent = await settleFixedConsentOnPractice({');
        expect(settle).toBeGreaterThan(practice);
        expect(settle).toBeLessThan(spec.indexOf("await openProductsItem(page, 'open-mic');"));
        // A settle failure halts before any press.
        expect(spec.slice(settle, spec.indexOf("await openProductsItem(page, 'open-mic');"))).toMatch(/\} catch \{\n\s*receipt\.halt\('practice consent'[^\n]*\n\s*return;/);
        // The cold Start goes through coldStartPress (ready → think-time → readback → click) with the gate as its consent step;
        // a refusal halts with no click, and the one cold click is an ElementHandle click inside it (no locator pause after the readback).
        const cold = spec.slice(spec.indexOf('const cold = await coldStartPress({'), spec.indexOf('consentGate.recordPass();', spec.indexOf('const cold = await coldStartPress({')));
        expect(cold).toContain("coldControl.handle = await page.getByTestId('mic-download').elementHandle({ timeout: 15_000 })");
        expect(cold).toContain('reflex: () => new Promise((resolve) => setTimeout(resolve, activeHumanReflexMs())),');
        expect(cold).toContain('confirmConsent: () => consentGate.confirm(),');
        expect(cold).toContain('coldControl.handle.click({ timeout: 15_000 })');
        expect(cold).toMatch(/if \(cold\.kind === 'consent-unproven'\) \{\n\s*receipt\.halt\('practice consent'[^\n]*\n\s*return;/);
        expect(spec).not.toContain("getByTestId('mic-download').click(");
        // The recovery press gets the same gate as its consent step, run INSIDE the press: after the guard is armed (the 60 s
        // control wait and the human reflex come before that) and as the statement directly before the click.
        expect(spec).toContain('confirmConsent: () => consentGate.confirm(),');
        expect(spec).toContain('pressOnce: (control, beforeClick) => pressRecoveryControl(page, control, beforeClick),');
        const press = spec.slice(spec.indexOf('async function pressRecoveryControl('), spec.indexOf('\n}\n', spec.indexOf('async function pressRecoveryControl(')));
        expect(press.indexOf('const found = await page.waitForFunction(')).toBeLessThan(press.indexOf('await new Promise((resolve) => setTimeout(resolve, reflexMs));'));
        expect(press).toMatch(/await target\.evaluate\(armRecoveryClickGuard, \{ id: control, recorderStopId: RECORDER_STOP, token \}\);\n(\s*\/\/[^\n]*\n)?\s*try \{ await beforeClick\(\); \} catch \(error\) \{ return \{ activated: false, consentUnproven: consentRefusalReason\(error\) \}; \}\n\s*const clicked = await target\.click\(/);
        expect(press.split('target.click(').length - 1).toBe(1);
    });

    it('CONTROL: no saved choice means zero first presses (the cold Start confirm refuses)', async () => {
        const { gate, rows } = gateOver({ row: null });
        let pressed = 0;
        await gate.confirm().then(() => { pressed += 1; }, () => undefined);
        expect(pressed).toBe(0);
        expect(rows).toEqual([{ status: 'FAIL', reason: 'readback_missing' }]);
    });

    it('CONTROL: a valid first choice, then changed or unreadable on return, means zero recovery presses', async () => {
        for (const [changed, reason] of [[{ ...SAVE_ON, transcript_save: false }, 'readback_differs'], [{ ...SAVE_ON, ai_coaching: true }, 'readback_differs'],
            [null, 'readback_missing'], ['broken', 'readback_unreadable'], [{ ...SAVE_ON, user_id: 'someone-else' }, 'readback_wrong_owner']] as const) {
            const current: { row: Record<string, unknown> | null | 'broken' } = { row: { ...SAVE_ON } };
            const { gate, rows } = gateOver(current);
            await gate.confirm();          // the cold Start's confirm passes
            gate.recordPass();             // ...and that press is the one recorded PASS
            current.row = changed as never; // the owner's row changes before the return
            const { io, presses } = recoveryOver(() => gate.confirm());
            const out = await driveRecoveryPress(io, 'mic-start');
            expect({ reason, presses: presses.length, out }).toEqual({ reason, presses: 0, out: { kind: 'consent-unproven', control: 'mic-start', reason } });
            expect(recoveryPressVerdict(out)).toMatchObject({ status: 'HOLD' });
            expect(rows).toEqual([{ status: 'PASS', reason: 'choice_recorded' }]); // recorded once; the later refusal throws, not re-recorded
        }
    });

    it('the consent step runs inside the press: after its setup and immediately before the click', async () => {
        const order: string[] = [];
        const io: RecoveryPressIo = {
            recorderPresent: async () => { order.push('recorder'); return false; }, offeredControl: async () => { order.push('control'); return 'mic-start'; },
            confirmConsent: async () => { order.push('consent'); },
            pressOnce: async (_c, beforeClick) => { order.push('setup'); await beforeClick(); order.push('click'); return { activated: true }; },
            recordingAfterPress: async () => { order.push('recording'); return true; },
        };
        expect(await driveRecoveryPress(io, 'mic-start')).toEqual({ kind: 'recorded', control: 'mic-start' });
        expect(order).toEqual(['recorder', 'control', 'setup', 'consent', 'click', 'recording']);
    });

    it('CONTROL (Sam, Nov 20): consent that changes DURING the press setup emits the recovery HOLD and dispatches zero clicks', async () => {
        for (const [changed, reason] of [[{ ...SAVE_ON, transcript_save: false }, 'readback_differs'], [null, 'readback_missing'], ['broken', 'readback_unreadable']] as const) {
            const current: { row: Record<string, unknown> | null | 'broken' } = { row: { ...SAVE_ON } };
            const { gate } = gateOver(current);
            await gate.confirm();
            gate.recordPass();
            // Valid when the press starts (stale-recorder and control checks pass); it changes while the press waits and arms.
            const { io, presses } = recoveryOver(() => gate.confirm(), () => { current.row = changed as never; });
            const out = await driveRecoveryPress(io, 'mic-start');
            expect({ reason, clicks: presses.length, out }).toEqual({ reason, clicks: 0, out: { kind: 'consent-unproven', control: 'mic-start', reason } });
            expect(recoveryPressVerdict(out)).toMatchObject({ status: 'HOLD' });
        }
    });

    describe('the cold Start press (Sam, Nov 20): ready → think-time → readback → click', () => {
        const coldOver = (confirmConsent: () => Promise<void>, o: { ready?: boolean; duringReflex?: () => void } = {}) => {
            const order: string[] = [];
            const io: ColdStartPressIo = {
                ready: async () => { order.push('ready'); return o.ready !== false; },
                reflex: async () => { order.push('reflex'); o.duringReflex?.(); },
                confirmConsent: async () => { order.push('consent'); await confirmConsent(); },
                click: async () => { order.push('click'); return true; },
            };
            return { io, order };
        };
        it('the readback is the last step before the click, after readiness and the human-reflex pause', async () => {
            const { gate } = gateOver({ row: { ...SAVE_ON } });
            const { io, order } = coldOver(() => gate.confirm());
            expect(await coldStartPress(io)).toEqual({ kind: 'pressed' });
            expect(order).toEqual(['ready', 'reflex', 'consent', 'click']);
        });
        it('CONTROL: consent that changes DURING the think-time pause dispatches zero clicks', async () => {
            for (const [changed, reason] of [[{ ...SAVE_ON, transcript_save: false }, 'readback_differs'], [null, 'readback_missing'], ['broken', 'readback_unreadable']] as const) {
                const current: { row: Record<string, unknown> | null | 'broken' } = { row: { ...SAVE_ON } };
                const { gate } = gateOver(current);
                const { io, order } = coldOver(() => gate.confirm(), { duringReflex: () => { current.row = changed as never; } });
                expect({ reason, out: await coldStartPress(io) }).toEqual({ reason, out: { kind: 'consent-unproven', reason } });
                expect(order).not.toContain('click');
            }
        });
        it('a control that is not ready is never pressed, and no readback is spent on it', async () => {
            const { gate } = gateOver({ row: { ...SAVE_ON } });
            const { io, order } = coldOver(() => gate.confirm(), { ready: false });
            expect(await coldStartPress(io)).toEqual({ kind: 'not-ready' });
            expect(order).toEqual(['ready']);
        });
    });
});
