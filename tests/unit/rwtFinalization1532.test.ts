// @vitest-environment node
/**
 * #1532 Codex P1s r4121232394 / r4121232419 (PO disposition: full loop 4, 2026-09-28).
 *  - A receipt must be able to finalize to PASS: the readback outcome is merged into `journey telemetry received`, and
 *    exactly two PO-named rows are non-gating (their HOLD reports, never blocks; a FAIL still gates).
 *  - Inventory "received" is proven by qualification stages bound to the recording journey, not claimed.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
    finalizeReceipt, humanWorksheet, NON_GATING_ROWS, parseHumanWorksheet, receiptAcceptance, recordRunOwnedCleanup, requiredAutomatedRows, type ReceiptRow,
} from '../live/helpers/rwtAcceptance';
import { QUALIFICATION_STAGES } from '../../frontend/src/services/telemetry/completenessGate';

const SUITE = 'open-mic-first-session';
const SHA = 'b'.repeat(40);
const J = 'journey-rec';
const STAGES = ['session_during', 'session_after_open_mic', 'share_feedback', 'analytics_inventory', 'session_pdf_export'];
const pass = (step: string): ReceiptRow => ({ step, verdict: 'PASS', detail: 'ok' });
const hold = (step: string): ReceiptRow => ({ step, verdict: 'HOLD', detail: 'pending' });
const humanRow = (id: string): ReceiptRow => ({
    step: `human: ${id}`, verdict: 'HUMAN', detail: 'named human RWT observation',
    evidence: { observationId: id, runbookRow: 'row', passCriterion: 'c', recorded: 'pending' },
});
const rows: ReceiptRow[] = [
    pass('session saved'), hold('signup-stage telemetry received'), hold('base_q4 primary'), hold('journey telemetry received'),
    // #1532 Codex P1 r4126400982: the rest of the automated rows every Open Mic receipt carries.
    pass('telemetry decodable'), pass('signup-stage telemetry (user class)'), pass('journey telemetry (canary class)'), pass('receipt content-free'),
    humanRow('open_mic_coaching_relevant'), humanRow('open_mic_uh_detected'),
];
const receipt = { suite: SUITE, release: SHA, meta: { fixtureKind: 'synthetic' }, rows,
    readback: { journeys: [{ journeyId: J, stages: STAGES }], reportedJourneyIds: ['other'], missingBindings: [] } };
const readbackOk = { suite: SUITE, release: SHA, journeys: [{ journeyId: J, stages: STAGES, verdict: 'QUALIFIED' }], missingBindings: [] };
const worksheetDone = () => {
    const md = humanWorksheet(SUITE, SHA, [J, 'other'], rows);
    return parseHumanWorksheet(md.split('\n').map((l) => (l.startsWith('| `open_mic_') ? l.replace(/\| {2}\| {2}\|$/, '| PASS | PO · 2026-09-28 |') : l)).join('\n'));
};

describe('non-gating rows (PO 2026-09-28): exactly two, HOLD only', () => {
    it('the allowlist is exactly the two PO-named rows, each with a reason', () => {
        expect(Object.keys(NON_GATING_ROWS).sort()).toEqual(['base_q4 primary', 'signup-stage telemetry received']);
        for (const reason of Object.values(NON_GATING_ROWS)) expect(reason).toMatch(/PO 2026-09-28/);
    });
    it('CASUALTY: those two HOLDs alone no longer make a run INCOMPLETE; any other HOLD still does', () => {
        expect(receiptAcceptance([pass('a'), hold('signup-stage telemetry received'), hold('base_q4 primary')]).acceptance).toBe('PASS');
        expect(receiptAcceptance([pass('a'), hold('base_q4 primary'), hold('journey telemetry received')]).acceptance).toBe('INCOMPLETE');
    });
    it('a FAIL on a non-gating row still gates (only HOLD is exempt)', () => {
        expect(receiptAcceptance([pass('a'), { step: 'base_q4 primary', verdict: 'FAIL', detail: 'x' }]).acceptance).toBe('FAIL');
    });
    it('non-gating rows stay visible in the acceptance result', () => {
        expect(receiptAcceptance(rows).nonGating.map((n) => n.step).sort()).toEqual(['base_q4 primary', 'signup-stage telemetry received']);
    });
});

describe('finalizeReceipt merges the readback outcome', () => {
    it('CASUALTY (the defect): without a readback, a run with clean humans stays INCOMPLETE on journey telemetry received', () => {
        const r = finalizeReceipt(receipt, worksheetDone());
        expect(r.finalAcceptance).toBe('INCOMPLETE');
    });
    it('GREEN: every bound journey QUALIFIED and nothing missing → journey telemetry received PASS → final PASS', () => {
        const r = finalizeReceipt(receipt, worksheetDone(), readbackOk);
        expect(r.errors).toEqual([]);
        expect(r.rows.find((x) => x.step === 'journey telemetry received')?.verdict).toBe('PASS');
        expect(r.finalAcceptance).toBe('PASS');
    });
    it('a HOLD journey, or a missing binding, keeps the row HOLD → INCOMPLETE (never PASS)', () => {
        for (const rb of [
            { ...readbackOk, journeys: [{ ...readbackOk.journeys[0], verdict: 'HOLD' }] },
            { ...readbackOk, missingBindings: ['share_feedback'] },
            { ...readbackOk, journeys: [] },
        ]) expect(finalizeReceipt(receipt, worksheetDone(), rb).finalAcceptance).toBe('INCOMPLETE');
    });
    it('CASUALTY: a readback for another suite, release, journey set or stage set is a binding error, never PASS', () => {
        for (const rb of [
            { ...readbackOk, suite: 'focus-points-session' },
            { ...readbackOk, release: 'c'.repeat(40) },
            { ...readbackOk, journeys: [{ ...readbackOk.journeys[0], journeyId: 'someone-else' }] },
            { ...readbackOk, journeys: [{ ...readbackOk.journeys[0], stages: ['session_during'] }] },
            { ...readbackOk, journeys: [{ ...readbackOk.journeys[0], verdict: 'QUALIFIED-ish' }] },
            'not an object',
        ]) {
            const r = finalizeReceipt(receipt, worksheetDone(), rb as never);
            expect(r.finalAcceptance).toBe('INCOMPLETE');
            expect(r.errors.join(' ')).toMatch(/readback/);
        }
    });
    it('the CLI accepts --readback and exits 0 PASS only with a matching, all-qualified readback', () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'rwt-final4-'));
        const rp = path.join(dir, `${SUITE}.receipt.json`);
        const wp = path.join(dir, `${SUITE}.human-worksheet.md`);
        const bp = path.join(dir, `${SUITE}.readback-verdicts.json`);
        writeFileSync(rp, JSON.stringify(receipt));
        const md = humanWorksheet(SUITE, SHA, [J, 'other'], rows).split('\n')
            .map((l) => (l.startsWith('| `open_mic_') ? l.replace(/\| {2}\| {2}\|$/, '| PASS | PO · 2026-09-28 |') : l)).join('\n');
        writeFileSync(wp, md);
        const cli = (extra: string[]) => spawnSync(path.resolve('node_modules/.bin/tsx'),
            ['scripts/rwt-finalize-receipt.mts', '--receipt', rp, '--worksheet', wp, ...extra], { encoding: 'utf8' });
        expect(cli([]).status).toBe(2);
        writeFileSync(bp, JSON.stringify(readbackOk));
        const ok = cli(['--readback', bp]);
        expect(ok.status).toBe(0);
        expect(JSON.parse(readFileSync(path.join(dir, `${SUITE}.final.json`), 'utf8')).readbackSha256).toMatch(/^[0-9a-f]{64}$/);
        writeFileSync(bp, JSON.stringify({ ...readbackOk, release: 'c'.repeat(40) }));
        expect(cli(['--readback', bp]).status).toBe(2);
    }, 60_000);
});

describe('inventory "received" is proven by stages, not claimed', () => {
    const stage = (name: string) => QUALIFICATION_STAGES.find((s) => s.stage === name);
    it('analytics_inventory requires the Products menu and the saved-review revisit; session_pdf_export requires the PDF', () => {
        expect(stage('analytics_inventory')?.requiredFamilies).toEqual(['products_menu_opened', 'saved_review_revisited']);
        expect(stage('session_pdf_export')?.requiredFamilies).toEqual(['session_pdf_downloaded']);
    });
});

describe('the suites follow the v12 order and bind each inventory event to the journey it lands in', () => {
    const src = (f: string) => readFileSync(path.resolve(__dirname, '..', f), 'utf8');
    const at = (text: string, needle: string) => {
        const i = text.indexOf(needle);
        if (i <= 0) throw new Error(`not found in source: ${needle}`);
        return i;
    };

    it('Open Mic (v12 order): menu in place → Analytics (detail, reload, then Back → PDF) → feedback; PDF bound where it lands', () => {
        const om = src('live/rwt-open-mic-first-session.live.spec.ts');
        const menu = at(om, "test.step('Products menu opened on the session page (inventory, recording journey)'");
        const analytics = at(om, "test.step('row 6 — Analytics action, PDF, session detail and reload'");
        const feedback = at(om, "test.step('row 7 — share feedback'");
        expect(menu).toBeLessThan(analytics);
        expect(analytics).toBeLessThan(feedback);
        expect(om).toMatch(/analyticsThroughActions\(page, persistedId, transcriptDigest, savedCoaching, \/\\ba minute\\b\/i, downloadPdf\)/);
        // The PDF is reached the way the person reaches it after the reload: the detail's own Back to Dashboard control.
        const pdf = om.slice(at(om, 'const downloadPdf = async'));
        expect(at(pdf, "getByRole('link', { name: 'Back to Dashboard' })")).toBeLessThan(at(pdf, 'download-pdf-btn-${persistedId}'));
        expect(om).toMatch(/recording: \['session_during', 'session_after_open_mic', 'analytics_inventory'\], repeatRecording: \['session_during', 'session_after_open_mic'\],[\s\S]{0,400}feedback: true, pdfExport: true,/);
    });

    it('analyticsThroughActions runs afterReload only after the detail opened and its reload was checked', () => {
        const rj = src('live/helpers/rwtJourney.ts');
        const fn = rj.slice(rj.indexOf('export async function analyticsThroughActions'));
        expect(fn).not.toContain('onListed');
        expect(at(fn, 'await open.click();')).toBeLessThan(at(fn, 'await page.reload('));
        expect(at(fn, 'await page.reload(')).toBeLessThan(at(fn, 'if (afterReload) await afterReload();'));
    });

    it('Focus (v12 order): menu in place → Analytics → feedback; declares analytics_inventory in the recording journey', () => {
        const fp = src('live/helpers/rwtFocusPointsJourney.ts');
        const menu = at(fp, "test.step('Products menu opened on the session page (inventory, recording journey)'");
        const analytics = at(fp, "test.step('row 12 — the saved session in Analytics'");
        expect(menu).toBeLessThan(analytics);
        expect(analytics).toBeLessThan(at(fp, "test.step('share feedback'"));
        expect(fp).toMatch(/recording: \['session_during', 'session_after_focus_points', 'analytics_inventory'\]/);
    });

    it('the navigation suite qualifies no journey, so it writes no by-construction HOLD telemetry rows', () => {
        expect(src('live/rwt-products-navigation.live.spec.ts')).toMatch(/telemetryClassRows\(receipt, tap, false, false\)/);
        const rj = src('live/helpers/rwtJourney.ts');
        const fn = rj.slice(rj.indexOf('export function telemetryClassRows'));
        expect(at(fn, 'if (!qualifies) return { canaryJourneys, userJourneys };')).toBeLessThan(at(fn, "'journey telemetry (canary class)'"));
    });
});

/**
 * #1532 Codex P1 r4126400982 (PM RETURN 5877389745) — a receipt must carry its suite's required automated rows exactly
 * once, checked before any worksheet or readback is applied. Each casualty is given every OTHER condition for PASS (all
 * human checks PASS and a fully QUALIFIED readback), so the only thing standing between it and a false PASS is this check.
 */
