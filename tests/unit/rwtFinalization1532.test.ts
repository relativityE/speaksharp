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
    finalizeReceipt, humanWorksheet, NON_GATING_ROWS, parseHumanWorksheet, receiptAcceptance, type ReceiptRow,
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

describe('the suites emit the inventory inside the recording journey (before the reload) and declare its stages', () => {
    const src = (f: string) => readFileSync(path.resolve(__dirname, '..', f), 'utf8');
    const at = (text: string, needle: string) => {
        const i = text.indexOf(needle);
        if (i <= 0) throw new Error(`not found in source: ${needle}`);
        return i;
    };

    it('Open Mic: menu in place → feedback → Analytics (PDF on the list, before the detail reload); declares both stages', () => {
        const om = src('live/rwt-open-mic-first-session.live.spec.ts');
        const menu = at(om, "test.step('Products menu opened on the session page (inventory, recording journey)'");
        const feedback = at(om, "test.step('row 7 — share feedback'");
        const analytics = at(om, "test.step('row 6 — Analytics action, PDF, session detail and reload'");
        expect(menu).toBeLessThan(feedback);
        expect(feedback).toBeLessThan(analytics);
        expect(om).toMatch(/analyticsThroughActions\(page, persistedId, transcriptDigest, savedCoaching, \/\\ba minute\\b\/i, downloadPdf\)/);
        expect(om).not.toMatch(/nav-analytics-link[^\n]*\n[^\n]*session PDF/);
        expect(om).toMatch(/recording: \['session_during', 'session_after_open_mic', 'analytics_inventory', 'session_pdf_export'\]/);
    });

    it('analyticsThroughActions runs onListed on the list, before the detail opens and before the reload', () => {
        const rj = src('live/helpers/rwtJourney.ts');
        const fn = rj.slice(rj.indexOf('export async function analyticsThroughActions'));
        expect(at(fn, 'if (onListed) await onListed();')).toBeLessThan(at(fn, 'await open.click();'));
        expect(at(fn, 'await open.click();')).toBeLessThan(at(fn, 'await page.reload('));
    });

    it('Focus: menu in place before feedback and Analytics; declares analytics_inventory', () => {
        const fp = src('live/helpers/rwtFocusPointsJourney.ts');
        const menu = at(fp, "test.step('Products menu opened on the session page (inventory, recording journey)'");
        expect(menu).toBeLessThan(at(fp, "test.step('share feedback'"));
        expect(menu).toBeLessThan(at(fp, "test.step('row 12 — the saved session in Analytics'"));
        expect(fp).toMatch(/recording: \['session_during', 'session_after_focus_points', 'analytics_inventory'\]/);
    });

    it('the navigation suite qualifies no journey, so it writes no by-construction HOLD telemetry rows', () => {
        expect(src('live/rwt-products-navigation.live.spec.ts')).toMatch(/telemetryClassRows\(receipt, tap, false, false\)/);
        const rj = src('live/helpers/rwtJourney.ts');
        const fn = rj.slice(rj.indexOf('export function telemetryClassRows'));
        expect(at(fn, 'if (!qualifies) return { canaryJourneys, userJourneys };')).toBeLessThan(at(fn, "'journey telemetry (canary class)'"));
    });
});
