// Combined receipt for J1.f and J7.d on the disposable billing stack. No network, no secrets, no account ids.
//
// The billing finalizer (localStackReceipt.mjs) counts a test account as gone because the whole stack was destroyed.
// That can never count as deletion: a run that never deleted anyone would still end with an empty, destroyed stack.
// So deletion is scored here, per leg, from what the spec read BEFORE teardown, and each leg also needs the same
// checked teardown, destruction proof and Stripe residue check the billing journeys need. Anything missing, unknown,
// shared between the two accounts or failed is NOT_PROVEN.
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { destructionDefects } from './localStackReceipt.mjs';
import { PROJECT_PATTERN } from './localStackResources.mjs';

export const DELETION_RECEIPT_SCHEMA = 'account-deletion-local/v2';
/** Each leg is its own account, reached from its own entry route. */
export const DELETION_LEGS = Object.freeze({ 'J1.f': 'trial_wall', 'J7.d': 'account_page' });
export const DELETION_RECEIPT_KEYS = Object.freeze(['accounts', 'schema', 'stackRun', 'stripeMode', 'testedRelease']);
/**
 * One account's evidence, read from the stack before teardown:
 * - accountRef: sha256 of the run's user id (never the id itself), so the two legs can be told apart;
 * - closurePhase: the closure attempt's phase, which must be terminal ('completed');
 * - authUserAbsent: the Auth user row is gone;
 * - residueVerified: the shipped `verify_account_closure_residue` answered true for that user;
 * - fallbackCleanup: 'NOT_RUN'. If the run's own cleanup helper touched this account, the zero is the helper's, not the
 *   product's, so the leg can never pass (Sam: fallback cleanup never earns a PASS).
 * And what the BROWSER observed for that account (Sam on a718da25: backend deletion alone is not the journey):
 * - entryReached: the leg's own entry (wall or Account page) opened /account/delete;
 * - verificationObserved: the one deletion link arrived in Mailpit for this address and was opened;
 * - terminalUi: the page's own final message; only 'deleted' passes.
 * And both sides of the retention promise, read before any fallback (accountDeletionJourney.ts RETENTION_POLICY):
 * - signInRefused: a real password sign-in with the account's own credentials was refused by Auth after deletion;
 * - retainedData: 'PASS' only when every record type still tied to the user is one the policy allows ('GAP' names a type the
 *   policy does not, 'FAIL' a broken promise, 'UNREAD' an unreadable count); retainedGaps lists the GAP types by name.
 */
export const DELETION_ACCOUNT_KEYS = Object.freeze(['accountRef', 'authUserAbsent', 'closurePhase', 'entryReached', 'fallbackCleanup', 'leg',
  'residueVerified', 'retainedData', 'retainedGaps', 'route', 'signInRefused', 'terminalUi', 'verificationObserved']);
const RETAINED_DEFECT = Object.freeze({ GAP: 'retained_data_gap', FAIL: 'retained_data_violation' });
const SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const sameKeys = (value, keys) => isObject(value) && Object.keys(value).sort().join(',') === keys.join(',');

/** Every reason one leg's account did not reach terminal deletion with zero residue. Empty = proven. */
function accountDefects(account, leg) {
  if (!sameKeys(account, DELETION_ACCOUNT_KEYS)) return ['account_shape'];
  const defects = [];
  if (account.route !== DELETION_LEGS[leg]) defects.push('route_mismatch');
  if (!SHA256.test(`${account.accountRef ?? ''}`)) defects.push('account_ref');
  if (account.closurePhase !== 'completed') defects.push('deletion_not_terminal');
  if (account.authUserAbsent !== true) defects.push('auth_user_present');
  if (account.residueVerified !== true) defects.push('residue_not_zero');
  if (account.fallbackCleanup !== 'NOT_RUN') defects.push('fallback_cleanup_ran');
  if (account.entryReached !== true) defects.push('entry_not_reached');
  if (account.verificationObserved !== true) defects.push('verification_not_observed');
  if (account.terminalUi !== 'deleted') defects.push('terminal_ui_not_deleted');
  if (account.signInRefused !== true) defects.push('sign_in_not_refused');
  if (account.retainedData !== 'PASS') defects.push(Object.hasOwn(RETAINED_DEFECT, `${account.retainedData}`) ? RETAINED_DEFECT[account.retainedData] : 'retained_data_unread');
  // A GAP must name its types and a PASS names none (a FAIL may also carry gaps); each is a schema.table.column name only.
  if (!Array.isArray(account.retainedGaps) || !account.retainedGaps.every((t) => /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(`${t}`))
    || (account.retainedData === 'GAP' && account.retainedGaps.length === 0)
    || (account.retainedData === 'PASS' && account.retainedGaps.length > 0)) defects.push('retained_gaps_shape');
  return defects;
}

