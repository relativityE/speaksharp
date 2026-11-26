// @vitest-environment node
/**
 * J3.a / J3.b consent gate (Sam, Nov 20, the #1910/#1911 gate): the Focus journey reads this run's privacy choice back from the
 * server immediately before EVERY capture-capable press (7 in AHT-02, 4 in AHT-03), not only once on the Practice page.
 *  - #1916 review hold (Sam): the readback runs INSIDE each activation path — after the waits, scroll, reflex pause and click
 *    guard, immediately before the actual click. The shared helpers (`practiceAgainEvidence`, `nextStartEvidence`) pass the
 *    caller's `beforeCapture` through as the Start helpers' `beforeClick`, and the repeat action pins its node, takes the
 *    reflex pause, re-checks it, then reads back and clicks. A refused readback clicks nothing and propagates unchanged; it
 *    is never recorded as a product step that failed. Its own time is excluded from press timings. No hook: unchanged.
 *  - J1's later presses (Sam, Nov 21) hand the same hook to both helpers, with the real J1 gate (Save Yes / Coaching Yes).
 *    The real Start helpers' ordering and guard cleanup are proved in benchmarkHarnessControls.test.ts.
 *  - The J3 privacy row is written exactly once, by the gate: PASS only for Save Yes / Coaching Yes read back before the first
 *    press; a diagnostic mode HOLDS; a legacy build, a missing, different or unreadable choice stops before any press.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';

const script = vi.hoisted(() => ({ calls: [] as string[], startFails: false, duringSetup: null as null | (() => void),
    repeatChanged: false, hookMs: 0 }));

vi.mock('@playwright/test', () => {
    const matchers = () => ({ toBeEnabled: async () => undefined, toContainText: async () => undefined, toBeVisible: async () => undefined, toBe: () => undefined });
    const expect = Object.assign(() => matchers(), {
        soft: () => ({ toBe: () => undefined }),
        poll: (fn: () => Promise<unknown>) => ({ toBe: async (v: unknown) => { if ((await fn()) !== v) throw new Error('poll'); } }),
    });
    return { expect, test: {} };
});
vi.mock('../live/helpers/benchmark-utils', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    // Models the real helper's order (proved there): setup (waits, reflex, guard) → the caller's readback → the click.
    startBenchmarkRecording: async (_p: unknown, label: string, _t?: number, opts?: { beforeClick?: () => Promise<void> }) => {
        script.calls.push(`setup:${label}`);
        script.duringSetup?.();
        await opts?.beforeClick?.();
        script.calls.push(`start:${label}`);
        if (script.startFails) throw new Error('start failed');
    },
    expectBenchmarkRecordingStarted: async () => undefined,
    stopBenchmarkRecording: async (_p: unknown, label: string, _t?: number, onClicked?: () => void) => { script.calls.push(`stop:${label}`); onClicked?.(); },
}));
vi.mock('../live/helpers/rwtStepDiagnostics', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    readPracticeActionState: async () => null,
}));

const { nextStartEvidence, practiceAgainEvidence, RwtReceipt } = await import('../live/helpers/rwtJourney');
const { J3_PRIVACY_ROW, j3ConsentRowRecorder } = await import('../live/helpers/rwtJ3Evidence');
const { CONSENT_MODES, OPEN_MIC_FIRST_SESSION_CONSENT_MODE, captureConsentGate } = await import('../live/helpers/rwtPracticeConsent');
type SettledConsent = import('../live/helpers/rwtPracticeConsent').SettledConsent;
type ChoiceClient = import('../live/helpers/rwtPracticeConsent').ChoiceClient;
type ConsentMode = import('../live/helpers/rwtPracticeConsent').ConsentMode;

/** A scripted page that logs navigation and every click by test id. */
const fakePage = (): Page => ({
    goto: async (url: string) => { script.calls.push(`goto:${url}`); },
    getByTestId: (id: string) => ({ click: async () => { script.calls.push(`click:${id}`); }, isEnabled: async () => true,
        waitFor: async () => { throw new Error('no rail in this scripted page'); },
        // The pinned repeat-action node (hook path only): identity re-check, then the click.
        elementHandle: async () => {
            script.calls.push(`pin:${id}`);
            return {
                evaluate: async () => {
                    script.calls.push(`identity:${id}`);
                    script.duringSetup?.();
                    return { connected: true, control: script.repeatChanged ? 'mic-retry' : id, disabled: false, unique: true };
                },
                click: async () => { script.calls.push(`click:${id}`); },
                dispose: async () => undefined,
            };
        } }),
    waitForURL: async () => undefined,
    waitForTimeout: async () => undefined,
    locator: () => ({}),
    getByText: () => ({ count: async () => 0 }),
    evaluate: (fn: () => unknown) => {
        const src = String(fn);
        if (src.includes('__rwtMicStreams__')) return Promise.resolve(0);
        if (src.includes('__SPEECH_RUNTIME_DEBUG__')) return Promise.resolve(null); // the start-failure read: unread
        if (src.includes('data-session-persisted-id')) return Promise.resolve('take-2');
        if (src.includes('data-session-persisted')) return Promise.resolve(true);
        return Promise.resolve(null);
    },
}) as unknown as Page;

