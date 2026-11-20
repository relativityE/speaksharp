// @vitest-environment node
/**
 * J3.a / J3.b consent gate (Sam, Nov 20, the #1910/#1911 gate): the Focus journey reads this run's privacy choice back from the
 * server immediately before EVERY capture-capable press (7 in AHT-02, 4 in AHT-03), not only once on the Practice page.
 *  - The shared helpers (`practiceAgainEvidence`, `nextStartEvidence`) await the caller's `beforeCapture` readback immediately
 *    before their presses. A refused readback presses nothing and propagates unchanged; it is never recorded as a product step
 *    that failed. With no hook (J1), nothing changes.
 *  - The J3 privacy row is written exactly once, by the gate: PASS only for Save Yes / Coaching Yes read back before the first
 *    press; a diagnostic mode HOLDS; a legacy build, a missing, different or unreadable choice stops before any press.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';

const script = vi.hoisted(() => ({ calls: [] as string[], startFails: false }));

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
    startBenchmarkRecording: async (_p: unknown, label: string) => { script.calls.push(`start:${label}`); if (script.startFails) throw new Error('start failed'); },
    expectBenchmarkRecordingStarted: async () => undefined,
    stopBenchmarkRecording: async (_p: unknown, label: string, _t?: number, onClicked?: () => void) => { script.calls.push(`stop:${label}`); onClicked?.(); },
}));
vi.mock('../live/helpers/rwtStepDiagnostics', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    readPracticeActionState: async () => null,
}));

const { nextStartEvidence, practiceAgainEvidence, RwtReceipt } = await import('../live/helpers/rwtJourney');
const { J3_PRIVACY_ROW, j3ConsentRowRecorder } = await import('../live/helpers/rwtJ3Evidence');
const { CONSENT_MODES, captureConsentGate } = await import('../live/helpers/rwtPracticeConsent');
type SettledConsent = import('../live/helpers/rwtPracticeConsent').SettledConsent;
type ChoiceClient = import('../live/helpers/rwtPracticeConsent').ChoiceClient;
type ConsentMode = import('../live/helpers/rwtPracticeConsent').ConsentMode;

/** A scripted page that logs navigation and every click by test id. */
const fakePage = (): Page => ({
    goto: async (url: string) => { script.calls.push(`goto:${url}`); },
    getByTestId: (id: string) => ({ click: async () => { script.calls.push(`click:${id}`); }, isEnabled: async () => true,
        waitFor: async () => { throw new Error('no rail in this scripted page'); } }),
    waitForURL: async () => undefined,
    waitForTimeout: async () => undefined,
    locator: () => ({}),
    getByText: () => ({ count: async () => 0 }),
    evaluate: (fn: () => unknown) => {
        const src = String(fn);
        if (src.includes('__rwtMicStreams__')) return Promise.resolve(0);
        if (src.includes('data-session-persisted-id')) return Promise.resolve('take-2');
        if (src.includes('data-session-persisted')) return Promise.resolve(true);
        return Promise.resolve(null);
    },
}) as unknown as Page;

const REFUSED = 'HOLD practice consent: readback_differs';
/** A consent hook that logs each readback and refuses on the listed calls (1-based). */
const hook = (refuseOn: number[] = []) => {
    let n = 0;
    return async () => { n += 1; script.calls.push('confirm'); if (refuseOn.includes(n)) throw new Error(REFUSED); };
};
const presses = () => script.calls.filter((c) => c.startsWith('start:') || c === 'click:focus-points-retry' || c === 'click:verdict-practice-again');

beforeEach(() => { script.calls = []; script.startFails = false; });

