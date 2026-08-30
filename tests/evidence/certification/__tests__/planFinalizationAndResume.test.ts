import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TARGETED_FINALISTS_V1, finalizeUnderPlan, selectionPlanDigest } from '../arms/selectionPlan';
import { NOT_EXECUTED_REASONS } from '../arms/registry';
import { planResume, type RunIdentity, type CheckpointRow } from '../checkpoint';

/**
 * #1304 — the SELECTION-PLAN path, end to end.
 *
 * r7 never exercised this path: its identity had no plan, so it could not have revealed the two defects
 * that mattered most —
 *   a) the runner ran the plan validator AND the legacy completeness validator, which do not agree about
 *      `not_a_targeted_finalist`, so a complete targeted run could decode for hours and be refused only
 *      at promotion; and
 *   b) disposition rows were appended before `alreadyDone` was consulted, so a resumed run failed its own
 *      duplicate-arm check.
 * A preflight that skips the path cannot qualify the path.
 */
const PLAN = TARGETED_FINALISTS_V1;
const RELIABLE = { decoded: 600, expectedClips: 600, threw: 0, emptyOutput: 0, missing: 0, timedOut: 0, audioRejected: 0, truncated: 0 };

const measured = (id: string) => ({
    id, selectionEligible: true, verdict: { ok: true }, backendProven: true,
    expectedClips: 600, decodedClips: 600, reliability: { ...RELIABLE },
});
const disposed = (id: string) => ({ id, executed: false, reason: PLAN.dispositions[id] });
const allFifteen = () => [...PLAN.measured.map(measured), ...Object.keys(PLAN.dispositions).map(disposed)];

const identity = (over: Partial<RunIdentity> = {}): RunIdentity => ({
    productBaseline: '8f770766', executionSha: 'aaaaaaaa', policySha: 'bbbbbbbb',
    corpusDigest: 'cccccccc', normalizerId: 'norm_v2', registryDigest: 'dddddddd',
    assetDigest: 'eeeeeeee', setName: 'corpus', evidenceClass: 'selection',
    selectionPlanId: PLAN.id, selectionPlanDigest: selectionPlanDigest(), ...over,
});

describe('the REAL finalization chain the runner uses', () => {
    it('POSITIVE CONTROL: all 15 planned rows finalize', () => {
        const rows = allFifteen();
        expect(rows).toHaveLength(15);
        expect(finalizeUnderPlan(rows, PLAN)).toEqual({ ok: true });
    });

    it('the six not_a_targeted_finalist rows do not fail a second, disagreeing authority', () => {
        // The exact defect: the plan accepts this reason and the legacy registry does not.
        const planOnly = Object.entries(PLAN.dispositions).filter(([id]) => NOT_EXECUTED_REASONS[id] === undefined);
        expect(planOnly).toHaveLength(6);
        for (const [, reason] of planOnly) expect(reason).toBe('not_a_targeted_finalist');
        expect(finalizeUnderPlan(allFifteen(), PLAN)).toEqual({ ok: true });
    });

    it('the runner uses THIS function, not a second description of the rule', () => {
        const runner = readFileSync(resolve(__dirname, '../../../../scripts/run-browser-matrix.mts'), 'utf8');
        expect(runner).toContain('finalizeUnderPlan(');
        // ...and the legacy validator is NOT also run when a plan is active.
        expect(runner).toContain('if (!onlyIds && !selectionPlan) {');
        expect(runner).toContain('if (outPath && !onlyIds && !selectionPlan) {');
    });

    it.each([
        ['a missing measured finalist', () => allFifteen().filter((r) => r.id !== 'v2:base.en'), 'missing_measured'],
        ['a missing disposition', () => allFifteen().filter((r) => r.id !== 'moonshine:tiny'), 'missing_disposition'],
        ['a duplicated row', () => [...allFifteen(), measured('v2:base.en')], 'duplicate_arm'],
        ['an arm measured that should be disposed', () => allFifteen().map((r) => r.id === 'moonshine:tiny' ? measured(r.id) : r), 'wrong_reason'],
        ['an arm disposed that should be measured', () => allFifteen().map((r) => r.id === 'v2:base.en' ? disposed('moonshine:tiny') : r), 'duplicate_arm'],
        ['a wrong disposition reason', () => allFifteen().map((r) => r.id === 'moonshine:base' ? { id: r.id, executed: false, reason: 'alias_of_int8' } : r), 'wrong_reason'],
        ['a finalist whose reliability is dirty', () => allFifteen().map((r) => r.id === 'v4:base:int8-decoder:cpu' ? { ...measured(r.id), reliability: { ...RELIABLE, truncated: 1 } } : r), 'not_selection_grade'],
    ])('CASUALTY: %s refuses finalization', (_l, build, reason) => {
        const v = finalizeUnderPlan(build() as { id: string }[], PLAN);
        expect(v.ok).toBe(false);
        expect((v as { reason: string }).reason).toBe(reason);
    });
});