const REFUSED = 'HOLD practice consent: readback_differs';
/** A consent hook that logs each readback and refuses on the listed calls (1-based). */
const hook = (refuseOn: number[] = []) => {
    let n = 0;
    return async () => {
        n += 1; script.calls.push('confirm');
        if (script.hookMs > 0) await new Promise((r) => setTimeout(r, script.hookMs));
        if (refuseOn.includes(n)) throw new Error(REFUSED);
    };
};
const presses = () => script.calls.filter((c) => c.startsWith('start:') || c === 'click:focus-points-retry' || c === 'click:verdict-practice-again');

beforeEach(() => { script.calls = []; script.startFails = false; script.duringSetup = null; script.repeatChanged = false; script.hookMs = 0; });

describe('shared helpers: a fresh readback immediately before every press, and a refusal presses nothing', () => {
    it('practiceAgainEvidence: the readback runs after each press\'s setup, immediately before its click', async () => {
        const ev = await practiceAgainEvidence(fakePage(), 'pa', 'take-1', 'focus_points', [], undefined, { beforeCapture: hook() });
        expect(ev.reviewReached).toBe(true);
        const seq = script.calls.filter((c) => /^(confirm|setup:|start:|pin:|identity:|click:focus)/.test(c));
        expect(seq).toEqual(['setup:pa-save', 'confirm', 'start:pa-save',
            'pin:focus-points-retry', 'identity:focus-points-retry', 'confirm', 'identity:focus-points-retry', 'click:focus-points-retry']);
    });
    it('practiceAgainEvidence: a choice withdrawn during the repeat action\'s setup → zero repeat clicks, the stop propagates', async () => {
        const refuse = hook([2]);
        await expect(practiceAgainEvidence(fakePage(), 'pa', 'take-1', 'focus_points', [], undefined, { beforeCapture: refuse }))
            .rejects.toThrow(REFUSED);
        expect(script.calls).not.toContain('click:focus-points-retry');
        expect(script.calls).not.toContain('goto:about:blank');
    });
    it('practiceAgainEvidence: a repeat node that changed during setup is never read back or clicked', async () => {
        script.repeatChanged = true;
        const ev = await practiceAgainEvidence(fakePage(), 'pa', 'take-1', 'focus_points', [], undefined, { beforeCapture: hook() });
        expect(ev.reason).toBe('the repeat action did not begin recording');
        expect(script.calls.filter((c) => c === 'confirm')).toHaveLength(1); // the save take's only
        expect(script.calls).not.toContain('click:focus-points-retry');
    });
    it('practiceAgainEvidence: a repeat node that changed during a slow readback is never clicked (re-checked after it)', async () => {
        let n = 0;
        const changesDuringRead = async () => { n += 1; script.calls.push('confirm'); if (n === 2) script.repeatChanged = true; };
        const ev = await practiceAgainEvidence(fakePage(), 'pa', 'take-1', 'focus_points', [], undefined, { beforeCapture: changesDuringRead });
        expect(ev.reason).toBe('the repeat action did not begin recording');
        expect(script.calls.filter((c) => c === 'confirm')).toHaveLength(2);
        expect(script.calls).not.toContain('click:focus-points-retry');
    });
    it('practiceAgainEvidence: the readback\'s own time is excluded from press → recording', async () => {
        script.hookMs = 60;
        const ev = await practiceAgainEvidence(fakePage(), 'pa', 'take-1', 'focus_points', [], undefined, { beforeCapture: hook() });
        expect(ev.afterStartMs).not.toBeNull();
        expect(ev.afterStartMs!).toBeLessThan(40);
    });
    it('practiceAgainEvidence: refused before the save take → nothing pressed, the original error propagates', async () => {
        await expect(practiceAgainEvidence(fakePage(), 'pa', 'take-1', 'focus_points', [], undefined, { beforeCapture: hook([1]) }))
            .rejects.toThrow(REFUSED);
        expect(presses()).toEqual([]);
        // Never handled as a failed save take: no teardown navigation.
        expect(script.calls).not.toContain('goto:about:blank');
    });
    it('practiceAgainEvidence: refused before the repeat press → the save take ran, the repeat is never pressed', async () => {
        await expect(practiceAgainEvidence(fakePage(), 'pa', 'take-1', 'focus_points', [], undefined, { beforeCapture: hook([2]) }))
            .rejects.toThrow(REFUSED);
        expect(presses()).toEqual(['start:pa-save']);
        expect(script.calls).not.toContain('goto:about:blank');
    });
    it('practiceAgainEvidence: with no hook nothing is read and the presses are unchanged (plain locator click)', async () => {
        await practiceAgainEvidence(fakePage(), 'pa', 'take-1', 'open_mic');
        expect(script.calls).not.toContain('confirm');
        expect(script.calls.some((c) => c.startsWith('pin:'))).toBe(false);
        expect(presses()).toEqual(['start:pa-save', 'click:verdict-practice-again']);
    });
    it('practiceAgainEvidence: an ordinary press failure is still the helper\'s own HOLD evidence, never a consent stop', async () => {
        script.startFails = true;
        const ev = await practiceAgainEvidence(fakePage(), 'pa', 'take-1', 'focus_points', [], undefined, { beforeCapture: hook() });
        expect(ev).toMatchObject({ reviewReached: false, saveTakeFailedStep: 'start' });
    });
    it('nextStartEvidence: the readback runs after setup, right before the click; refused → no click, the error propagates', async () => {
        const ok = await nextStartEvidence(fakePage(), 'nx', hook());
        expect(ok.stopped).toBe(true);
        expect(script.calls.filter((c) => c === 'confirm' || c.startsWith('start:') || c.startsWith('setup:'))).toEqual(['setup:nx', 'confirm', 'start:nx']);
        script.calls = [];
        await expect(nextStartEvidence(fakePage(), 'nx', hook([1]))).rejects.toThrow(REFUSED);
        expect(presses()).toEqual([]);
        expect(script.calls).not.toContain('goto:about:blank');
    });
    it('nextStartEvidence: the readback\'s own time is excluded from the next-Start timing', async () => {
        script.hookMs = 60;
        const ok = await nextStartEvidence(fakePage(), 'nx', hook());
        expect(ok.nextStartMs).not.toBeNull();
        expect(ok.nextStartMs!).toBeLessThan(40);
    });
    it('nextStartEvidence: with no hook nothing is read', async () => {
        await nextStartEvidence(fakePage(), 'nx');
        expect(script.calls).not.toContain('confirm');
        expect(presses()).toEqual(['start:nx']);
    });
});

