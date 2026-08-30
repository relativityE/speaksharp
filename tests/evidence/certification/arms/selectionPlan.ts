/**
 * #1304 — the COMMITTED targeted-selection plan.
 *
 * WHY THIS EXISTS. `--only` is a debugging subset: `resolveRetention` calls it one, and artifact and
 * checkpoint completeness are BOTH skipped when it is present. But an explicit `--out` still retains the
 * run, and `selectionEligible` never required a complete plan — so a four-arm `--only` command over the
 * corpus set could write four SELECTION-ELIGIBLE rows while silently omitting the rest of the matrix. The
 * artifact would look like selection evidence and be a fragment.
 *
 * A targeted run is therefore expressed as a COMMITTED PLAN, never an ad hoc command line. The plan names
 * every registered arm exactly once — measured, or preserved with a typed disposition — so an omission is
 * a completeness failure rather than an invisible gap.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ARM_MATRIX, NOT_EXECUTED_REASONS } from './registry';
import { UNSCOREABLE_DISPOSITIONS } from '../checkpoint';

export interface SelectionPlan {
    id: string;
    /** Arms that MUST produce a complete, selection-grade measurement. */
    measured: readonly string[];
    /** Every other registered arm, with the exact typed reason it was not measured. */
    dispositions: Readonly<Record<string, string>>;
}

/**
 * The PO-scoped four-arm finalist plan.
 *
 * Deliberately NOT the ten-arm SELECTION_EXECUTION_SET: the controlling scope is the targeted question
 * "which primary, which fallback", and re-running six arms that cannot change that answer is not made
 * correct by an old constant. The other arms are preserved with reasons, not dropped.
 */
export const TARGETED_FINALISTS_V1: SelectionPlan = Object.freeze({
    id: 'targeted-finalists-v1',
    measured: Object.freeze([
        'v2:base.en',                 // incumbent / fallback control
        'moonshine:streaming-medium', // preferred Moonshine primary prospect
        'v4:base:int8-decoder:cpu',   // preferred browser-v4 prospect (executes on browser WASM)
        'v4:base:q4-decoder:wasm',    // current browser-v4 control
    ]),
    dispositions: Object.freeze({
        // Registry-preserved, unchanged from the standing matrix.
        'v2:base.en:no-conditioning': 'invalid_runtime_option_unsupported',
        'v4:base:q4-decoder:cpu': 'diagnostic_duplicate_of_q4_wasm',
        'v4:base:q4-decoder:webgpu': 'not_run_hardware_unrepresentative',
        'v4:distil-small.en:q4-decoder:webgpu': 'not_run_hardware_unrepresentative',
        'v4:base:q8-decoder:cpu': 'alias_of_int8',
        // Excluded from THIS targeted question, each with its own reason rather than a blanket one.
        'v2:tiny.en': 'not_a_targeted_finalist',
        'v2:small.en': 'not_a_targeted_finalist',
        'v4:base:fp32-decoder:cpu': 'not_a_targeted_finalist',
        'moonshine:streaming-small': 'not_a_targeted_finalist',
        'moonshine:tiny': 'not_a_targeted_finalist',
        'moonshine:base': 'not_a_targeted_finalist',
    }),
});

/** Reasons a plan may use beyond the registry's own not-executed vocabulary. */
export const PLAN_DISPOSITIONS = Object.freeze(['not_a_targeted_finalist'] as const);

export const SELECTION_PLANS: Readonly<Record<string, SelectionPlan>> = Object.freeze({
    [TARGETED_FINALISTS_V1.id]: TARGETED_FINALISTS_V1,
});

/** Binds the plan FILE, so editing the plan changes run identity and no checkpoint can span the edit. */
export function selectionPlanDigest(planPath = 'tests/evidence/certification/arms/selectionPlan.ts'): string {
    return createHash('sha256').update(readFileSync(planPath)).digest('hex').slice(0, 32);
}

export type PlanVerdict =
    | { ok: true }
    | { ok: false; reason: 'plan_incomplete' | 'plan_duplicate' | 'plan_unregistered' | 'plan_wrong_reason'; detail: string };

