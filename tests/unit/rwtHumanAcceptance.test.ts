// @vitest-environment node
/**
 * PO 2026-09-25 — the automated RWT receipt and the human-check worksheet are read TOGETHER. A finished receipt stays
 * INCOMPLETE while a human check is pending; only the finalization step (`pnpm rwt:finalize`) turns a COMPLETED
 * worksheet — bound to the same suite, deployed SHA, journey and receipt — into a final PASS or FAIL.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
    finalizeReceipt, humanWorksheet, parseHumanWorksheet, receiptAcceptance, type ReceiptRow,
} from '../live/helpers/rwtAcceptance';

const SUITE = 'open-mic-first-session';
const SHA = 'a'.repeat(40);
const JOURNEY = 'journey-1';
const automated: ReceiptRow[] = [
    { step: 'session saved', verdict: 'PASS', detail: 'the take saved' },
    { step: 'coaching rendered', verdict: 'PASS', detail: 'two phrases' },
];
const human = (id: string, row: string): ReceiptRow => ({
    step: `human: ${id} question`, verdict: 'HUMAN', detail: 'named human RWT observation',
    evidence: { observationId: id, runbookRow: row, passCriterion: `criterion for ${id}`, recorded: 'pending' },
});
const rows = [...automated, human('open_mic_coaching_relevant', 'Product 1 row 5'), human('open_mic_uh_detected', 'Product 1 row 4')];
const receipt = { suite: SUITE, release: SHA, meta: { fixtureKind: 'synthetic' }, rows, readback: { journeyIds: [JOURNEY] } };

/** Fill the blank Result/Observer cells of a generated worksheet. */
const complete = (md: string, results: Record<string, string>, observer = 'PO · 2026-09-26') =>
    md.split('\n').map((line) => {
        const id = Object.keys(results).find((k) => line.startsWith(`| \`${k}\``));
        if (!id) return line;
        const cells = line.split('|');
        cells[5] = ` ${results[id]} `;
        cells[6] = ` ${observer} `;
        return cells.join('|');
    }).join('\n');

describe('initial receipt: automated PASS never reads as a completed human check', () => {
    it('all automated rows PASS but human checks pending → INCOMPLETE', () => {
        const a = receiptAcceptance(rows);
        expect(a.acceptance).toBe('INCOMPLETE');
        expect(a.automatedRowsAllPass).toBe(true);
        expect(a.humanObservations.map((h) => h.result)).toEqual(['pending', 'pending']);
    });
    it('the worksheet binds to the run and leaves the decision cells blank', () => {
        const md = humanWorksheet(SUITE, SHA, [JOURNEY], rows);
        const parsed = parseHumanWorksheet(md);
        expect(parsed).toMatchObject({ suite: SUITE, release: SHA, journeyIds: [JOURNEY], receipt: `${SUITE}.receipt.json` });
        expect(parsed.entries).toEqual([
            { id: 'open_mic_coaching_relevant', result: '', observer: '' },
            { id: 'open_mic_uh_detected', result: '', observer: '' },
        ]);
        expect(md).not.toContain('session saved');
    });
});