/** The owner's server row, as `readPracticeChoice` reads it. */
const client = (read: () => { data: unknown; error: { code?: string } | null }, reads: { n: number }): ChoiceClient => ({
    from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => { reads.n += 1; return read(); } }), limit: async () => ({ data: [], error: null }) }),
    }),
});
const rowFor = (mode: ConsentMode, owner = 'owner-1') => ({ user_id: owner, transcript_save: CONSENT_MODES[mode].transcriptSave,
    ai_coaching: CONSENT_MODES[mode].aiCoaching, consent_version: 1 });
const settled = (mode: ConsentMode | null, build: SettledConsent['build'] = 'includes_1835'): SettledConsent =>
    ({ build, mode, choice: mode && build === 'includes_1835' ? CONSENT_MODES[mode] : null });

/** The J3 gate exactly as the journey builds it (row 8): the run's own mode, or the acceptance mode when none was needed. */
const j3Gate = (consent: SettledConsent, read: () => { data: unknown; error: { code?: string } | null }) => {
    const receipt = new RwtReceipt('focus-points-partial');
    const reads = { n: 0 };
    const gate = captureConsentGate({ consent, client: client(read, reads), ownerId: 'owner-1', mode: consent.mode ?? 'save_on_coaching_on',
        record: j3ConsentRowRecorder(receipt, () => consent) });
    const rows = () => receipt.rows.filter((r) => r.step === J3_PRIVACY_ROW);
    return { gate, rows, reads };
};

