// Combined receipt for the disposable local stack. No network, no secrets, no provider content.
//
// On the local stack the journey cannot read three billing tables (service_role has no access), so its own
// receipt can at best say PENDING_STACK_DESTRUCTION. Only this step, run after the CHECKED teardown and the
// destruction proof, may turn that into PASSED. Anything missing, unknown or failed is NOT_PROVEN.
//
// Sam's #1813 return (c): a receipt holding only the PENDING/residue fields is not a journey. Before promoting,
// the receipt must be exactly the spec's shape, for the journey this run was dispatched for, with every one of
// that journey's steps PASSED, for this run's release and this run's stack; the destruction proof must be for
// the same stack; and the combined result carries the raw receipt's sha256, so the two stay bound to one run.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { LOCAL_STACK_JOURNEYS, PENDING_POLICY, POLICY_PENDING_STEPS, REQUIRED_STEPS } from './journeySteps.mjs';
import { DESTROYED_SCHEMA, PROJECT_PATTERN, stackIdentitySha256 } from './localStackResources.mjs';

export const PENDING = 'PENDING_STACK_DESTRUCTION';
export const RECEIPT_KEYS = Object.freeze(['billingRowResidue', 'cleanup', 'failureStage', 'journey', 'reason', 'result',
  'schema', 'stackRun', 'steps', 'stripeMode', 'testedRelease']);
const SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Every reason a journey receipt is not this run's finished, pending-destruction journey. Empty = ready. */
export function journeyReceiptDefects(receipt, expected) {
  const defects = [];
  if (!isObject(receipt)) return ['receipt_not_an_object'];
  const keys = Object.keys(receipt).sort().join(',');
  if (keys !== RECEIPT_KEYS.join(',')) defects.push('receipt_shape');
  if (receipt.schema !== 'billing-user-journey/v1') defects.push('receipt_schema');
  if (!LOCAL_STACK_JOURNEYS.includes(expected?.journey)) defects.push('expected_journey_unknown');
  if (receipt.journey !== expected?.journey) defects.push('journey_not_dispatched');
  if (receipt.stripeMode !== 'test') defects.push('stripe_mode');
  // Access after a membership ends is on hold: a journey that reached it cannot be promoted.
  if (receipt.result === PENDING_POLICY) defects.push('policy_pending');
  else if (receipt.result !== PENDING) defects.push('result_not_pending');
  if (receipt.cleanup !== PENDING) defects.push('cleanup_not_pending');
  if (receipt.billingRowResidue !== 'NOT_READ_REQUIRES_STACK_DESTRUCTION_PROOF') defects.push('residue_claim');
  if (receipt.failureStage !== null || receipt.reason !== null) defects.push('failure_recorded');
  if (!SHA.test(`${expected?.release ?? ''}`) || receipt.testedRelease !== expected.release) defects.push('release_mismatch');
  if (!PROJECT_PATTERN.test(`${expected?.stackRun ?? ''}`) || receipt.stackRun !== expected.stackRun) defects.push('stack_run_mismatch');
  const required = REQUIRED_STEPS[expected?.journey] ?? [];
  // Access after a membership ends is on hold (POLICY_PENDING_STEPS). Only those steps, and only in a receipt
  // that says PENDING_POLICY, may read PENDING_POLICY; every other step must be PASSED. Such a receipt still
  // carries the policy_pending defect, so it can never be promoted to PASSED.
  const pending = receipt.result === PENDING_POLICY ? POLICY_PENDING_STEPS[expected?.journey] ?? [] : [];
  const steps = Array.isArray(receipt.steps) ? receipt.steps : null;
  if (!steps || required.length === 0 || steps.length !== required.length
    || steps.some((entry, i) => !isObject(entry) || Object.keys(entry).sort().join(',') !== 'result,step'
      || entry.step !== required[i]
      || entry.result !== (pending.includes(required[i]) ? PENDING_POLICY : 'PASSED'))) defects.push('steps_not_all_passed');
  return defects;
}

/** The captured identity's digest for this stack, or null when the identity is missing, foreign or malformed. */
function identityDigest(identity, stackRun) {
  try { return stackIdentitySha256(identity, stackRun); } catch { return null; }
}

/**
 * Every reason a destruction proof is not this stack's. Empty = proven. The proof must name, by sha256, the
 * exact identity list captured after creation (kept as evidence beside it), and agree with that list on the
 * database and on how many of each resource were checked.
 */
