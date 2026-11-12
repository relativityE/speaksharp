// Combined receipt for the disposable local stack. No network, no secrets, no provider content.
//
// On the local stack the journey cannot read three billing tables (service_role has no access), so its own
// receipt can at best say PENDING_STACK_DESTRUCTION. Only this step, run after the CHECKED teardown and the
// destruction proof, may turn that into PASSED. Anything missing, unknown or failed is NOT_PROVEN.
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const PENDING = 'PENDING_STACK_DESTRUCTION';

/**
 * @param {unknown} journeyReceipts the spec's receipt attachments (array; normally exactly one)
 * @param {{ stackStopped: string, stackDestroyed: string, stripeClean: string }} checks GitHub step outcomes
 */
export function finaliseLocalStackReceipt(journeyReceipts, checks) {
  const outcome = (value) => (value === 'success' ? 'PASSED' : 'NOT_PROVEN');
  const parts = {
    stackStopped: outcome(checks?.stackStopped),
    stackDestroyed: outcome(checks?.stackDestroyed),
    stripeFixturesRemoved: outcome(checks?.stripeClean),
  };
  const receipts = Array.isArray(journeyReceipts) ? journeyReceipts : [];
  const journey = receipts.length === 1 && receipts[0] && typeof receipts[0] === 'object' ? receipts[0] : null;
  const journeyReady = journey !== null && journey.result === PENDING && journey.cleanup === PENDING
    && journey.billingRowResidue === 'NOT_READ_REQUIRES_STACK_DESTRUCTION_PROOF';
  const passed = journeyReady && Object.values(parts).every((value) => value === 'PASSED');
  return {
    schema: 'billing-local-stack-combined/v1',
    journey: journey && typeof journey.journey === 'string' ? journey.journey : null,
    journeyReceipt: journeyReady ? PENDING : 'NOT_PROVEN',
    ...parts,
    // The rows were never read; they are covered only because the whole database was destroyed.
    billingRowResidue: parts.stackDestroyed === 'PASSED' ? 'NOT_READ_DATABASE_DESTROYED' : 'NOT_READ_NOT_PROVEN',
    result: passed ? 'PASSED' : 'NOT_PROVEN',
  };
}

// CLI: node localStackReceipt.mjs <journey-receipt.json> <stackStopped> <stackDestroyed> <stripeClean>
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [file, stackStopped, stackDestroyed, stripeClean] = process.argv.slice(2);
  let receipts = null;
  try { receipts = JSON.parse(readFileSync(file, 'utf8')); } catch { receipts = null; }
  const combined = finaliseLocalStackReceipt(receipts, { stackStopped, stackDestroyed, stripeClean });
  process.stdout.write(`${JSON.stringify(combined, null, 2)}\n`);
  process.exitCode = combined.result === 'PASSED' ? 0 : 1;
}
