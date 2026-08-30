import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
    TARGETED_FINALISTS_V1, validatePlanCoverage, validateAgainstPlan, selectionPlanDigest,
} from '../arms/selectionPlan';
import { ARM_MATRIX } from '../arms/registry';
import { buildAssetInventory, verifyAgainstCommittedPins, reconcileAssets } from '../assetInventory';

try { rmSync('/tmp/1304-must-not-exist.json', { force: true }); } catch { /* nothing to clear */ }
const RUNNER = readFileSync(resolve(__dirname, '../../../../scripts/run-browser-matrix.mts'), 'utf8');
const grade = (r: { id: string; [k: string]: unknown }) => (r as { selectionEligible?: boolean }).selectionEligible === true;
const measuredRow = (id: string) => ({ id, selectionEligible: true });
const disposedRow = (id: string, reason: string) => ({ id, executed: false, reason });
const fullPlanRows = () => [
    ...TARGETED_FINALISTS_V1.measured.map(measuredRow),
    ...Object.entries(TARGETED_FINALISTS_V1.dispositions).map(([id, r]) => disposedRow(id, r)),
];

describe('#1304 — a targeted selection run is a COMMITTED PLAN, not an ad hoc --only', () => {
    it('POSITIVE CONTROL: the plan accounts for EVERY registered arm exactly once', () => {
        expect(validatePlanCoverage(TARGETED_FINALISTS_V1)).toEqual({ ok: true });
        const named = [...TARGETED_FINALISTS_V1.measured, ...Object.keys(TARGETED_FINALISTS_V1.dispositions)];
        expect(named.sort()).toEqual(ARM_MATRIX.map((a) => a.id).sort());
        expect(TARGETED_FINALISTS_V1.measured).toEqual([
            'v2:base.en', 'moonshine:streaming-medium', 'v4:base:int8-decoder:cpu', 'v4:base:q4-decoder:wasm',
        ]);
    });

    it('POSITIVE CONTROL: the complete plan finalizes', () => {
        expect(validateAgainstPlan(fullPlanRows(), TARGETED_FINALISTS_V1, grade)).toEqual({ ok: true });
    });

    it('CASUALTY: a FOUR-ROW artifact cannot become selection evidence', () => {
        // The exact shape a `--only` corpus run would have produced: four eligible rows, matrix omitted.
        const four = TARGETED_FINALISTS_V1.measured.map(measuredRow);
        const v = validateAgainstPlan(four, TARGETED_FINALISTS_V1, grade);
        expect(v.ok).toBe(false);
        expect((v as { reason: string }).reason).toBe('missing_disposition');
    });

    it.each([
        ['a missing measured finalist', () => fullPlanRows().filter((r) => r.id !== 'v2:base.en'), 'missing_measured'],
        ['a duplicate row', () => [...fullPlanRows(), measuredRow('v2:base.en')], 'duplicate_arm'],
        ['an invented arm', () => [...fullPlanRows(), measuredRow('v9:invented')], 'unexpected_arm'],
        ['a finalist that is not selection-grade', () => fullPlanRows().map((r) => r.id === 'v2:base.en' ? { id: r.id, selectionEligible: false } : r), 'not_selection_grade'],
        ['a wrong disposition reason', () => fullPlanRows().map((r) => r.id === 'moonshine:tiny' ? disposedRow(r.id, 'alias_of_int8') : r), 'wrong_reason'],
    ])('CASUALTY: %s fails finalization', (_l, build, reason) => {
        const v = validateAgainstPlan(build() as { id: string }[], TARGETED_FINALISTS_V1, grade);
        expect(v.ok).toBe(false);
        expect((v as { reason: string }).reason).toBe(reason);
    });

    it('CASUALTY (EXECUTED): the runner REFUSES bare --only on a selection set', () => {
        // Executed, not grepped. A source-text assertion passed while the guard was replaced with
        // `if (false)` — the message survived and the refusal did not. Only running it proves the
        // behaviour, and this is the single blocker that would let an incomplete artifact claim
        // selection eligibility.
        const r = spawnSync('npx', [
            'tsx', 'scripts/run-browser-matrix.mts', '--set=corpus', '--only=v2:base.en',
            '--product-baseline=8f770766', '--out=/tmp/1304-must-not-exist.json',
        ], { encoding: 'utf8', cwd: resolve(__dirname, '../../../..'), timeout: 120_000 });

        expect(r.status, 'a bare --only corpus run must EXIT NONZERO').not.toBe(0);
        expect(`${r.stdout}${r.stderr}`).toContain('cannot produce selection evidence');
        expect(existsSync('/tmp/1304-must-not-exist.json'), 'no artifact may be written').toBe(false);
    });

    it('POSITIVE CONTROL (EXECUTED): an unknown selection plan is refused by name', () => {
        const r = spawnSync('npx', [
            'tsx', 'scripts/run-browser-matrix.mts', '--set=corpus', '--selection-plan=no-such-plan',
            '--product-baseline=8f770766', '--out=/tmp/1304-also-must-not-exist.json',
        ], { encoding: 'utf8', cwd: resolve(__dirname, '../../../..'), timeout: 120_000 });
        expect(r.status).not.toBe(0);
        expect(`${r.stdout}${r.stderr}`).toContain('unknown selection plan');
    });

    it('the plan and its DIGEST are bound into run identity', () => {
        expect(RUNNER).toContain('selectionPlanId:');
        expect(RUNNER).toContain('selectionPlanDigest()');
        expect(selectionPlanDigest()).toMatch(/^[0-9a-f]{32}$/);
    });

    it('finalization validates against the plan, not merely the old required-rows list', () => {
        expect(RUNNER).toContain('validateAgainstPlan(');
        expect(RUNNER).toContain('plan ${selectionPlan.id} ${planned.reason}');
    });
});