describe('plan identity gates RESUME', () => {
    const rows = [measured('v2:base.en')] as CheckpointRow[];
    const cp = (id: RunIdentity) => ({ partial: true as const, identity: id, rows });

    it('POSITIVE CONTROL: an identical plan resumes', () => {
        const d = planResume(cp(identity()), identity());
        expect(d.kind).toBe('resume');
    });

    it('CASUALTY: a DIFFERENT plan id refuses resume', () => {
        const d = planResume(cp(identity({ selectionPlanId: 'some-other-plan' })), identity());
        expect(d.kind).toBe('start-clean');
        expect((d as { reason: string }).reason).toContain('selectionPlanId');
    });

    it('CASUALTY: an EDITED plan (same id, different digest) refuses resume', () => {
        // Editing the plan changes what "complete" means; the digest is what notices.
        const d = planResume(cp(identity({ selectionPlanDigest: 'ffffffffffffffffffffffffffffffff' })), identity());
        expect(d.kind).toBe('start-clean');
        expect((d as { reason: string }).reason).toContain('selectionPlanDigest');
    });
});

describe('resume is duplicate-safe and still finalizes', () => {
    it('a resumed run produces exactly 15 UNIQUE rows and passes the real chain', () => {
        // Start from a checkpoint holding one measured finalist, one registry disposition, and one
        // plan-only `not_a_targeted_finalist` — the three shapes that must not be re-appended.
        const retained = [
            measured('v2:base.en'),
            disposed('v4:base:q8-decoder:cpu'),      // registry reason: alias_of_int8
            disposed('moonshine:tiny'),              // plan reason: not_a_targeted_finalist
        ];
        const d = planResume({ partial: true, identity: identity(), rows: retained as CheckpointRow[] }, identity());
        expect(d.kind).toBe('resume');
        const alreadyDone = new Set(d.kind === 'resume' ? d.completed : []);
        expect(alreadyDone.size).toBe(3);

        // Replay what the runner does: append only what is NOT already retained.
        const rows = [...(d.kind === 'resume' ? d.rows : [])] as { id: string; [k: string]: unknown }[];
        for (const id of PLAN.measured) if (!alreadyDone.has(id)) rows.push(measured(id));
        for (const id of Object.keys(PLAN.dispositions)) if (!alreadyDone.has(id)) rows.push(disposed(id));

        expect(rows).toHaveLength(15);
        expect(new Set(rows.map((r) => r.id)).size).toBe(15);
        expect(finalizeUnderPlan(rows, PLAN)).toEqual({ ok: true });
    });

    it('the runner checks alreadyDone BEFORE appending a disposition row', () => {
        const runner = readFileSync(resolve(__dirname, '../../../../scripts/run-browser-matrix.mts'), 'utf8');
        const block = runner.slice(runner.indexOf('if (selectionPlan && !selectionPlan.measured.includes(spec.id))'));
        const guard = block.indexOf('alreadyDone.has(spec.id)');
        const push = block.indexOf('results.push({ id: spec.id');
        expect(guard).toBeGreaterThan(-1);
        expect(guard).toBeLessThan(push);
    });
});