describe('required automated-row inventory: a receipt that lost a gating row can never finalize PASS', () => {
    const without = (step: string) => ({ ...receipt, rows: rows.filter((r) => r.step !== step) });
    const finalize = (r: unknown) => finalizeReceipt(r, worksheetDone(), readbackOk);

    it('CONTROL: the complete receipt with a qualified readback still finalizes PASS, unchanged', () => {
        const r = finalize(receipt);
        expect(r).toMatchObject({ status: 'final', finalAcceptance: 'PASS', errors: [] });
    });

    it('CASUALTY: "journey telemetry received" missing → binding error, never PASS (the readback has nothing to settle)', () => {
        const r = finalize(without('journey telemetry received'));
        expect(r.finalAcceptance).not.toBe('PASS');
        expect(r.status).toBe('binding_error');
        expect(r.errors.join(' ')).toMatch(/missing the required automated row "journey telemetry received"/);
    });

    it('CASUALTY: "journey telemetry received" duplicated → binding error, never PASS', () => {
        const dup = { ...receipt, rows: [...rows, { step: 'journey telemetry received', verdict: 'HOLD' as const, detail: 'again' }] };
        const r = finalize(dup);
        expect(r.finalAcceptance).not.toBe('PASS');
        expect(r.errors.join(' ')).toMatch(/"journey telemetry received" 2 times/);
    });

    it('CASUALTY: another gating row missing ("receipt content-free") → binding error, never PASS', () => {
        const r = finalize(without('receipt content-free'));
        expect(r.finalAcceptance).not.toBe('PASS');
        expect(r.errors.join(' ')).toMatch(/missing the required automated row "receipt content-free"/);
    });

    it('CASUALTY: "journey telemetry received" arriving already PASS (no readback) cannot finalize PASS', () => {
        const preset = { ...receipt, rows: rows.map((r) => (r.step === 'journey telemetry received' ? { ...r, verdict: 'PASS' as const } : r)) };
        const r = finalizeReceipt(preset, worksheetDone());
        expect(r.finalAcceptance).not.toBe('PASS');
        expect(r.errors.join(' ')).toMatch(/arrived as PASS; only the readback merge may settle it/);
    });

    it('the inventory is closed per suite; returning-user keeps its deliberate no-readback shape', () => {
        const always = ['telemetry decodable', 'signup-stage telemetry (user class)', 'signup-stage telemetry received', 'receipt content-free'];
        const readbackRows = ['journey telemetry (canary class)', 'journey telemetry received'];
        for (const suite of ['open-mic-first-session', 'focus-points-session']) {
            expect(requiredAutomatedRows(suite)).toEqual({ required: [...always, ...readbackRows], absent: [] });
        }
        // #1532 r4126745141: only the partial run carries its own cleanup row.
        expect(requiredAutomatedRows('focus-points-partial')).toEqual({ required: [...always, ...readbackRows, 'run-owned cleanup'], absent: [] });
        expect(requiredAutomatedRows('returning-user-navigation')).toEqual({ required: always, absent: readbackRows });
        expect(requiredAutomatedRows('something-else')).toBeNull();
    });

    it('every required row name is one the suites actually write (no inventory entry can drift from the source)', () => {
        const src = (f: string) => readFileSync(path.resolve(__dirname, '..', f), 'utf8');
        const writers = ['live/helpers/rwtJourney.ts', 'live/rwt-open-mic-first-session.live.spec.ts', 'live/helpers/rwtFocusPointsJourney.ts',
            'live/rwt-products-navigation.live.spec.ts'].map(src).join('\n');
        for (const step of [...requiredAutomatedRows('open-mic-first-session')!.required]) expect(writers).toContain(`'${step}'`);
    });
});

