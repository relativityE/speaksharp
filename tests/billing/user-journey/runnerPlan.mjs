// The Stripe test-mode runner's smoke and full modes, as a plan. Offline only: this file makes no network call,
// reads no key and starts nothing. `--dry-run` prints what a run WOULD do and what still blocks it; it never
// authorizes a run. A real run still needs a written yes from Akin and Sam and the protected environment's
// reviewer approval, and goes through billing-local-stack-journey.yml.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';
import { parse } from 'yaml';
import { PENDING_POLICY, POLICY_PENDING_STEPS, REQUIRED_STEPS } from './journeySteps.mjs';
import { PENDING, destructionDefects, journeyReceiptDefects } from './localStackReceipt.mjs';
import { PROJECT_PATTERN } from './localStackResources.mjs';

export const MODES = ['smoke', 'full'];
const BILLING_CONFIG = 'playwright.billing-journey.config.ts';
const WORKFLOW = '.github/workflows/billing-local-stack-journey.yml';

/**
 * Every Stripe write any branch may make, by method and path with ids replaced by `:id`. All are test-mode
 * objects the run created itself. Anything else (charges, payouts, transfers, accounts, products, prices,
 * deleting customers or subscriptions directly, cancelling immediately) is refused.
 */
export const STRIPE_WRITE_ALLOWLIST = [
  'POST test_helpers/test_clocks',
  'POST test_helpers/test_clocks/:id/advance',
  'DELETE test_helpers/test_clocks/:id',
  'POST customers',
  'POST payment_methods/:id/attach',
  'POST subscriptions/:id',
  'POST invoices/:id/pay',
  'POST checkout/sessions/:id/expire',
  'POST refunds',
];
const FIXTURE_WRITES = ['POST test_helpers/test_clocks', 'POST customers', 'DELETE test_helpers/test_clocks/:id'];

/** Source facts a phase needs on the branch under test. Checked by reading files, never by calling anything. */
export const PREREQUISITES = {
  local_checkout_exception: {
    what: 'loopback-only test Checkout entry (stripe-checkout/localSandbox.ts, #1813)',
    check: read => read('backend/supabase/functions/stripe-checkout/localSandbox.ts') !== null,
  },
  payment_gate: {
    what: 'Upgrade button shown in the local test-mode sandbox (c9898bf8)',
    check: read => /\bisLocalPaymentsSandbox\b/.test(read('frontend/src/config/appRuntimeConfig.ts') ?? ''),
  },
  refund_handler: {
    what: 'webhook schedules cancel at period end on a refund (34dab357, bf683e66; ownership and price checks 4edd5288)',
    check: read => (read('backend/supabase/functions/stripe-webhook/refund.ts') ?? '').includes('refund-cancel-at-period-end-')
      && (read('backend/supabase/functions/stripe-webhook/index.ts') ?? '').includes('case "charge.refunded"'),
  },
  paid_loop_spec: {
    what: 'paid practice, repeat and return journey and its config (#1822)',
    check: read => read('tests/billing/user-journey/paid-value-loop.billing.spec.ts') !== null
      && read('playwright.paid-value-loop.config.ts') !== null,
  },
};

const browser = (id, modes, extra) => ({
  id, kind: 'browser_branch', modes, config: BILLING_CONFIG, grep: `billing ${id}:`,
  requires: ['local_checkout_exception', ...(extra.requires ?? [])],
  steps: REQUIRED_STEPS[id], pendingPolicySteps: POLICY_PENDING_STEPS[id] ?? [],
  stripeWrites: [...FIXTURE_WRITES, ...(extra.writes ?? [])],
  testCards: extra.cards ?? ['4242424242424242'], events: extra.events, proves: extra.proves,
});