describe('finalization: the completed worksheet produces the final verdict', () => {
    const blank = humanWorksheet(SUITE, SHA, [JOURNEY], rows);

    it('pending (blank) → INCOMPLETE, never PASS', () => {
        const r = finalizeReceipt(receipt, parseHumanWorksheet(blank));
        expect(r.finalAcceptance).toBe('INCOMPLETE');
        expect(r.status).toBe('binding_error');
    });
    it('all human PASS → PASS', () => {
        const r = finalizeReceipt(receipt, parseHumanWorksheet(complete(blank, { open_mic_coaching_relevant: 'PASS', open_mic_uh_detected: 'pass' })));
        expect(r).toMatchObject({ status: 'final', finalAcceptance: 'PASS', errors: [] });
        expect(r.humanObservations.map((h) => h.result)).toEqual(['PASS', 'PASS']);
    });
    it('any human FAIL → FAIL', () => {
        const r = finalizeReceipt(receipt, parseHumanWorksheet(complete(blank, { open_mic_coaching_relevant: 'PASS', open_mic_uh_detected: 'FAIL' })));
        expect(r).toMatchObject({ status: 'final', finalAcceptance: 'FAIL' });
    });
    it('an automated FAIL stays FAIL even when every human check passed', () => {
        const failing = { ...receipt, rows: [{ ...automated[0], verdict: 'FAIL' as const }, ...rows.slice(1)] };
        const r = finalizeReceipt(failing, parseHumanWorksheet(complete(blank, { open_mic_coaching_relevant: 'PASS', open_mic_uh_detected: 'PASS' })));
        expect(r.finalAcceptance).toBe('FAIL');
    });
    it('CASUALTY: a worksheet from another run (SHA / journey / suite) is refused and the run stays INCOMPLETE', () => {
        const done = complete(blank, { open_mic_coaching_relevant: 'PASS', open_mic_uh_detected: 'PASS' });
        for (const wrong of [
            done.replace(SHA, 'b'.repeat(40)),
            done.replace(`\`${JOURNEY}\``, '`journey-2`'),
            done.replace(`Suite: \`${SUITE}\``, 'Suite: `focus-points-session`'),
        ]) {
            const r = finalizeReceipt(receipt, parseHumanWorksheet(wrong));
            expect(r.status).toBe('binding_error');
            expect(r.finalAcceptance).toBe('INCOMPLETE');
        }
    });
    it('CASUALTY: a missing, extra or invalid observation, or a PASS with no observer, is refused', () => {
        const partial = complete(blank, { open_mic_coaching_relevant: 'PASS' });
        expect(finalizeReceipt(receipt, parseHumanWorksheet(partial)).errors.join(' ')).toMatch(/open_mic_uh_detected has no PASS\/FAIL/);
        const invalid = complete(blank, { open_mic_coaching_relevant: 'MAYBE', open_mic_uh_detected: 'PASS' });
        expect(finalizeReceipt(receipt, parseHumanWorksheet(invalid)).status).toBe('binding_error');
        const extra = `${complete(blank, { open_mic_coaching_relevant: 'PASS', open_mic_uh_detected: 'PASS' })}| \`invented_check\` | x | x | x | PASS | PO |\n`;
        expect(finalizeReceipt(receipt, parseHumanWorksheet(extra)).errors.join(' ')).toMatch(/not in this receipt: invented_check/);
        const anonymous = complete(blank, { open_mic_coaching_relevant: 'PASS', open_mic_uh_detected: 'PASS' }, '');
        expect(finalizeReceipt(receipt, parseHumanWorksheet(anonymous)).errors.join(' ')).toMatch(/has no observer/);
        // PO 2026-09-26: an unsigned FAIL is refused too — the run stays INCOMPLETE rather than failing on an unsigned entry.
        const unsignedFail = complete(blank, { open_mic_coaching_relevant: 'FAIL', open_mic_uh_detected: 'FAIL' }, '');
        const r = finalizeReceipt(receipt, parseHumanWorksheet(unsignedFail));
        expect(r.status).toBe('binding_error');
        expect(r.finalAcceptance).toBe('INCOMPLETE');
        expect(r.errors.join(' ')).toMatch(/open_mic_coaching_relevant FAIL has no observer/);
    });
});

describe('PM RETURN 2026-09-26 — the receipt is untrusted input: a malformed receipt never finalizes to PASS', () => {
    const done = complete(humanWorksheet(SUITE, SHA, [JOURNEY], rows), { open_mic_coaching_relevant: 'PASS', open_mic_uh_detected: 'PASS' });
    const attempt = (bad: unknown) => finalizeReceipt(bad, parseHumanWorksheet(done));

    it.each([
        ['empty rows', { ...receipt, rows: [] }, /no rows/],
        ['rows missing', { suite: SUITE, release: SHA, meta: receipt.meta, readback: receipt.readback }, /no rows/],
        ['an unknown automated verdict', { ...receipt, rows: [{ ...automated[0], verdict: 'OK' }, ...rows.slice(1)] }, /unknown verdict "OK"/],
        ['a malformed row', { ...receipt, rows: [{ verdict: 'PASS' }, ...rows.slice(1)] }, /row 0 is malformed/],
        ['only human rows', { ...receipt, rows: rows.slice(2) }, /no automated rows/],
        ['a required human observation missing', { ...receipt, rows: rows.slice(0, 3) }, /missing the required human observation open_mic_uh_detected/],
        ['a release that is not a SHA', { ...receipt, release: 'main' }, /40-character SHA/],
        ['no journey list', { ...receipt, readback: {} }, /readback\.journeyIds/],
        ['an unknown suite', { ...receipt, suite: 'something-else' }, /unknown RWT suite/],
        ['not an object', [receipt], /not a JSON object/],
    ])('%s → INCOMPLETE with a named error, never PASS', (_label, bad, message) => {
        const r = attempt(bad);
        expect(r.finalAcceptance).not.toBe('PASS');
        expect(r.status).toBe('binding_error');
        expect(r.errors.join(' ')).toMatch(message as RegExp);
    });

    it('THE PM CASE: an empty receipt with an empty worksheet (nothing to fail) is INCOMPLETE, not a false PASS', () => {
        const empty = { suite: SUITE, release: SHA, meta: receipt.meta, rows: [], readback: receipt.readback };
        const r = finalizeReceipt(empty, parseHumanWorksheet(humanWorksheet(SUITE, SHA, [JOURNEY], [])));
        expect(r.finalAcceptance).toBe('INCOMPLETE');
    });

    it('THE PM CASE: an unknown automated verdict beside all-PASS human checks is INCOMPLETE, not a false PASS', () => {
        const unknown = { ...receipt, rows: [{ ...automated[0], verdict: 'SKIPPED' }, automated[1], ...rows.slice(2)] };
        expect(finalizeReceipt(unknown, parseHumanWorksheet(done)).finalAcceptance).toBe('INCOMPLETE');
    });

    it('a human-recorded uh is required only for the synthetic fixture (a human recording proves it automatically)', () => {
        const humanFixture = { ...receipt, meta: { fixtureKind: 'human' }, rows: rows.slice(0, 3) };
        const md = complete(humanWorksheet(SUITE, SHA, [JOURNEY], humanFixture.rows), { open_mic_coaching_relevant: 'PASS' });
        expect(finalizeReceipt(humanFixture, parseHumanWorksheet(md)).finalAcceptance).toBe('PASS');
    });
});

