// @vitest-environment node
/**
 * #1258 R2 (row 16) — the leaving/returning and two-tab live spec's verdicts, each with the failing controls a real run
 * could produce, and the guards that keep the spec, the acceptance map and the product's copy in step.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    BLOCKED_COPY, CLOUD_STT_REQUEST, DISPLACED_COPY, SAME_BROWSER_TAB_COPY, type TabState, TWO_TAB_SUITE,
    nextTakeOnlyItselfVerdict, noCloudVerdict, recoveryNoticeVerdict, releasedVerdict, returnStartVerdict,
    secondTabBlockedVerdict, takeOverRowsVerdict, takeOverVerdict,
} from '../live/helpers/rwtAbandonTakeover';
import {
    ABANDON_CLOSE_TAB_SUITE, ABANDON_NAVIGATE_SUITE, requiredAutomatedRows, requiredHumanObservations,
} from '../live/helpers/rwtAcceptance';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');
const idle: TabState = { runtimeState: 'READY', recorderVisible: false, liveTracks: 0 };
const live: TabState = { runtimeState: 'RECORDING', recorderVisible: true, liveTracks: 1 };

describe('releasedVerdict — leaving ends the recording and the microphone', () => {
    it('nothing records and no track is live → PASS', () => { expect(releasedVerdict(idle, 'after leaving').status).toBe('PASS'); });
    it('a live track, a recorder, or a RECORDING state → FAIL', () => {
        expect(releasedVerdict({ ...idle, liveTracks: 1 }, 'x').detail).toMatch(/microphone track is still live/);
        expect(releasedVerdict({ ...idle, recorderVisible: true }, 'x').status).toBe('FAIL');
        expect(releasedVerdict({ ...idle, runtimeState: 'RECORDING' }, 'x').status).toBe('FAIL');
    });
});

describe('returnStartVerdict — Start on return records, or says why and records on the explicit second press', () => {
    it('records at once → PASS; refused truthfully then records → PASS', () => {
        expect(returnStartVerdict({ firstPressRecorded: true, refusalCopyShown: false, secondPressRecorded: null }).status).toBe('PASS');
        expect(returnStartVerdict({ firstPressRecorded: false, refusalCopyShown: true, secondPressRecorded: true }).status).toBe('PASS');
    });
    it('a silent refusal, or a truthful refusal whose take-over never records → FAIL', () => {
        expect(returnStartVerdict({ firstPressRecorded: false, refusalCopyShown: false, secondPressRecorded: null }).detail).toMatch(/no truthful reason/);
        expect(returnStartVerdict({ firstPressRecorded: false, refusalCopyShown: true, secondPressRecorded: false }).status).toBe('FAIL');
    });
});

describe('recoveryNoticeVerdict — the notice tells the truth about the abandoned take', () => {
    it('no notice, or a notice for a known state that claims no transcript → PASS', () => {
        expect(recoveryNoticeVerdict({ shown: false, state: null, claimsSavedTranscript: false }).status).toBe('PASS');
        expect(recoveryNoticeVerdict({ shown: true, state: 'active_interrupted', claimsSavedTranscript: false }).status).toBe('PASS');
        expect(recoveryNoticeVerdict({ shown: true, state: 'finalized_pending_save', claimsSavedTranscript: false }).status).toBe('PASS');
    });
    it('an unknown state, or a claim that a transcript was saved → FAIL', () => {
        expect(recoveryNoticeVerdict({ shown: true, state: 'interrupted', claimsSavedTranscript: false }).status).toBe('FAIL');
        expect(recoveryNoticeVerdict({ shown: true, state: 'active_interrupted', claimsSavedTranscript: true }).status).toBe('FAIL');
    });
    it('the states it accepts are the recovery draft\'s own', () => {
        const draft = src('frontend/src/services/sessionRecoveryDraft.ts');
        expect(draft).toContain("export type RecoveryState = 'finalized_pending_save' | 'active_interrupted';");
    });
});

describe('nextTakeOnlyItselfVerdict — one new completed row, none left active', () => {
    const before = [{ id: 'abandoned', status: 'active' }];
    it('the abandoned take closed and one new completed row bound by the page → PASS', () => {
        expect(nextTakeOnlyItselfVerdict(before, [{ id: 'abandoned', status: 'failed' }, { id: 'next', status: 'completed' }], 'next').status).toBe('PASS');
    });
    it('the abandoned take left active (orphan) → FAIL', () => {
        expect(nextTakeOnlyItselfVerdict(before, [{ id: 'abandoned', status: 'active' }, { id: 'next', status: 'completed' }], 'next').detail)
            .toMatch(/still active/);
    });
    it('two new rows, an unbound or different row, or an uncompleted take → FAIL', () => {
        expect(nextTakeOnlyItselfVerdict(before, [...before, { id: 'next', status: 'completed' }, { id: 'extra', status: 'completed' }], 'next').status).toBe('FAIL');
        expect(nextTakeOnlyItselfVerdict(before, [{ id: 'next', status: 'completed' }], null).status).toBe('FAIL');
        expect(nextTakeOnlyItselfVerdict(before, [{ id: 'other', status: 'completed' }], 'next').status).toBe('FAIL');
        expect(nextTakeOnlyItselfVerdict(before, [{ id: 'next', status: 'failed' }], 'next').status).toBe('FAIL');
    });
});

describe('two tabs — refused truthfully, one engine after the take-over, both takes closed', () => {
    it('the refused tab starts nothing while the first keeps recording → PASS; any leak → FAIL', () => {
        expect(secondTabBlockedVerdict({ refusalCopyShown: true, tabB: idle, tabA: live }).status).toBe('PASS');
        expect(secondTabBlockedVerdict({ refusalCopyShown: false, tabB: idle, tabA: live }).status).toBe('FAIL');
        expect(secondTabBlockedVerdict({ refusalCopyShown: true, tabB: { ...idle, liveTracks: 1 }, tabA: live }).status).toBe('FAIL');
        expect(secondTabBlockedVerdict({ refusalCopyShown: true, tabB: idle, tabA: idle }).detail).toMatch(/first tab stopped/);
    });
    it('B records and A stopped and said why → PASS; two engines, none, or a silent stop → FAIL', () => {
        expect(takeOverVerdict({ tabA: idle, tabB: live, displacedCopyShown: true }).status).toBe('PASS');
        expect(takeOverVerdict({ tabA: live, tabB: live, displacedCopyShown: true }).detail).toMatch(/still recording/);
        expect(takeOverVerdict({ tabA: idle, tabB: idle, displacedCopyShown: true }).status).toBe('FAIL');
        expect(takeOverVerdict({ tabA: idle, tabB: live, displacedCopyShown: false }).detail).toMatch(/did not say/);
    });
    it('both takes saved and none active → PASS; an active orphan or an unsaved displaced take → FAIL', () => {
        const done = [{ id: 'a', status: 'completed' }, { id: 'b', status: 'completed' }];
        expect(takeOverRowsVerdict(done, 'a', 'b').status).toBe('PASS');
        expect(takeOverRowsVerdict([{ id: 'a', status: 'active' }, { id: 'b', status: 'completed' }], 'a', 'b').status).toBe('FAIL');
        expect(takeOverRowsVerdict(done, null, 'b').detail).toMatch(/no saved session was bound/);
        expect(takeOverRowsVerdict([{ id: 'a', status: 'failed' }, { id: 'b', status: 'completed' }], 'a', 'b').status).toBe('FAIL');
    });
    it('any Cloud STT request → FAIL', () => {
        expect(noCloudVerdict(0).status).toBe('PASS');
        expect(noCloudVerdict(1).status).toBe('FAIL');
        expect(CLOUD_STT_REQUEST.test('https://x.supabase.co/functions/v1/assemblyai-token')).toBe(true);
        expect(CLOUD_STT_REQUEST.test('wss://streaming.assemblyai.com/v3/ws')).toBe(true);
    });
});

describe('guards — the spec, the acceptance map and the product copy stay in step', () => {
    const spec = src('tests/live/rwt-abandon-and-two-tabs.live.spec.ts');
    const written = `${spec}\n${src('tests/live/helpers/rwtDisposableAccount.ts')}`;

    it('the refusal and take-over copy is the product\'s own', () => {
        const policy = src('frontend/src/services/recordingLeasePolicy.ts');
        expect(policy).toContain(DISPLACED_COPY);
        expect(policy).toContain('Stop it there, or press Start again to take over here');
        expect(BLOCKED_COPY.test('A recording is active on another device. Stop it there, or press Start again to take over here')).toBe(true);
        for (const f of ['frontend/src/hooks/useSessionLifecycle.ts', 'frontend/src/services/SpeechRuntimeController.ts']) {
            const line = /'⛔ (Active session in another tab\.[^']*)'/.exec(src(f))?.[1] ?? '';
            expect({ f, matches: SAME_BROWSER_TAB_COPY.test(line) }).toEqual({ f, matches: true });
        }
    });

    it('every suite is known, fully automated, and requires each row the spec writes plus its own cleanup', () => {
        for (const suite of [ABANDON_NAVIGATE_SUITE, ABANDON_CLOSE_TAB_SUITE, TWO_TAB_SUITE]) {
            expect(requiredHumanObservations({ suite } as never)).toEqual([]);
            const inv = requiredAutomatedRows(suite)!;
            expect(inv.required).toContain('run-owned cleanup');
            expect(inv.absent).toContain('journey telemetry received');
            for (const step of inv.product) {
                expect({ suite, step, written: written.includes(`'${step}'`) || step === 'coaching request budget' }).toEqual({ suite, step, written: true });
            }
        }
        expect(spec).toContain('new RwtReceipt(`${ABANDON_SUITE}-${variant}`)');
        expect(spec).toContain('new RwtReceipt(TWO_TAB_SUITE)');
    });

    it('nothing is intercepted: the scenarios are the person\'s own actions', () => {
        expect(spec).not.toMatch(/\.route\(|route\.abort|route\.fulfill|setOffline/);
        expect(spec).toContain("await page.close({ runBeforeUnload: true });");
        expect(spec).toContain("if (d.type() === 'beforeunload') { leavePrompt = true; void d.accept(); }");
    });
});
