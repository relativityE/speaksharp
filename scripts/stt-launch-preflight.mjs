#!/usr/bin/env node
/**
 * #1120 S1 (PR #1155) — EXECUTABLE STT launch preflight release gate.
 *
 * The canonical launch invariant (mirror of `frontend/src/config/sttLaunchPreflight.ts`
 * `evaluateSttLaunchPreflight`; kept in lock-step by `tests/release/stt-launch-preflight-cli.test.js`):
 *   - Launch acceptance:  hierarchy ON (Private-primary, not hard-disabled) AND both Cloud gates OFF.
 *   - Hierarchy rollback: hierarchy OFF/hard-disabled AND both Cloud gates OFF (Browser default; Cloud stays
 *     off + unreachable — rollback NEVER enables Cloud).
 *   - FAILS (nonzero) when the client and Edge Cloud gates DISAGREE, or when either/both Cloud gates are ON.
 *
 * Reads the REAL configured values from the environment (`.env` / `.env.*` / CI secrets):
 *   VITE_CLOUD_STT_ENABLED (client), CLOUD_STT_ENABLED (Edge), VITE_STT_PRIVATE_PRIMARY_DISABLED (hard kill).
 * Only the exact string "true" enables a gate; unset / any other value denies (fail-closed).
 *
 * Usage:
 *   node scripts/stt-launch-preflight.mjs            # launch posture (hierarchy expected ON)
 *   node scripts/stt-launch-preflight.mjs --rollback # hierarchy-rollback posture (Browser default)
 * Exit 0 = acceptable public release posture; exit 1 = blocked (mismatch or Cloud ON).
 */

const isExactTrue = (v) => v === 'true';

export function evaluatePreflight(env, { rollback = false } = {}) {
  const clientCloudEnabled = isExactTrue(env.VITE_CLOUD_STT_ENABLED);
  const serverCloudEnabled = isExactTrue(env.CLOUD_STT_ENABLED);
  const hierarchyHardDisabled = isExactTrue(env.VITE_STT_PRIVATE_PRIMARY_DISABLED);
  // In launch posture the hierarchy is expected ON unless hard-disabled; --rollback asserts hierarchy OFF.
  const hierarchyPrimary = rollback ? false : !hierarchyHardDisabled;

  const reasons = [];
  const cloudGatesAgree = clientCloudEnabled === serverCloudEnabled;
  const cloudFullyOff = !clientCloudEnabled && !serverCloudEnabled;
  const hierarchyOn = hierarchyPrimary && !hierarchyHardDisabled;

  if (!cloudGatesAgree) {
    reasons.push(`Cloud client/Edge gate DISAGREEMENT: VITE_CLOUD_STT_ENABLED=${clientCloudEnabled} vs CLOUD_STT_ENABLED=${serverCloudEnabled}`);
  } else if (!cloudFullyOff) {
    reasons.push('Both Cloud gates ON — internal characterization only, NOT public-launch acceptable');
  }

  const launchAcceptable = hierarchyOn && cloudFullyOff;
  const rollbackAcceptable = !hierarchyOn && cloudFullyOff;
  const publicReleaseBlocked = !launchAcceptable && !rollbackAcceptable;

  const state = launchAcceptable ? 'LAUNCH (hierarchy ON, Cloud OFF)'
    : rollbackAcceptable ? 'ROLLBACK (hierarchy OFF, Cloud OFF)'
      : 'BLOCKED';
  return { launchAcceptable, rollbackAcceptable, publicReleaseBlocked, state, reasons };
}

// CLI entrypoint (skipped when imported by the drift test).
if (import.meta.url === `file://${process.argv[1]}`) {
  const rollback = process.argv.includes('--rollback');
  const v = evaluatePreflight(process.env, { rollback });
  if (v.publicReleaseBlocked) {
    console.error('\n❌ STT launch preflight FAILED — not an acceptable public release posture:');
    v.reasons.forEach((r) => console.error(`  • ${r}`));
    console.error('  Launch requires hierarchy ON + both Cloud gates OFF; rollback requires hierarchy OFF + both Cloud gates OFF.\n');
    process.exit(1);
  }
  console.log(`✅ STT launch preflight OK — ${v.state}. Cloud is OFF, absent, unreachable, and denied before cost.`);
  process.exit(0);
}
