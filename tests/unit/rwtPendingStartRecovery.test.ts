// AHT-04 `deliberate-recovery-saved`: the recovery take after an abandoned cold Start is driven only from a settled Start or
// Download, and PASSes only when exactly one completed session, bound by the page, keeps its transcript.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { recoveryTakePlan, recoveryTakeVerdict } from '../live/helpers/rwtPendingStartRecovery';
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
        const take = spec.indexOf("startBenchmarkRecording(page, 'pending-start-recovery')");
        const verdict = spec.indexOf('recoveryTakeVerdict(priorIds, rows, recoveryId)');
        expect(returnRow).toBeGreaterThan(0);
        expect(returnRow).toBeLessThan(faultOff);
        expect(faultOff).toBeLessThan(plan);
        expect(plan).toBeLessThan(take);
        expect(take).toBeLessThan(verdict);
        expect(spec.match(/'deliberate recovery take saved'/g)).toHaveLength(2);
    });
    it('raises the Start budget to the two designed presses and lets only the recovery session ask for coaching', () => {
        expect(spec).toContain("{ total: 2, perControl: { 'mic-download': 2, 'mic-start': 1 } }");
        expect(spec).toContain('recoveryId ? { maximum: 1, oneRequestPerSession: [recoveryId] } : { maximum: 0 }');
        expect(spec).toContain('test.setTimeout(2_400_000);');
    });
});