/**
 * @param {unknown} receipt the spec's deletion receipt (written before teardown)
 * @param {{ journeys?: string, stackStopped?: string, stackDestroyed?: string, stripeClean?: string }} checks GitHub step outcomes;
 *   `journeys` is the Playwright step's own outcome, which must be 'success' (a failed browser assertion is never a pass)
 * @param {{ release?: string, stackRun?: string, destruction?: unknown, identity?: unknown }} expected
 */
export function finaliseDeletionReceipt(receipt, checks, expected = {}) {
  const outcome = (value) => (value === 'success' ? 'PASSED' : 'NOT_PROVEN');
  const teardown = {
    stackStopped: outcome(checks?.stackStopped),
    stackDestroyed: outcome(checks?.stackDestroyed),
    stripeFixturesRemoved: outcome(checks?.stripeClean),
  };
  const destruction = destructionDefects(expected.destruction, expected.stackRun, expected.identity);
  if (destruction.length) teardown.stackDestroyed = 'NOT_PROVEN';

  const run = [];
  if (checks?.journeys !== 'success') run.push('journey_step_failed');
  if (!sameKeys(receipt, DELETION_RECEIPT_KEYS)) run.push('receipt_shape');
  if (receipt?.schema !== DELETION_RECEIPT_SCHEMA) run.push('receipt_schema');
  if (receipt?.stripeMode !== 'test') run.push('stripe_mode');
  if (!SHA.test(`${expected.release ?? ''}`) || receipt?.testedRelease !== expected.release) run.push('release_mismatch');
  if (!PROJECT_PATTERN.test(`${expected.stackRun ?? ''}`) || receipt?.stackRun !== expected.stackRun) run.push('stack_run_mismatch');

  const accounts = Array.isArray(receipt?.accounts) ? receipt.accounts : [];
  if (accounts.length !== Object.keys(DELETION_LEGS).length) run.push('account_count');
  const refs = accounts.map((a) => (isObject(a) ? a.accountRef : undefined));
  if (new Set(refs).size !== refs.length) run.push('accounts_not_distinct');

  const torn = Object.values(teardown).every((value) => value === 'PASSED');
  const legs = {};
  const legDefects = {};
  for (const leg of Object.keys(DELETION_LEGS)) {
    const mine = accounts.filter((a) => isObject(a) && a.leg === leg);
    legDefects[leg] = mine.length === 1 ? accountDefects(mine[0], leg) : ['leg_account_count'];
    legs[leg] = run.length === 0 && torn && legDefects[leg].length === 0 ? 'PASSED' : 'NOT_PROVEN';
  }
  return {
    schema: 'account-deletion-combined/v1',
    release: SHA.test(`${expected.release ?? ''}`) ? expected.release : null,
    stackRun: PROJECT_PATTERN.test(`${expected.stackRun ?? ''}`) ? expected.stackRun : null,
    ...teardown,
    legs,
    // Stack destruction is cleanup of the run, never evidence that either account was deleted.
    accountRemoval: 'SCORED_FROM_PRE_TEARDOWN_DELETION_ONLY',
    defects: { run: [...run, ...destruction], ...legDefects },
    result: Object.values(legs).every((value) => value === 'PASSED') ? 'PASSED' : 'NOT_PROVEN',
  };
}

const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };

// CLI: node deletionReceipt.mjs --receipt <f> --destruction <f> --identity <f> --release <sha> --run <project>
//        --journeys <outcome> --stack-stopped <outcome> --stack-destroyed <outcome> --stripe-clean <outcome>
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const names = ['receipt', 'destruction', 'identity', 'release', 'run', 'journeys', 'stack-stopped', 'stack-destroyed', 'stripe-clean'];
  let values = {};
  try {
    ({ values } = parseArgs({ options: Object.fromEntries(names.map(n => [n, { type: 'string' }])), strict: true }));
  } catch { values = {}; }
  const combined = finaliseDeletionReceipt(readJson(values.receipt ?? ''),
    { journeys: values.journeys, stackStopped: values['stack-stopped'], stackDestroyed: values['stack-destroyed'], stripeClean: values['stripe-clean'] },
    { release: values.release, stackRun: values.run, destruction: readJson(values.destruction ?? ''),
      identity: readJson(values.identity ?? '') });
  process.stdout.write(`${JSON.stringify(combined, null, 2)}\n`);
  process.exitCode = combined.result === 'PASSED' ? 0 : 1;
}