/**
 * Does this plan account for EVERY registered arm exactly once?
 *
 * Checked on the plan itself, before a run starts — a plan that omits an arm would otherwise only be
 * discovered as a missing row hours later.
 */
export function validatePlanCoverage(plan: SelectionPlan): PlanVerdict {
    const registered = ARM_MATRIX.map((a) => a.id);
    const named = [...plan.measured, ...Object.keys(plan.dispositions)];

    const dupes = named.filter((id, i) => named.indexOf(id) !== i);
    if (dupes.length) return { ok: false, reason: 'plan_duplicate', detail: [...new Set(dupes)].sort().join(', ') };

    const unregistered = named.filter((id) => !registered.includes(id));
    if (unregistered.length) return { ok: false, reason: 'plan_unregistered', detail: unregistered.sort().join(', ') };

    const missing = registered.filter((id) => !named.includes(id));
    if (missing.length) return { ok: false, reason: 'plan_incomplete', detail: missing.sort().join(', ') };

    // A disposition the registry already fixes must MATCH it — a plan may exclude an arm, never rename
    // the reason another authority already recorded for it.
    for (const [id, reason] of Object.entries(plan.dispositions)) {
        const registryReason = NOT_EXECUTED_REASONS[id];
        if (registryReason && reason !== registryReason) {
            return { ok: false, reason: 'plan_wrong_reason', detail: `${id}: '${reason}' != registry '${registryReason}'` };
        }
        const known = registryReason !== undefined
            || (PLAN_DISPOSITIONS as readonly string[]).includes(reason)
            || (UNSCOREABLE_DISPOSITIONS as readonly string[]).includes(reason);
        if (!known) return { ok: false, reason: 'plan_wrong_reason', detail: `${id}: unregistered reason '${reason}'` };
    }
    return { ok: true };
}

export type PlanCompleteness =
    | { ok: true }
    | { ok: false; reason: 'missing_measured' | 'missing_disposition' | 'unexpected_arm' | 'duplicate_arm' | 'not_selection_grade' | 'wrong_reason'; detail: string };

/**
 * Can these rows finalize as evidence for this plan?
 *
 * Every measured finalist must be present AND selection-grade; every other registered arm must be present
 * with its planned reason. A four-row artifact can never satisfy this.
 */
export function validateAgainstPlan(
    rows: readonly { id: string; [k: string]: unknown }[],
    plan: SelectionPlan,
    isSelectionGrade: (row: { id: string; [k: string]: unknown }) => boolean,
): PlanCompleteness {
    const ids = rows.map((r) => r.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length) return { ok: false, reason: 'duplicate_arm', detail: [...new Set(dupes)].sort().join(', ') };

    const planned = new Set<string>([...plan.measured, ...Object.keys(plan.dispositions)]);
    const unexpected = ids.filter((id) => !planned.has(id));
    if (unexpected.length) return { ok: false, reason: 'unexpected_arm', detail: unexpected.sort().join(', ') };

    const byId = new Map(rows.map((r) => [r.id, r]));
    const missingMeasured = plan.measured.filter((id) => !byId.has(id));
    if (missingMeasured.length) return { ok: false, reason: 'missing_measured', detail: missingMeasured.sort().join(', ') };

    for (const id of plan.measured) {
        if (!isSelectionGrade(byId.get(id)!)) {
            return { ok: false, reason: 'not_selection_grade', detail: id };
        }
    }

    const missingDisposition = Object.keys(plan.dispositions).filter((id) => !byId.has(id));
    if (missingDisposition.length) {
        return { ok: false, reason: 'missing_disposition', detail: missingDisposition.sort().join(', ') };
    }
    for (const [id, reason] of Object.entries(plan.dispositions)) {
        const row = byId.get(id)!;
        const actual = (row.reason ?? row.disposition) as string | undefined;
        if (actual !== reason) {
            return { ok: false, reason: 'wrong_reason', detail: `${id}: '${String(actual)}' != planned '${reason}'` };
        }
    }
    return { ok: true };
}