describe('J3 privacy row: written once by the gate after a fresh readback', () => {
    it('acceptance (Save Yes / Coaching Yes): PASS once, after the first press; later readbacks add no row', async () => {
        const { gate, rows, reads } = j3Gate(settled('save_on_coaching_on'), () => ({ data: rowFor('save_on_coaching_on'), error: null }));
        await gate.confirm();
        expect(rows()).toHaveLength(0);
        gate.recordPass();
        for (let i = 0; i < 6; i += 1) { await gate.confirm(); gate.recordPass(); }
        expect(reads.n).toBe(7); // one fresh server read per press, 7 = AHT-02's budget
        expect(rows()).toHaveLength(1);
        expect(rows()[0]).toMatchObject({ verdict: 'PASS', evidence: { reason: 'save_yes_coaching_yes', transcriptSave: true, aiCoaching: true } });
        expect(rows()[0].detail).toMatch(/immediately before the first capture-capable press/);
    });
    it('a diagnostic mode reads back exactly and runs, but its row HOLDS (never coaching credit)', async () => {
        for (const mode of ['save_on', 'save_off'] as const) {
            const { gate, rows } = j3Gate(settled(mode), () => ({ data: rowFor(mode), error: null }));
            await gate.confirm();
            gate.recordPass();
            expect(rows()).toEqual([expect.objectContaining({ verdict: 'HOLD', evidence: expect.objectContaining({ reason: 'not_acceptance_mode' }) })]);
        }
    });
    it.each([
        ['changed to Save No since settling', () => ({ data: rowFor('save_off'), error: null }), 'FAIL', 'readback_differs'],
        ['removed', () => ({ data: null, error: null }), 'FAIL', 'readback_missing'],
        ['another owner\'s row', () => ({ data: rowFor('save_on_coaching_on', 'owner-2'), error: null }), 'FAIL', 'readback_wrong_owner'],
        ['unreadable', () => ({ data: null, error: { code: '500' } }), 'HOLD', 'readback_unreadable'],
    ] as const)('choice %s → stops before the press, row %s', async (_label, read, status, reason) => {
        const { gate, rows } = j3Gate(settled('save_on_coaching_on'), read);
        await expect(gate.confirm()).rejects.toThrow(`HOLD practice consent: ${reason}`);
        expect(rows()).toEqual([expect.objectContaining({ verdict: status, evidence: expect.objectContaining({ reason }) })]);
        // A second attempt still refuses and still writes no second row.
        await expect(gate.confirm()).rejects.toThrow('HOLD practice consent:');
        expect(rows()).toHaveLength(1);
    });
    it('a later press whose readback changed stops there, after the PASS row (no second row, no press)', async () => {
        let row: unknown = rowFor('save_on_coaching_on');
        const { gate, rows } = j3Gate(settled('save_on_coaching_on'), () => ({ data: row, error: null }));
        await gate.confirm(); gate.recordPass();
        row = rowFor('save_off');
        await expect(gate.confirm()).rejects.toThrow('HOLD practice consent: readback_differs');
        expect(rows()).toHaveLength(1);
        expect(rows()[0].verdict).toBe('PASS');
    });
    it('Sam\'s #1916 hold: consent withdrawn DURING a press\'s setup → that press clicks nothing and the run stops HOLD', async () => {
        // First press: the settled choice is withdrawn while the Start is being set up (after the earlier Practice readback).
        let row: unknown = rowFor('save_on_coaching_on');
        const first = j3Gate(settled('save_on_coaching_on'), () => ({ data: row, error: null }));
        script.duringSetup = () => { row = rowFor('save_off'); };
        await expect(nextStartEvidence(fakePage(), 'nx', () => first.gate.confirm())).rejects.toThrow('HOLD practice consent: readback_differs');
        expect(presses()).toEqual([]);
        expect(first.rows()).toEqual([expect.objectContaining({ verdict: 'FAIL', evidence: expect.objectContaining({ reason: 'readback_differs' }) })]);
        // A later press: the earlier PASS stands, this press is refused at its click, nothing is clicked, no second row.
        script.calls = []; script.duringSetup = null;
        row = rowFor('save_on_coaching_on');
        const later = j3Gate(settled('save_on_coaching_on'), () => ({ data: row, error: null }));
        await later.gate.confirm(); later.gate.recordPass();
        script.duringSetup = () => { row = null; };
        await expect(practiceAgainEvidence(fakePage(), 'pa', 'take-1', 'focus_points', [], undefined, { beforeCapture: () => later.gate.confirm() }))
            .rejects.toThrow('HOLD practice consent: readback_missing');
        expect(presses()).toEqual([]);
        expect(later.rows()).toHaveLength(1);
        expect(later.rows()[0].verdict).toBe('PASS');
    });
    it('a legacy (pre-#1835) build FAILS at the first press without reading or pressing; an unknown build HOLDS', async () => {
        const legacy = j3Gate(settled(null, 'predates_1835'), () => ({ data: null, error: null }));
        await expect(legacy.gate.confirm()).rejects.toThrow('HOLD practice consent: legacy_build');
        expect(legacy.reads.n).toBe(0);
        expect(legacy.rows()).toEqual([expect.objectContaining({ verdict: 'FAIL', evidence: expect.objectContaining({ reason: 'legacy_build' }) })]);
        const unknown = j3Gate(settled('save_on_coaching_on', 'unknown'), () => ({ data: null, error: null }));
        await expect(unknown.gate.confirm()).rejects.toThrow('HOLD practice consent: build_unknown');
        expect(unknown.rows()[0].verdict).toBe('HOLD');
    });
    it('a capture recorded without a fresh confirm is HOLD, never PASS', () => {
        const { gate, rows } = j3Gate(settled('save_on_coaching_on'), () => ({ data: rowFor('save_on_coaching_on'), error: null }));
        expect(() => gate.recordPass()).toThrow('HOLD practice consent: not_confirmed_before_capture');
        expect(rows()).toEqual([expect.objectContaining({ verdict: 'HOLD' })]);
    });
    it('an unsettled Practice prompt is recorded HOLD with its reason (the journey\'s row-8 catch)', () => {
        const receipt = new RwtReceipt('focus-points-partial');
        j3ConsentRowRecorder(receipt, () => settled('save_on_coaching_on', 'unknown'))('HOLD', 'not settled', { reason: 'prompt_not_shown', mode: 'save_on_coaching_on' });
        expect(receipt.rows.filter((r) => r.step === J3_PRIVACY_ROW)).toEqual([expect.objectContaining({ verdict: 'HOLD', evidence: expect.objectContaining({ reason: 'prompt_not_shown' }) })]);
    });
});