/** In run order. Each phase has its own fixture, test and receipt; a failed phase does not hide another. */
export const PHASES = [
  browser('conversion', ['smoke', 'full'], {
    requires: ['payment_gate'],
    events: ['checkout.session.completed'],
    proves: 'Upgrade button, hosted Checkout, Stripe event, paid access, fresh sign-in, one paid recording',
  }),
  browser('renewal_recovery', ['full'], {
    writes: ['POST payment_methods/:id/attach', 'POST subscriptions/:id', 'POST invoices/:id/pay'],
    events: ['checkout.session.completed', 'invoice.payment_succeeded', 'invoice.payment_failed'],
    proves: 'renewal on the test clock, failed renewal revokes access, API recovery restores it',
  }),
  browser('portal_recovery', ['full'], {
    requires: ['payment_gate'],
    writes: ['POST payment_methods/:id/attach', 'POST subscriptions/:id'],
    events: ['checkout.session.completed', 'invoice.payment_failed', 'invoice.payment_succeeded'],
    proves: 'failed renewal revokes paid access; the customer adds a card and pays in Manage billing; paid access returns',
  }),
  browser('portal_expiry', ['full'], {
    requires: ['payment_gate'],
    events: ['checkout.session.completed', 'customer.subscription.updated', 'customer.subscription.deleted'],
    proves: 'cancel in the portal, paid to period end, the subscription ends, account and saved data kept; access after the end pending policy',
  }),
  browser('failed_checkout', ['full'], {
    writes: ['POST checkout/sessions/:id/expire'],
    cards: ['4000000000000002', '4242424242424242'],
    events: ['checkout.session.completed'],
    proves: 'declined card and abandoned session grant nothing; a retry converts to exactly one subscription',
  }),
  browser('refund_period_end', ['full'], {
    requires: ['refund_handler'],
    writes: ['POST refunds'],
    events: ['checkout.session.completed', 'charge.refunded', 'customer.subscription.updated', 'customer.subscription.deleted'],
    proves: 'full refund; the customer uses the balance of the month as Pro; then the membership ends with no second charge; access after the end pending policy',
  }),
  {
    id: 'paid_value_loop', kind: 'external_spec', modes: ['full'], config: 'playwright.paid-value-loop.config.ts',
    grep: 'billing paid_value_loop:', requires: ['local_checkout_exception', 'paid_loop_spec'],
    steps: [], pendingPolicySteps: [], stripeWrites: [...FIXTURE_WRITES], testCards: ['4242424242424242'], events: ['checkout.session.completed'],
    proves: 'paid practice with coaching, a linked repeat, comparison and a returning sign-in on one paid account',
    runtimeNeeds: ['GEMINI_API_KEY in the protected environment (coaching)'],
  },
];

/** Things a dry run cannot settle; listed so a plan never reads as more ready than it is. */
export const OPEN_QUESTIONS = [
  'portal_recovery: whether the Stripe portal itself pays the past-due invoice after the card is added; if it does not, the branch fails closed (portal_recovery_pay_unavailable), it is never switched to an API payment',
  'access after a membership ends (portal_expiry, refund_period_end): held until Akin confirms the end-of-access policy with Sam; those steps read PENDING_POLICY, are never asserted and can never pass, so full mode cannot say PASSED yet',
  'failed_checkout: whether the server lets a new Checkout start after an abandoned one is expired; a refusal fails the branch (retry_checkout_refused)',
];

export function readRepoFile(path) {
  try { return existsSync(path) ? readFileSync(path, 'utf8') : null; } catch { return null; }
}

/** Journey options the local-stack workflow can be dispatched with, and whether it picks each phase's config. */
export function workflowDispatch(read) {
  const text = read(WORKFLOW);
  if (text === null) return { options: [], configs: {} };
  const doc = parse(text);
  const options = doc?.on?.workflow_dispatch?.inputs?.journey?.options;
  const run = (doc?.jobs?.journey?.steps ?? []).map(step => step?.run ?? '').join('\n');
  const configs = {};
  for (const phase of PHASES) {
    const picks = phase.config === BILLING_CONFIG ? run.includes(BILLING_CONFIG)
      : run.includes(phase.config) && run.includes(`"$JOURNEY" = '${phase.id}'`);
    configs[phase.id] = picks;
  }
  return { options: Array.isArray(options) ? options.map(String) : [], configs };
}

