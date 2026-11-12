// AHT-02 focus-edit-cancel-save (front-run review fix 6): Edit, type a change, Escape, reopen Edit — the set must be unchanged in
// the reopened dialog, on the rail and in the saved brief. Mirrors the harness `cancelPreserved` (focus-controls.cjs).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FOCUS_EDIT_CANCEL_ROW, editCancelVerdict, type EditCancelObservation } from '../live/helpers/rwtFocusEditCancel';

const here = path.dirname(fileURLToPath(import.meta.url));
const BRIEF = { id: 'brief-1', labels: ['one', 'two', 'unspoken'] };
const ok = (over: Partial<EditCancelObservation> = {}): EditCancelObservation => ({
    editOpened: true, editSeeded: true, changeTyped: true, focusedInDialog: true, closed: true, railKept: true,
    reopened: true, preserved: true, briefBefore: BRIEF, briefAfter: { ...BRIEF, labels: [...BRIEF.labels] }, ...over,
});

describe('editCancelVerdict', () => {
    it('Escape closed Edit, and the reopened Edit, the rail and the saved brief all keep the set → PASS', () => {
        const r = editCancelVerdict(ok());
        expect(r.verdict).toBe('PASS');
        expect(r.evidence).toMatchObject({ cancelPreserved: true, briefUnchanged: true, briefBefore: 'read', briefAfter: 'read' });
    });
    it.each<[string, Partial<EditCancelObservation>]>([
        ['Escape (delivered inside the dialog) did not close it', { closed: false, railKept: null, reopened: false, preserved: false, briefAfter: null }],
        ['Edit could not be reopened', { reopened: false, preserved: false }],
        ['the reopened Edit shows the cancelled change', { preserved: false }],
        ['the rail shows the cancelled change', { railKept: false }],
        ['the saved brief changed (another brief)', { briefAfter: { id: 'brief-2', labels: BRIEF.labels } }],
        ['the saved brief changed (its labels)', { briefAfter: { id: 'brief-1', labels: ['one', 'two', 'edited'] } }],
        ['a defect is not hidden by an unread brief', { preserved: false, briefAfter: 'error' }],
    ])('%s → FAIL', (_, over) => {
        expect(editCancelVerdict(ok(over)).verdict).toBe('FAIL');
    });
    it.each<[string, Partial<EditCancelObservation>]>([
        ['Edit was not reached', { editOpened: false }],
        ['Edit did not open seeded', { editSeeded: false }],
        ['the change could not be typed', { changeTyped: false }],
        ['focus was not inside the dialog when Escape was pressed', { focusedInDialog: false, closed: false }],
        ['the rail was not read', { railKept: null }],
        ['the brief read failed before', { briefBefore: 'error' }],
        ['the brief read failed after', { briefAfter: 'error' }],
        ['no brief was found', { briefBefore: null, briefAfter: null }],
    ])('%s → HOLD, never PASS', (_, over) => {
        expect(editCancelVerdict(ok(over)).verdict).toBe('HOLD');
    });
    it('evidence is content-free: no label or brief id reaches the receipt', () => {
        const r = editCancelVerdict(ok());
        const text = JSON.stringify(r.evidence);
        for (const v of [BRIEF.id, ...BRIEF.labels]) expect(text).not.toContain(`"${v}"`);
        for (const v of Object.values(r.evidence)) expect(['string', 'boolean'].includes(typeof v) || v === null).toBe(true);
    });
});

describe('wiring in rwtFocusPointsJourney.ts', () => {
    const src = readFileSync(path.resolve(here, '../live/helpers/rwtFocusPointsJourney.ts'), 'utf8');
    const step = src.indexOf("await test.step('Focus: Start a new set, Edit it, and the next take is scored on the edited set'");
    const body = src.slice(step);
    const at = (needle: string) => body.indexOf(needle);
    it('the probe runs between the seeded read and the Save: brief → type → Escape → rail/brief → reopen → Save → take', () => {
        const order = [
            'editSeeded = (await label2.inputValue()',
            'cancel.briefBefore = await newestBrief();',
            'await label2.fill(edited[2]).catch(() => undefined);',
            "await page.keyboard.press('Escape');",
            "cancel.closed = await dialog.waitFor({ state: 'hidden', timeout: 10_000 })",
            'cancel.railKept =',
            'cancel.briefAfter = await newestBrief();',
            "cancel.preserved = cancel.reopened && (await label2.inputValue().catch(() => '')) === unspoken;",
            "await page.getByTestId('objective-setup-submit').click();\n                            await dialog.waitFor({ state: 'hidden'",
            'await startBenchmarkRecording(page, `${suite}-edited`);',
            'const cancelRow = editCancelVerdict(cancel);',
            'receipt.row(FOCUS_EDIT_CANCEL_ROW, cancelRow.verdict, cancelRow.detail, cancelRow.evidence);',
        ].map(at);
        for (const i of order) expect(i).toBeGreaterThan(0);
        for (let k = 1; k < order.length; k += 1) expect(order[k]).toBeGreaterThan(order[k - 1]);
    });
    it('the precondition HOLD branch writes the cancel row too, and the row is written once per path', () => {
        const hold = at("receipt.row(FOCUS_EDIT_CANCEL_ROW, 'HOLD', why);");
        expect(hold).toBeGreaterThan(0);
        expect(hold).toBeLessThan(at('const savedFocus = async'));
        expect(src.match(/receipt\.row\(FOCUS_EDIT_CANCEL_ROW/g)).toHaveLength(2);
        expect(FOCUS_EDIT_CANCEL_ROW).toBe('Focus Edit cancel keeps the set');
    });
    it('the probe adds no Start press: the step still presses Start only for the edited take', () => {
        const stepBody = body.slice(0, body.indexOf('} finally {'));
        expect(stepBody.match(/startBenchmarkRecording\(/g)).toHaveLength(1);
    });
});