/**
 * J1's later presses (Sam, Nov 21; kept apart from #1917): the Practice-again save take's Start, the review's Practice again and the
 * next Start, through the shared helpers exactly as the J1 spec calls them, with the real gate J1 builds (its own receipt row) over
 * a slow server read. The first take already recorded the row PASS; a later refusal clicks nothing and stops, adding no row.
 */
describe('J1 later presses: the real J1 gate at each press of the shared helpers (open_mic)', () => {
    const J1_ROW = 'practice privacy choice';
    const j1Gate = (read: () => { data: unknown; error: { code?: string } | null }) => {
        const receipt = new RwtReceipt('open-mic-first-session');
        const reads = { n: 0 };
        const slow = (): ChoiceClient => ({
            from: () => ({
                select: () => ({ eq: () => ({ maybeSingle: async () => {
                    reads.n += 1; script.calls.push('read');
                    await new Promise((r) => setTimeout(r, 40)); // slower than any helper step in this script
                    return read();
                } }), limit: async () => ({ data: [], error: null }) }),
            }),
        });
        const gate = captureConsentGate({ consent: settled(OPEN_MIC_FIRST_SESSION_CONSENT_MODE), client: slow(), ownerId: 'owner-1',
            mode: OPEN_MIC_FIRST_SESSION_CONSENT_MODE, record: (status, detail, evidence) => receipt.row(J1_ROW, status, detail, evidence) });
        return { gate, reads, rows: () => receipt.rows.filter((r) => r.step === J1_ROW) };
    };
    const firstTakeRecorded = async (g: ReturnType<typeof j1Gate>) => { await g.gate.confirm(); g.gate.recordPass(); script.calls = []; };
    const j1Presses = () => script.calls.filter((c) => c.startsWith('start:') || c === 'click:verdict-practice-again');

    it('slow success: each of the three later presses reads back once, after its setup, right before its one click', async () => {
        const g = j1Gate(() => ({ data: rowFor(OPEN_MIC_FIRST_SESSION_CONSENT_MODE), error: null }));
        await firstTakeRecorded(g);
        const again = await practiceAgainEvidence(fakePage(), 'j1-again', 'take-1', 'open_mic', [], undefined, { beforeCapture: () => g.gate.confirm() });
        expect(again.stopped).toBe(true);
        const next = await nextStartEvidence(fakePage(), 'j1-next', () => g.gate.confirm());
        expect(next.stopped).toBe(true);
        expect(script.calls.filter((c) => /^(read|setup:|start:|pin:|identity:|click:verdict)/.test(c))).toEqual([
            'setup:j1-again-save', 'read', 'start:j1-again-save',
            'pin:verdict-practice-again', 'identity:verdict-practice-again', 'read', 'identity:verdict-practice-again', 'click:verdict-practice-again',
            'setup:j1-next', 'read', 'start:j1-next',
        ]);
        expect(g.reads.n).toBe(1 + 3);
        expect(g.rows()).toEqual([expect.objectContaining({ verdict: 'PASS' })]);
    });
    it.each([
        ['the save take\'s Start', 1, []],
        ['the review\'s Practice again', 2, ['start:j1-again-save']],
    ] as const)('slow refusal at %s: that press clicks nothing, the HOLD propagates, the first take\'s PASS stands alone', async (_label, at, pressed) => {
        let n = 0;
        const g = j1Gate(() => { n += 1; return { data: n > at ? rowFor('save_off') : rowFor(OPEN_MIC_FIRST_SESSION_CONSENT_MODE), error: null }; });
        await firstTakeRecorded(g);
        await expect(practiceAgainEvidence(fakePage(), 'j1-again', 'take-1', 'open_mic', [], undefined, { beforeCapture: () => g.gate.confirm() }))
            .rejects.toThrow('HOLD practice consent: readback_differs');
        expect(j1Presses()).toEqual([...pressed]);
        expect(script.calls).not.toContain('goto:about:blank');
        expect(g.rows()).toEqual([expect.objectContaining({ verdict: 'PASS' })]);
    });
    it('slow refusal at the next Start: no Start press, the HOLD propagates, no teardown', async () => {
        let reads = 0;
        const g = j1Gate(() => { reads += 1; return { data: reads > 1 ? null : rowFor(OPEN_MIC_FIRST_SESSION_CONSENT_MODE), error: null }; });
        await firstTakeRecorded(g);
        await expect(nextStartEvidence(fakePage(), 'j1-next', () => g.gate.confirm())).rejects.toThrow('HOLD practice consent: readback_missing');
        expect(j1Presses()).toEqual([]);
        expect(script.calls).not.toContain('goto:about:blank');
    });
});