/**
 * The dry-run plan for one mode. Pure apart from `read`, which only reads committed files. It never calls a
 * provider: a plan says READY only when every source prerequisite is present and the workflow can dispatch
 * the phase, and even then `authorizesExecution` stays false.
 */
export function planRun(mode, read = readRepoFile) {
  if (!MODES.includes(mode)) throw new Error('BILLING_RUNNER:mode_unknown');
  const dispatch = workflowDispatch(read);
  const phases = PHASES.filter(phase => phase.modes.includes(mode)).map(phase => {
    for (const write of phase.stripeWrites) {
      if (!STRIPE_WRITE_ALLOWLIST.includes(write)) throw new Error('BILLING_RUNNER:stripe_write_not_allowed');
    }
    const blockedBy = phase.requires.filter(name => !PREREQUISITES[name].check(read))
      .map(name => ({ prerequisite: name, what: PREREQUISITES[name].what }));
    if (!dispatch.options.includes(phase.id) || !dispatch.configs[phase.id]) {
      blockedBy.push({ prerequisite: 'workflow_dispatch', what: `${WORKFLOW} cannot dispatch ${phase.id} with ${phase.config}` });
    }
    return {
      id: phase.id, kind: phase.kind, status: blockedBy.length ? 'BLOCKED_PREREQUISITE' : 'READY', blockedBy,
      dispatch: { workflow: WORKFLOW, journey: phase.id, config: phase.config, grep: phase.grep,
        env: { BILLING_RUNNER_MODE: mode } },
      pendingPolicySteps: phase.pendingPolicySteps,
      stripeWrites: phase.stripeWrites, testCards: phase.testCards, events: phase.events, proves: phase.proves,
      runtimeNeeds: phase.runtimeNeeds ?? [],
    };
  });
  return {
    schema: 'billing-runner-plan/v1', mode, dryRun: true, stripeCalls: 0, authorizesExecution: false,
    result: phases.some(phase => phase.status !== 'READY') ? 'BLOCKED_PREREQUISITE'
      : phases.some(phase => phase.pendingPolicySteps.length) ? 'READY_WITH_PENDING_POLICY' : 'READY',
    phases, openQuestions: mode === 'full' ? OPEN_QUESTIONS : [],
  };
}

const COMBINED_KEYS = ['billingRowResidue', 'defects', 'journey', 'journeyReceipt', 'rawReceiptSha256', 'release', 'result',
  'schema', 'stackDestroyed', 'stackIdentitySha256', 'stackRun', 'stackStopped', 'stripeFixturesRemoved'].join(',');
const SHA = /^[0-9a-f]{40}$/;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
/** The raw receipt as handed over: the file's text, or better its exact bytes (readFileSync without an encoding). */
const isRawBytes = (value) => typeof value === 'string' || value instanceof Uint8Array;
const parseRaw = (value) => {
  try {
    const text = typeof value === 'string' ? value : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(value);
    return JSON.parse(text);
  } catch { return undefined; }
};
const sameList = (a, b) => Array.isArray(a) && a.length === b.length && a.every((value, i) => value === b[i]);

/**
 * Steps an external phase's receipt must prove, by phase. Empty until the phase's owner (#1822 for the paid
 * loop) commits its step list here, so until then that phase can only be NOT_PROVEN.
 */
export const EXTERNAL_REQUIRED_STEPS = Object.freeze({});

/**
 * One local-stack phase, re-validated from its evidence rather than trusted from a summary (Sam's fa7e7180
 * return: a bare {journey, result: 'PASSED'} must not pass). The run must hand over the combined receipt, the
 * raw journey receipt exactly as written, the stack's destruction proof and the identity list it was checked
 * against. The raw receipt is re-hashed and
 * re-checked step by step for this phase, this release and this stack; the combined receipt must have exactly
 * its schema's fields and agree; the destruction proof must be for the same stack. Returns the phase's result
 * and why it is not PASSED.
 */