/**
 * #1532 Codex P1 r4126745141 (PM RETURN 5878021743) — the Focus PARTIAL receipt must carry its own verified cleanup,
 * recorded BEFORE the receipt is written; a cleanup failure can never finalize PASS.
 */
describe('Focus partial: cleanup is verified before the receipt is written, and bound into finalization', () => {
    type Row = { step: string; verdict: string; detail: string };
    const collect = () => { const out: Row[] = []; return { out, row: (step: string, verdict: string, detail: string) => { out.push({ step, verdict, detail }); } }; };

    it('successful cleanup (UID returned) → exactly one PASS row, and it reports deletion', async () => {
        const { out, row } = collect();
        await expect(recordRunOwnedCleanup(row as never, async () => 'uid-1')).resolves.toBe(true);
        expect(out).toEqual([{ step: 'run-owned cleanup', verdict: 'PASS', detail: expect.stringMatching(/deleted and zero residue was verified/) }]);
    });

    it('cleanup throwing (deletion unproven / residue) → FAIL row, no throw escapes, and the error text is never recorded', async () => {
        const { out, row } = collect();
        await expect(recordRunOwnedCleanup(row as never, async () => { throw new Error('rwt-journey-secret@example.com residue in sessions'); })).resolves.toBe(false);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ step: 'run-owned cleanup', verdict: 'FAIL' });
        expect(JSON.stringify(out)).not.toMatch(/secret@example\.com|residue in sessions/);
    });

    it('no account to delete ("" returned) → FAIL, never PASS', async () => {
        const { out, row } = collect();
        await expect(recordRunOwnedCleanup(row as never, async () => '')).resolves.toBe(false);
        expect(out[0]).toMatchObject({ verdict: 'FAIL' });
    });

    const partialReceipt = (cleanup: ReceiptRow | null) => ({
        ...receipt, suite: 'focus-points-partial',
        rows: [...rows.filter((r) => !r.step.startsWith('human:')), ...(cleanup ? [cleanup] : []),
            { step: 'human: focus', verdict: 'HUMAN' as const, detail: 'named human RWT observation', evidence: { observationId: 'focus_coaching_covers_points', runbookRow: 'row', passCriterion: 'c', recorded: 'pending' } }],
    });
    const partialDone = (r: { rows: ReceiptRow[] }) => parseHumanWorksheet(humanWorksheet('focus-points-partial', SHA, [J, 'other'], r.rows).split('\n')
        .map((l) => (l.startsWith('| `focus_') ? l.replace(/\| {2}\| {2}\|$/, '| PASS | PO · 2026-09-28 |') : l)).join('\n'));
    const partialReadback = { ...readbackOk, suite: 'focus-points-partial' };

    it('CONTROL: a partial receipt with a PASS cleanup row, human PASS and a qualified readback finalizes PASS', () => {
        const r = partialReceipt({ step: 'run-owned cleanup', verdict: 'PASS', detail: 'verified' });
        expect(finalizeReceipt(r, partialDone(r), partialReadback)).toMatchObject({ status: 'final', finalAcceptance: 'PASS', errors: [] });
    });

    it('CASUALTY: cleanup FAIL row → final FAIL, never PASS, even with everything else passing', () => {
        const r = partialReceipt({ step: 'run-owned cleanup', verdict: 'FAIL', detail: 'failed' });
        expect(finalizeReceipt(r, partialDone(r), partialReadback).finalAcceptance).toBe('FAIL');
    });

    it('CASUALTY: the cleanup row missing → binding error, never PASS', () => {
        const r = partialReceipt(null);
        const out = finalizeReceipt(r, partialDone(r), partialReadback);
        expect(out.finalAcceptance).not.toBe('PASS');
        expect(out.errors.join(' ')).toMatch(/missing the required automated row "run-owned cleanup"/);
    });

    it('order and idempotency: cleanup runs before write() in the partial branch; only a verified deletion clears the owner; afterEach remains the fallback', () => {
        const focus = readFileSync(path.resolve(__dirname, '../live/helpers/rwtFocusPointsJourney.ts'), 'utf8');
        const branch = focus.slice(focus.indexOf("} else if (fixtureKey === 'focus_points_partial_tts') {"));
        expect(branch.indexOf('recordRunOwnedCleanup(')).toBeGreaterThan(-1);
        expect(branch.indexOf('recordRunOwnedCleanup(')).toBeLessThan(branch.indexOf('receipt.write(testInfo,'));
        expect(branch).toMatch(/if \(cleaned\) \{ owner\.uid = ''; owner\.email = ''; \}/);
        const spec = readFileSync(path.resolve(__dirname, '../live/rwt-focus-points-partial.live.spec.ts'), 'utf8');
        // afterEach cleans whatever the owner still names: nothing after a verified in-body deletion ('cleanup_not_required').
        expect(spec).toMatch(/test\.afterEach\([\s\S]{0,120}cleanupRunOwnedAccount\(\{ admin: admin as never, capturedUid: owner\.uid, createdEmail: owner\.email/);
    });
});

/** #1532 Codex P2 r4126745144 (PM RETURN 5878409074) — `automatedRowsAllPass` means every GATING automated row is PASS. */
describe('automatedRowsAllPass counts gating HOLD rows as not passing', () => {
    it('a gating automated HOLD → acceptance INCOMPLETE and automatedRowsAllPass false', () => {
        const a = receiptAcceptance([pass('session saved'), hold('journey telemetry received')]);
        expect(a).toMatchObject({ acceptance: 'INCOMPLETE', automatedRowsAllPass: false });
    });
    it('all gating automated rows PASS → true', () => {
        expect(receiptAcceptance([pass('session saved'), pass('journey telemetry received')]).automatedRowsAllPass).toBe(true);
    });
    it('a permitted NON-GATING HOLD does not make it false', () => {
        const a = receiptAcceptance([pass('session saved'), hold('signup-stage telemetry received'), hold('base_q4 primary')]);
        expect(a).toMatchObject({ acceptance: 'PASS', automatedRowsAllPass: true });
    });
    it('pending human observations stay outside the automated boolean', () => {
        const a = receiptAcceptance([pass('session saved'), humanRow('open_mic_coaching_relevant')]);
        expect(a).toMatchObject({ acceptance: 'INCOMPLETE', automatedRowsAllPass: true });
    });
});