describe('J3 runner source: every capture-capable press reads back at its click', () => {
    const src = readFileSync('tests/live/helpers/rwtFocusPointsJourney.ts', 'utf8');
    const saveConsentHook = /again = await practiceAgainEvidence\([^\n]+\n\s*\{ saveTakeMs, beforeCapture: async \(\) => \{\s*if \(cueAligned\) await resetFixtureAudioToStart\(page\);\s*await captureGate\(\)\.confirm\(\);\s*\},/;
    it('the cold model helper and each of the four direct Starts pass the click-time readback, and nothing confirms outside it', () => {
        for (const press of [
            'const setup = await preparePrivateModelIfPrompted(page, 900_000, atClick());',
            'try { await startBenchmarkRecording(page, suite, undefined, firstClick); } finally { firstPressedAt += firstClick.spentMs(); }',
            'await startBenchmarkRecording(page, `${suite}-switch-openmic`, undefined, atClick());',
            'await startBenchmarkRecording(page, `${suite}-switch-focus`, undefined, switchClick);',
            'await startBenchmarkRecording(page, `${suite}-edited`, undefined, editedClick);',
        ]) expect({ press, found: src.includes(press) }).toEqual({ press, found: true });
        expect(src.match(/await startBenchmarkRecording\(/g)).toHaveLength(4);
        expect(src.match(/await startBenchmarkRecording\([^;]*\b(atClick\(\)|firstClick|switchClick|editedClick)\)/g)).toHaveLength(4);
        expect(src.match(/preparePrivateModelIfPrompted\(/g)).toHaveLength(1);
        // The only confirm is the one inside atClick (beforeClick) and the two helper hooks; none sits before a helper call.
        expect(src.match(/captureGate\(\)\.confirm\(\)/g)).toHaveLength(3);
        expect(src).toContain('beforeClick: async () => { const t = Date.now(); try { await captureGate().confirm(); } finally { spent += Date.now() - t; } },');
        expect(src).toMatch(saveConsentHook);
        expect(src.replace(saveConsentHook, '')).not.toMatch(/^\s*await captureGate\(\)\.confirm\(\);$/m);
        expect(src).toContain('const switchClick = atClick();');
        expect(src).toContain('const editedClick = atClick();');
    });
    it('press timings exclude the readback: each pressed-at adds that press\'s own readback time', () => {
        expect(src).toContain('const switchPressedAt = switchCalledAt + switchClick.spentMs();');
        expect(src).toContain('const editedPressedAt = editedCalledAt + editedClick.spentMs();');
        expect(src).toMatch(/firstPressedAt = Date\.now\(\);\s*try \{ await startBenchmarkRecording\(page, suite, undefined, firstClick\); \} finally \{ firstPressedAt \+= firstClick\.spentMs\(\); \}/);
    });
    it('the first take records PASS only after capture began, on either branch', () => {
        expect(src).toMatch(/if \(setup\.recordingAlreadyStarted\) \{\s*captureGate\(\)\.recordPass\(\);\s*\} else \{[\s\S]*?firstClick\.spentMs\(\); \}\s*captureGate\(\)\.recordPass\(\);\s*\}/);
        expect(src.match(/captureGate\(\)\.recordPass\(\)/g)).toHaveLength(2);
    });
    it('the shared helpers\' presses get the same readback', () => {
        expect(src).toMatch(saveConsentHook);
        expect(src).toContain('const next = await nextStartEvidence(page, `${suite}-next`, () => captureGate().confirm());');
    });
    it('the gate is built in row 8 from the settled choice, before the first take; an unsettled prompt records HOLD and stops', () => {
        const settle = src.indexOf('consent = await settlePracticeConsent({');
        const gate = src.indexOf('consentGate = captureConsentGate({ consent, client: admin as unknown as ChoiceClient, ownerId: owner.uid,');
        expect(settle).toBeGreaterThan(0);
        expect(gate).toBeGreaterThan(settle);
        expect(gate).toBeLessThan(src.indexOf('firstTakeMonitor = await armTakeMonitor(page, suite);'));
        expect(src).toContain('mode: consent.mode ?? J3_ACCEPTANCE_CONSENT_MODE, record });');
        const katch = src.slice(settle, gate);
        expect(katch).toMatch(/record\('HOLD', [^\n]*\{ reason, mode: consent\.mode \?\? 'none' \}\);\s*throw error;/);
        expect(src).toContain("if (!consentGate) throw new Error('HOLD practice consent: not_settled');");
    });
});

describe('shared helper source: the readback is passed into each click path, never run before it', () => {
    const src = readFileSync('tests/live/helpers/rwtJourney.ts', 'utf8');
    it('practiceAgainEvidence: the save take hands the hook to the Start helper; the repeat action reads back after its reflex and re-check', () => {
        expect(src).toMatch(/step = 'start';\n\s*await startBenchmarkRecording\(page, `\$\{label\}-save`, undefined, consentAtClick\(opts\.beforeCapture\)\);/);
        expect(src).toMatch(/if \(reflexMs > 0\) await new Promise\(\(resolve\) => setTimeout\(resolve, reflexMs\)\);\n\s*const requireSameAction = async/);
        expect(src).toMatch(/await requireSameAction\(\);\n\s*await consent\.beforeClick\(\);\n[^\n]*\n\s*await requireSameAction\(\);\n\s*await handle\.click\(\{ timeout: 15_000 \}\);/);
        expect(src).toContain("if (!consent.beforeClick) { await again.click(); return; }");
    });
    it('nextStartEvidence: the hook goes into the Start helper; a refusal clears the watch and stops, with no teardown', () => {
        expect(src).toContain('await startBenchmarkRecording(page, label, undefined, consent);');
        expect(src).toMatch(/\} catch \(error\) \{\n\s*clearInterval\(watch\);\n[^\n]*\n\s*rethrowConsentStop\(error\);\n\s*const startFailure/);
        expect(src).not.toMatch(/beforeCapturePress/);
    });
    it('both practice-again catches let a consent stop through before treating anything as a press failure', () => {
        expect(src.match(/\} catch \(error\) \{\n\s*rethrowConsentStop\(error\);\n\s*ev\.reviewReached = false;/g)).toHaveLength(1);
        expect(src.match(/\} catch \(error\) \{\n\s*clearInterval\(watch\);\n\s*rethrowConsentStop\(error\);\n\s*\/\/ Read WHY before teardown/g)).toHaveLength(1);
    });
});