function localPhaseResult(id, held, item, release) {
  if (!isObject(item) || !isObject(item.combined) || !isRawBytes(item.rawReceipt)) return { result: 'NOT_PROVEN', why: ['evidence_missing'] };
  const { combined, rawReceipt, destruction, identity } = item;
  const why = [];
  if (Object.keys(combined).sort().join(',') !== COMBINED_KEYS) why.push('combined_shape');
  if (combined.schema !== 'billing-local-stack-combined/v3') why.push('combined_schema');
  if (combined.journey !== id) why.push('combined_journey');
  if (combined.release !== release) why.push('combined_release');
  if (!PROJECT_PATTERN.test(`${combined.stackRun ?? ''}`)) why.push('combined_stack_run');
  if (createHash('sha256').update(rawReceipt).digest('hex') !== combined.rawReceiptSha256) why.push('raw_receipt_hash');
  for (const part of ['stackStopped', 'stackDestroyed', 'stripeFixturesRemoved']) if (combined[part] !== 'PASSED') why.push(`combined_${part}`);
  if (combined.billingRowResidue !== 'NOT_READ_DATABASE_DESTROYED') why.push('combined_residue');
  why.push(...destructionDefects(destruction, combined.stackRun, identity));
  if (typeof combined.stackIdentitySha256 !== 'string' || combined.stackIdentitySha256 !== destruction?.identitySha256) why.push('combined_identity');
  // The workflow writes the receipt file as a JSON array of the spec's receipt attachments (jq '[...]'), and the
  // combined receipt hashes that file's exact bytes (Sam's ac08d973 review). So the bytes hashed here are the
  // array's, the array must hold exactly one receipt, and that one element is what gets validated.
  const raw = parseRaw(rawReceipt);
  const journey = raw === undefined ? ['raw_receipt_unreadable']
    : !Array.isArray(raw) ? ['raw_receipt_not_workflow_array']
      : raw.length !== 1 ? ['raw_receipt_count']
        : journeyReceiptDefects(raw[0], { journey: id, release, stackRun: combined.stackRun });
  // A held phase's only allowed defect is the held policy, in the raw receipt and the combined one alike.
  const allowed = held ? ['policy_pending'] : [];
  if (!sameList(journey, allowed)) why.push(...journey.filter(defect => !allowed.includes(defect)), ...(held && !journey.includes('policy_pending') ? ['held_steps_not_pending'] : []));
  if (!sameList(combined.defects, allowed)) why.push('combined_defects');
  if (combined.journeyReceipt !== (held ? 'NOT_PROVEN' : PENDING)) why.push('combined_journey_receipt');
  if (combined.result !== (held ? 'NOT_PROVEN' : 'PASSED')) why.push('combined_result');
  return why.length ? { result: 'NOT_PROVEN', why: [...new Set(why)] } : { result: held ? PENDING_POLICY : 'PASSED', why: [] };
}

/** An external phase's hosted receipt, checked against the step list its owner committed. */
function externalPhaseResult(id, item, release) {
  const steps = EXTERNAL_REQUIRED_STEPS[id];
  if (!Array.isArray(steps) || steps.length === 0) return { result: 'NOT_PROVEN', why: ['external_contract_undefined'] };
  const receipt = isObject(item) && isRawBytes(item.rawReceipt) ? parseRaw(item.rawReceipt) ?? null : null;
  const why = [];
  if (!isObject(receipt)) return { result: 'NOT_PROVEN', why: ['evidence_missing'] };
  if (receipt.schema !== 'billing-user-journey/v1' || receipt.journey !== id) why.push('receipt_schema');
  if (receipt.stripeMode !== 'test') why.push('stripe_mode');
  if (receipt.testedRelease !== release) why.push('release_mismatch');
  if (receipt.result !== 'PASSED' || receipt.cleanup !== 'VERIFIED') why.push('not_passed');
  if (receipt.failureStage !== null || receipt.reason !== null) why.push('failure_recorded');
  if (!Array.isArray(receipt.steps) || receipt.steps.length !== steps.length
    || receipt.steps.some((row, i) => !isObject(row) || row.step !== steps[i] || row.result !== 'PASSED')) why.push('steps_not_all_passed');
  return why.length ? { result: 'NOT_PROVEN', why } : { result: 'PASSED', why: [] };
}