describe('#1304 — reconciliation states which authority made it ok', () => {
    const file = (name: string, sha: string, bytes: number) =>
        ({ [name]: { sha256: sha, bytes, source: 'cache' as const, pinned: true } });
    const inv = () => buildAssetInventory({
        ...file('lib/onnxruntime-web/dist/ort.mjs', 'a'.repeat(64), 10),
        ...file('m/onnx/encoder_model.onnx', 'b'.repeat(64), 20),
        ...file('m/onnx/decoder_model.onnx', 'c'.repeat(64), 30),
        ...file('m/tokenizer.json', 'd'.repeat(64), 5),
    }, null);
    const pins = {
        'lib/onnxruntime-web/dist/ort.mjs': { sha256: 'a'.repeat(64), bytes: 10 },
        'm/onnx/encoder_model.onnx': { sha256: 'b'.repeat(64), bytes: 20 },
        'm/onnx/decoder_model.onnx': { sha256: 'c'.repeat(64), bytes: 30 },
    };
    const executables = (f: { name: string }) => /\.(mjs|js|wasm|onnx|ort|bin)$/.test(f.name);

    it('POSITIVE CONTROL: served bytes matching the COMMITTED pins verifies', () => {
        const v = verifyAgainstCommittedPins(inv(), pins, { require: executables });
        expect(v.ok).toBe(true);
        expect(v.checked).toBe(3);
        expect(v.authority).toBe('committed_pins');
    });

    it('CASUALTY: a served file whose bytes disagree with its committed digest FAILS', () => {
        const bad = { ...pins, 'm/onnx/decoder_model.onnx': { sha256: 'f'.repeat(64), bytes: 30 } };
        const v = verifyAgainstCommittedPins(inv(), bad, { require: executables });
        expect(v.ok).toBe(false);
        expect((v as { failures: Array<{ kind: string }> }).failures.map((f) => f.kind)).toContain('hash_mismatch');
    });

    it('CASUALTY: an executable with NO committed pin FAILS — the worker-loaded-module case', () => {
        const missing = { ...pins };
        delete (missing as Record<string, unknown>)['lib/onnxruntime-web/dist/ort.mjs'];
        const v = verifyAgainstCommittedPins(inv(), missing, { require: executables });
        expect(v.ok).toBe(false);
        expect((v as { failures: Array<{ kind: string; detail: string }> }).failures[0].kind).toBe('unpinned');
    });

    it('CASUALTY: a served response with NO byte count fails a ledger that claims completeness', () => {
        const r = reconcileAssets(inv(), {
            'lib/onnxruntime-web/dist/ort.mjs': { bytes: null, status: 200, count: 1 },
        }, { requirePinned: false, requireCompleteLedger: true });
        expect(r.ok).toBe(false);
        expect(r.failures.map((f) => f.kind)).toContain('missing_byte_count');
        expect(r.failures.map((f) => f.kind)).toContain('declared_not_served');
        expect(r.observedBytes).toBeNull();
    });

    it('the reconciliation NAMES its authority instead of leaving it to be inferred', () => {
        const diag = reconcileAssets(inv(), {}, { requirePinned: false });
        expect(diag.ledgerAuthority).toBe('declared_pins_only');
        expect(diag.ledgerCoverage).toBeLessThan(1);
        const complete = reconcileAssets(inv(), {}, { requirePinned: false, requireCompleteLedger: true });
        expect(complete.ledgerAuthority).toBe('served_ledger');
    });

    it('the runner gates eligibility on the COMMITTED-pin authority, not on the diagnostic trace', () => {
        expect(RUNNER).toContain('verifyAgainstCommittedPins(');
        const clause = RUNNER.slice(RUNNER.indexOf('const selectionEligible = backendProven'), RUNNER.indexOf('const ineligible'));
        expect(clause).toContain('pinVerification.ok');
    });
});
