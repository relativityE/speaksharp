// AHT-02 open-mic-isolation (front-run review fix 7): the Open Mic take after the first Focus take has no objective_session, and
// the first Focus take's saved evidence is unchanged across it. Mirrors the harness `extendedFocus` (focus-controls.cjs).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OPEN_MIC_ISOLATION_ROW, openMicIsolationVerdict, type OpenMicIsolationObservation } from '../live/helpers/rwtFocusOpenMicIsolation';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIRST = { brief: 'brief-1', verdicts: ['p1:detected', 'p2:detected'], ordered: ['0:one:detected', '1:two:detected'] };
const ok = (over: Partial<OpenMicIsolationObservation> = {}): OpenMicIsolationObservation => ({
    openMicId: 'om-1', openMicProduct: 'open_mic', objectiveRowReads: [0, 0],
    firstBefore: FIRST, firstAfter: { ...FIRST, verdicts: [...FIRST.verdicts], ordered: [...FIRST.ordered] }, ...over,
});

describe('openMicIsolationVerdict', () => {
    it('no objective session for the Open Mic take, saved as Open Mic, first Focus evidence unchanged → PASS', () => {
        const r = openMicIsolationVerdict(ok());
        expect(r.verdict).toBe('PASS');
        expect(r.evidence).toMatchObject({ openMicObjectiveRows: '0,0', firstFocusUnchanged: true, openMicProductIsOpenMic: true, firstFocusPoints: 2 });
    });
    it.each<[string, Partial<OpenMicIsolationObservation>]>([
        ['an objective session for the Open Mic take (first read)', { objectiveRowReads: [1, 1] }],
        ['an objective session written late (second read only)', { objectiveRowReads: [0, 1] }],
        ['an objective session even when the other read failed', { objectiveRowReads: [null, 1] }],
        ['the Open Mic take saved as another product', { openMicProduct: 'focus_points' }],
        ['the first Focus take moved to another brief', { firstAfter: { ...FIRST, brief: 'brief-2' } }],
        ['a first Focus verdict changed', { firstAfter: { ...FIRST, verdicts: ['p1:detected', 'p2:not_detected'] } }],
        ['a first Focus point lost its verdict', { firstAfter: { ...FIRST, ordered: ['0:one:detected', '1:two:missing'] } }],
        ['a defect is not hidden by an unread product', { openMicProduct: null, objectiveRowReads: [2, 2] }],
    ])('%s → FAIL', (_, over) => {
        expect(openMicIsolationVerdict(ok(over)).verdict).toBe('FAIL');
    });
    it.each<[string, Partial<OpenMicIsolationObservation>]>([
        ['no Open Mic take saved', { openMicId: null, objectiveRowReads: [] }],
        ['an objective read failed', { objectiveRowReads: [0, null] }],
        ['no objective read was made', { objectiveRowReads: [] }],
        ['the Open Mic product could not be read', { openMicProduct: null }],
        ['the first Focus evidence read failed before', { firstBefore: 'error' }],
        ['the first Focus evidence read failed after', { firstAfter: 'error' }],
        ['the first Focus take has no objective session', { firstBefore: null, firstAfter: null }],
        ['the first Focus take has no saved verdicts (no baseline)', { firstBefore: { ...FIRST, verdicts: [] }, firstAfter: { ...FIRST, verdicts: [] } }],
    ])('%s → HOLD, never PASS', (_, over) => {
        expect(openMicIsolationVerdict(ok(over)).verdict).toBe('HOLD');
    });
    it('evidence is content-free: no id, label or verdict key reaches the receipt', () => {
        const text = JSON.stringify(openMicIsolationVerdict(ok()).evidence);
        for (const v of ['om-1', FIRST.brief, 'one', 'two', 'p1']) expect(text).not.toContain(v);
    });
});

describe('wiring in rwtFocusPointsJourney.ts', () => {
    const src = readFileSync(path.resolve(here, '../live/helpers/rwtFocusPointsJourney.ts'), 'utf8');
    const step = src.indexOf("await test.step('Open Mic take, then a Focus take right after the product switch'");
    const body = src.slice(step, src.indexOf("await test.step('Focus: Start a new set", step));
    const at = (needle: string) => body.indexOf(needle);
    it('first Focus evidence before the Open Mic take → Open Mic saved → objective rows + first evidence again → Focus take → second read → row', () => {
        const order = [
            'const firstFocusBefore = await firstFocusEvidence();',
            "await openProduct('open-mic');",
            'const openMicId = await waitForNewPersistedSession(page, before);',
            'const openMicObjectiveRowReads: Array<number | null> = savedOpenMicId ? [await objectiveRowsFor(savedOpenMicId)] : [];',
            'const firstFocusAfter = await firstFocusEvidence();',
            "await openProduct('focus-points');",
            'const focusId = await waitForNewPersistedSession(page, openMicId);',
            "receipt.row('take after switching products is clean'",
            'if (savedOpenMicId) openMicObjectiveRowReads.push(await objectiveRowsFor(savedOpenMicId));',
            'const kept = openMicIsolationVerdict({',
            'receipt.row(OPEN_MIC_ISOLATION_ROW, kept.verdict, kept.detail, kept.evidence);',
        ].map(at);
        for (const i of order) expect(i).toBeGreaterThan(0);
        for (let k = 1; k < order.length; k += 1) expect(order[k]).toBeGreaterThan(order[k - 1]);
        expect(OPEN_MIC_ISOLATION_ROW).toBe('Open Mic take kept out of Focus');
    });
    it('the reads add no Start press: the step still presses Start for exactly the Open Mic and the short Focus take', () => {
        expect(body.match(/startBenchmarkRecording\(/g)).toHaveLength(2);
        expect(src.match(/receipt\.row\(OPEN_MIC_ISOLATION_ROW/g)).toHaveLength(1);
    });
    it('the reads never throw: a failed read is a value the verdict holds on', () => {
        const reads = body.slice(at('const objectiveRowsFor'), at('const firstFocusBefore'));
        expect(reads).not.toContain('throw ');
    });
});