/**
 * One mode's result from its phases' evidence. Each entry is { phase, combined?, rawReceipt, destruction?, identity? }:
 * for a local-stack phase the combined receipt, the raw receipt file exactly as the workflow wrote it (a JSON array
 * holding the one journey receipt, as text or, better, as its bytes), the destruction proof and the
 * captured stack identity; for an
 * external phase the raw hosted receipt text. Every phase is re-validated for this release (`expected.release`)
 * on its own stack. PASSED only when every phase of the mode has exactly one entry and each re-validates. A phase
 * held only by the end-of-access policy is PENDING_POLICY, and the mode is then PENDING_POLICY, never PASSED. A
 * missing, duplicate, unknown, other-mode or unproven phase, or two phases on one stack, is NOT_PROVEN.
 */
export function finaliseModeReceipt(mode, entries, expected = {}) {
  if (!MODES.includes(mode)) throw new Error('BILLING_RUNNER:mode_unknown');
  const release = SHA.test(`${expected?.release ?? ''}`) ? expected.release : null;
  const expectedPhases = PHASES.filter(phase => phase.modes.includes(mode));
  const ids = expectedPhases.map(phase => phase.id);
  const list = Array.isArray(entries) ? entries : [];
  const problems = [];
  if (!release) problems.push('release_unknown');
  const seen = new Map();
  for (const item of list) {
    const id = isObject(item) ? item.phase : undefined;
    if (typeof id !== 'string' || !ids.includes(id)) { problems.push('unexpected_phase'); continue; }
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  const phases = expectedPhases.map(({ id, kind, pendingPolicySteps }) => {
    const count = seen.get(id) ?? 0;
    if (count > 1) problems.push(`duplicate_${id}`);
    const item = count === 1 ? list.find(entry => isObject(entry) && entry.phase === id) : null;
    const checked = !item || !release ? { result: 'NOT_PROVEN', why: [item ? 'release_unknown' : 'phase_missing'] }
      : kind === 'external_spec' ? externalPhaseResult(id, item, release)
        : localPhaseResult(id, pendingPolicySteps.length > 0, item, release);
    return { phase: id, result: checked.result, why: checked.why };
  });
  // Every local phase runs on its own disposable stack.
  const stacks = list.filter(entry => isObject(entry) && isObject(entry.combined)).map(entry => entry.combined.stackRun);
  if (new Set(stacks).size !== stacks.length) problems.push('stack_reused');
  const results = phases.map(phase => phase.result);
  return {
    schema: 'billing-runner-mode/v2', mode, release, phases, problems,
    result: problems.length || results.includes('NOT_PROVEN') ? 'NOT_PROVEN'
      : results.includes(PENDING_POLICY) ? PENDING_POLICY : 'PASSED',
  };
}

// CLI: node tests/billing/user-journey/runnerPlan.mjs --dry-run --mode full
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const mode = args[args.indexOf('--mode') + 1];
  if (!args.includes('--dry-run') || !args.includes('--mode')) {
    process.stderr.write('usage: runnerPlan.mjs --dry-run --mode smoke|full (planning only; nothing runs)\n');
    process.exit(2);
  }
  try {
    process.stdout.write(`${JSON.stringify(planRun(mode), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'BILLING_RUNNER:failed'}\n`);
    process.exit(1);
  }
}