describe('the finalization STEP itself (`pnpm rwt:finalize` → scripts/rwt-finalize-receipt.mts)', () => {
    const run = (results: Record<string, string>) => {
        const dir = mkdtempSync(path.join(tmpdir(), 'rwt-final-'));
        const receiptPath = path.join(dir, `${SUITE}.receipt.json`);
        const worksheetPath = path.join(dir, `${SUITE}.human-worksheet.md`);
        writeFileSync(receiptPath, JSON.stringify({ ...receipt, meta: {} }));
        writeFileSync(worksheetPath, complete(humanWorksheet(SUITE, SHA, [JOURNEY], rows), results));
        const proc = spawnSync(path.resolve('node_modules/.bin/tsx'), ['scripts/rwt-finalize-receipt.mts', '--receipt', receiptPath, '--worksheet', worksheetPath], { encoding: 'utf8' });
        const final = JSON.parse(readFileSync(path.join(dir, `${SUITE}.final.json`), 'utf8')) as Record<string, unknown>;
        return { code: proc.status, final };
    };
    const runRaw = (receiptText: string) => {
        const dir = mkdtempSync(path.join(tmpdir(), 'rwt-final-bad-'));
        const receiptPath = path.join(dir, `${SUITE}.receipt.json`);
        const worksheetPath = path.join(dir, `${SUITE}.human-worksheet.md`);
        writeFileSync(receiptPath, receiptText);
        writeFileSync(worksheetPath, complete(humanWorksheet(SUITE, SHA, [JOURNEY], rows), { open_mic_coaching_relevant: 'PASS', open_mic_uh_detected: 'PASS' }));
        const proc = spawnSync(path.resolve('node_modules/.bin/tsx'), ['scripts/rwt-finalize-receipt.mts', '--receipt', receiptPath, '--worksheet', worksheetPath], { encoding: 'utf8' });
        const written = readdirSync(dir).find((f) => f.endsWith('.final.json'))!;
        return { code: proc.status, final: JSON.parse(readFileSync(path.join(dir, written), 'utf8')) as Record<string, unknown> };
    };
    it('CASUALTY (real CLI): malformed JSON, empty rows, missing rows or an unknown verdict → exit 2 INCOMPLETE, never PASS', () => {
        for (const text of [
            '{ not json',
            JSON.stringify({ ...receipt, rows: [] }),
            JSON.stringify({ suite: SUITE, release: SHA, meta: receipt.meta, readback: receipt.readback }),
            JSON.stringify({ ...receipt, rows: [{ ...automated[0], verdict: 'OK' }, ...rows.slice(1)] }),
        ]) {
            const { code, final } = runRaw(text);
            expect(code).toBe(2);
            expect(final.finalAcceptance).toBe('INCOMPLETE');
            expect((final.errors as string[]).length).toBeGreaterThan(0);
        }
    }, 60_000);

    it('pending → exit 2 INCOMPLETE; all PASS → exit 0 PASS; any FAIL → exit 1 FAIL — bound to the same SHA, journey and receipt', () => {
        const pending = run({});
        expect(pending.code).toBe(2);
        expect(pending.final.finalAcceptance).toBe('INCOMPLETE');
        const pass = run({ open_mic_coaching_relevant: 'PASS', open_mic_uh_detected: 'PASS' });
        expect(pass.code).toBe(0);
        expect(pass.final).toMatchObject({ finalAcceptance: 'PASS', release: SHA, journeyIds: [JOURNEY], suite: SUITE, status: 'final' });
        expect(pass.final.receiptSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(pass.final.worksheetSha256).toMatch(/^[0-9a-f]{64}$/);
        const fail = run({ open_mic_coaching_relevant: 'PASS', open_mic_uh_detected: 'FAIL' });
        expect(fail.code).toBe(1);
        expect(fail.final.finalAcceptance).toBe('FAIL');
    }, 60_000);
});