export function destructionDefects(destruction, stackRun, identity) {
  if (!isObject(destruction)) return ['destruction_proof_missing'];
  const defects = [];
  if (destruction.schema !== DESTROYED_SCHEMA || destruction.destroyed !== true) defects.push('destruction_proof_shape');
  if (destruction.project !== stackRun) defects.push('destruction_not_this_run');
  for (const field of ['containers', 'volumes', 'networks']) {
    if (!Number.isSafeInteger(destruction[field]) || destruction[field] < 1) defects.push(`destruction_${field}`);
  }
  if (!/^[0-9]{1,20}$/.test(`${destruction.databaseSystemIdentifier ?? ''}`)) defects.push('destruction_database');
  const digest = identityDigest(identity, stackRun);
  if (!digest) return [...defects, 'stack_identity_invalid'];
  if (destruction.identitySha256 !== digest) defects.push('destruction_identity_mismatch');
  if (destruction.databaseSystemIdentifier !== identity.database.systemIdentifier) defects.push('destruction_database');
  if (destruction.containers !== identity.containers.length || destruction.volumes !== identity.volumes.length
    || destruction.networks !== identity.networks.length) defects.push('destruction_counts_mismatch');
  return [...new Set(defects)];
}

/**
 * @param {unknown} journeyReceipts the spec's receipt attachments (array; exactly one)
 * @param {{ stackStopped?: string, stackDestroyed?: string, stripeClean?: string }} checks GitHub step outcomes
 * @param {{ journey?: string, release?: string, stackRun?: string, receiptSha256?: string, destruction?: unknown, identity?: unknown }} expected
 */
export function finaliseLocalStackReceipt(journeyReceipts, checks, expected = {}) {
  const outcome = (value) => (value === 'success' ? 'PASSED' : 'NOT_PROVEN');
  const parts = {
    stackStopped: outcome(checks?.stackStopped),
    stackDestroyed: outcome(checks?.stackDestroyed),
    stripeFixturesRemoved: outcome(checks?.stripeClean),
  };
  const receipts = Array.isArray(journeyReceipts) ? journeyReceipts : [];
  const defects = receipts.length === 1 ? journeyReceiptDefects(receipts[0], expected) : ['receipt_count'];
  if (!SHA256.test(`${expected.receiptSha256 ?? ''}`)) defects.push('raw_receipt_unhashed');
  const destruction = destructionDefects(expected.destruction, expected.stackRun, expected.identity);
  if (parts.stackDestroyed === 'PASSED' && destruction.length) parts.stackDestroyed = 'NOT_PROVEN';
  const all = [...defects, ...destruction];
  const passed = all.length === 0 && Object.values(parts).every((value) => value === 'PASSED');
  return {
    schema: 'billing-local-stack-combined/v3',
    // What this run was dispatched for, never read from the receipt.
    journey: LOCAL_STACK_JOURNEYS.includes(expected.journey) ? expected.journey : null,
    release: SHA.test(`${expected.release ?? ''}`) ? expected.release : null,
    stackRun: PROJECT_PATTERN.test(`${expected.stackRun ?? ''}`) ? expected.stackRun : null,
    rawReceiptSha256: SHA256.test(`${expected.receiptSha256 ?? ''}`) ? expected.receiptSha256 : null,
    // The captured stack-identity list the destruction proof was checked against, kept beside it as evidence.
    stackIdentitySha256: identityDigest(expected.identity, expected.stackRun),
    journeyReceipt: defects.length === 0 ? PENDING : 'NOT_PROVEN',
    ...parts,
    // The rows were never read; they are covered only because the whole database was destroyed.
    billingRowResidue: parts.stackDestroyed === 'PASSED' ? 'NOT_READ_DATABASE_DESTROYED' : 'NOT_READ_NOT_PROVEN',
    defects: all,
    result: passed ? 'PASSED' : 'NOT_PROVEN',
  };
}

const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
const sha256Of = (file) => { try { return createHash('sha256').update(readFileSync(file)).digest('hex'); } catch { return null; } };

// CLI: node localStackReceipt.mjs --receipt <f> --destruction <f> --identity <f> --journey <j> --release <sha> --run <project>
//        --stack-stopped <outcome> --stack-destroyed <outcome> --stripe-clean <outcome>
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const names = ['receipt', 'destruction', 'identity', 'journey', 'release', 'run', 'stack-stopped', 'stack-destroyed', 'stripe-clean'];
  let values = {};
  try {
    ({ values } = parseArgs({ options: Object.fromEntries(names.map(n => [n, { type: 'string' }])), strict: true }));
  } catch { values = {}; }
  const combined = finaliseLocalStackReceipt(readJson(values.receipt ?? ''),
    { stackStopped: values['stack-stopped'], stackDestroyed: values['stack-destroyed'], stripeClean: values['stripe-clean'] },
    { journey: values.journey, release: values.release, stackRun: values.run,
      receiptSha256: sha256Of(values.receipt ?? '') ?? undefined, destruction: readJson(values.destruction ?? ''),
      identity: readJson(values.identity ?? '') });
  process.stdout.write(`${JSON.stringify(combined, null, 2)}\n`);
  process.exitCode = combined.result === 'PASSED' ? 0 : 1;
}