describe('shared helpers: a fresh readback immediately before every press, and a refusal presses nothing', () => {
    it('practiceAgainEvidence: one readback right before the save take\'s Start and one right before the repeat press', async () => {
        const ev = await practiceAgainEvidence(fakePage(), 'pa', 'take-1', 'focus_points', [], undefined, { beforeCapture: hook() });
        expect(ev.reviewReached).toBe(true);
        const seq = script.calls.filter((c) => c === 'confirm' || presses().includes(c));
        expect(seq).toEqual(['confirm', 'start:pa-save', 'confirm', 'click:focus-points-retry']);
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
    it('practiceAgainEvidence: with no hook (J1) nothing is read and the presses are unchanged', async () => {
        await practiceAgainEvidence(fakePage(), 'pa', 'take-1', 'open_mic');
        expect(script.calls).not.toContain('confirm');
        expect(presses()).toEqual(['start:pa-save', 'click:verdict-practice-again']);
    });
    it('practiceAgainEvidence: an ordinary press failure is still the helper\'s own HOLD evidence, never a consent stop', async () => {
        script.startFails = true;
        const ev = await practiceAgainEvidence(fakePage(), 'pa', 'take-1', 'focus_points', [], undefined, { beforeCapture: hook() });
        expect(ev).toMatchObject({ reviewReached: false, saveTakeFailedStep: 'start' });
    });
    it('nextStartEvidence: a readback right before the Start; refused → no Start and the original error propagates', async () => {
        const ok = await nextStartEvidence(fakePage(), 'nx', hook());
        expect(ok.stopped).toBe(true);
        expect(script.calls.filter((c) => c === 'confirm' || c.startsWith('start:'))).toEqual(['confirm', 'start:nx']);
        script.calls = [];
        await expect(nextStartEvidence(fakePage(), 'nx', hook([1]))).rejects.toThrow(REFUSED);
        expect(presses()).toEqual([]);
        expect(script.calls).not.toContain('goto:about:blank');
    });
    it('nextStartEvidence: with no hook (J1) nothing is read', async () => {
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

describe('J3 runner source: every capture-capable press follows a fresh readback', () => {
    const src = readFileSync('tests/live/helpers/rwtFocusPointsJourney.ts', 'utf8');
    /** The statement just before `needle`, ignoring a `*PressedAt = Date.now();` timestamp line. */
    const before = (needle: string) => {
        const at = src.indexOf(needle);
        expect({ needle, found: at > 0 }).toEqual({ needle, found: true });
        const lines = src.slice(0, at).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//'));
        const prev = lines.pop()!;
        return /PressedAt = Date\.now\(\);$/.test(prev) ? lines.pop()! : prev;
    };
    it('the cold model helper and each of the four direct Starts are immediately preceded by captureGate().confirm()', () => {
        for (const press of [
            'const setup = await preparePrivateModelIfPrompted(page, 900_000);',
            'await startBenchmarkRecording(page, suite);',
            'await startBenchmarkRecording(page, `${suite}-switch-openmic`);',
            'await startBenchmarkRecording(page, `${suite}-switch-focus`);',
            'await startBenchmarkRecording(page, `${suite}-edited`);',
        ]) expect({ press, previous: before(press) }).toEqual({ press, previous: 'await captureGate().confirm();' });
        expect(src.match(/await startBenchmarkRecording\(/g)).toHaveLength(4);
        expect(src.match(/await captureGate\(\)\.confirm\(\);/g)).toHaveLength(5);
    });
    it('the first take records PASS only after capture began, on either branch', () => {
        expect(src).toMatch(/if \(setup\.recordingAlreadyStarted\) \{\s*captureGate\(\)\.recordPass\(\);\s*\} else \{[\s\S]*?await startBenchmarkRecording\(page, suite\);\s*captureGate\(\)\.recordPass\(\);\s*\}/);
        expect(src.match(/captureGate\(\)\.recordPass\(\)/g)).toHaveLength(2);
    });
    it('the shared helpers\' presses get the same readback', () => {
        expect(src).toMatch(/practiceAgainEvidence\([\s\S]*?\{ saveTakeMs, beforeCapture: \(\) => captureGate\(\)\.confirm\(\) \}\)/);
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

describe('shared helper source: the readback sits immediately before each press', () => {
    const src = readFileSync('tests/live/helpers/rwtJourney.ts', 'utf8');
    it('practiceAgainEvidence: before the save take\'s Start, and before the repeat press\'s timing trace is armed', () => {
        expect(src).toMatch(/step = 'start';\n\s*await beforeCapturePress\(opts\.beforeCapture\);\n\s*await startBenchmarkRecording\(page, `\$\{label\}-save`\);/);
        expect(src).toMatch(/await beforeCapturePress\(opts\.beforeCapture\);\n\s*\/\/ The product's own controller trace, armed just before the press[^\n]*\n\s*const pressPerf =/);
    });
    it('nextStartEvidence: before the Start clock starts', () => {
        expect(src).toMatch(/try \{ await beforeCapturePress\(beforeCapture\); \} catch \(error\) \{ clearInterval\(watch\); rethrowConsentStop\(error\); throw error; \}\n\s*const startedAt = Date\.now\(\);/);
    });
    it('both practice-again catches let a consent stop through before treating anything as a press failure', () => {
        expect(src.match(/\} catch \(error\) \{\n\s*rethrowConsentStop\(error\);\n\s*ev\.reviewReached = false;/g)).toHaveLength(1);
        expect(src.match(/\} catch \(error\) \{\n\s*clearInterval\(watch\);\n\s*rethrowConsentStop\(error\);\n\s*\/\/ Read WHY before teardown/g)).toHaveLength(1);
    });
});
