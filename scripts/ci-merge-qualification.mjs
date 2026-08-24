// CI-GATE (#1328) — fail-closed merge qualification.
//
// WHY THIS EXISTS. A workflow-level `success` is not evidence that anything ran. On a Draft PR the
// substantive lane is gated behind `scope.outputs.full_required`, every substantive job reports
// `skipped`, and `report` — which carries `if: always() && !cancelled()` — still succeeds. GitHub does
// not fail a run for skipped jobs, so the run concludes `success` having executed no build, no unit
// shard, no e2e shard, and no evidence job.
//
// That is not hypothetical. #1306 was ACCEPTED and merged at head d89213f4 on run 32686056839, which
// reported success with build / e2e-shard / unit-shard / edge-tests / full-evidence all skipped. No
// test executed at that head and `main` went red across 16 e2e spec files on merge. Run 32742595731 is
// a second, captured specimen of the identical shape.
//
// THE DECISION IS PURE so every rejection path is unit-falsifiable without spending a CI cycle: the
// workflow's only job is to collect `needs.<job>.result` and hand this function a map.
//
// FAIL CLOSED means exactly that: qualification requires an explicit `success` from every required
// job. `skipped`, `cancelled`, `failure`, an unknown state, `null`, and a MISSING key are all
// rejections. A guard that only rejects the failures it can name is not a guard — a job silently
// dropped from the workflow's `needs:` list must break qualification, not vanish from it.

/**
 * Jobs that must each report `success` before a run may be called merge-qualified.
 *
 * `e2e` and `unit-shard` are matrix parents: GitHub reports a matrix parent as `success` only when
 * every leg succeeded, so naming the parent covers all shards without hardcoding a shard count that
 * would silently stop matching if the matrix were resized.
 *
 * `draft-checks` is deliberately ABSENT. It is diagnostic feedback, never authority — including it
 * would let the draft lane contribute to qualification, which is the precise defect this prevents.
 */
export const REQUIRED_JOBS = Object.freeze([
  'scope',
  'build',
  'edge-tests',
  'unit-shard',
  'unit-coverage-merge',
  'e2e',
  'health-check',
  'full-evidence',
]);

/** The only conclusion that may contribute to qualification. */
const PASSING = 'success';

/**
 * Decide whether a run is merge-qualified.
 *
 * @param {object} input
 * @param {unknown} input.fullRequired  `scope.outputs.full_required` as the workflow saw it (string
 *   'true' from GitHub expressions, or a real boolean when called from tests).
 * @param {Record<string, unknown>} input.results  job name -> `needs.<job>.result`.
 * @param {readonly string[]} [input.required]  override for tests; defaults to REQUIRED_JOBS.
 * @returns {{qualified: boolean, reasons: string[], evaluated: Array<{job: string, result: string}>}}
 */
export function evaluateMergeQualification({ fullRequired, results, required = REQUIRED_JOBS } = {}) {
  const reasons = [];

  // A non-object `results` must not be coerced into "nothing to check, therefore fine".
  const map = (results && typeof results === 'object' && !Array.isArray(results)) ? results : null;
  if (map === null) {
    return {
      qualified: false,
      reasons: ['results_not_provided'],
      evaluated: [],
    };
  }

  // The full lane must have been REQUESTED at all. Without this a draft/partial run whose required
  // jobs are all absent would be judged only by the loop below; this states the intent directly and
  // gives the operator the accurate reason rather than eight identical "missing" lines.
  const full = fullRequired === true || fullRequired === 'true';
  if (!full) {
    reasons.push('full_lane_not_required:draft_or_partial_run_is_not_merge_qualified');
  }

  const evaluated = [];
  for (const job of required) {
    // `in` rather than a truthiness check: a job present with result `null` is a different failure
    // from a job that was never wired into `needs:`, and both must be rejected with the right reason.
    const present = Object.prototype.hasOwnProperty.call(map, job);
    const raw = present ? map[job] : undefined;
    const result = (raw === null || raw === undefined || raw === '') ? (present ? 'empty' : 'missing') : String(raw);
    evaluated.push({ job, result });
    if (result !== PASSING) reasons.push(`${job}:${result}`);
  }

  return { qualified: reasons.length === 0, reasons, evaluated };
}

/**
 * Render the decision for a workflow log / step summary. Reason codes only — job names and
 * conclusions are not sensitive, but nothing else is echoed.
 */
export function formatQualification(decision) {
  const lines = decision.evaluated.map(({ job, result }) =>
    `${result === PASSING ? 'ok  ' : 'FAIL'}  ${job}: ${result}`);
  lines.push(decision.qualified
    ? 'MERGE-QUALIFIED: every required job reported success'
    : `NOT MERGE-QUALIFIED: ${decision.reasons.join(', ')}`);
  return lines.join('\n');
}
