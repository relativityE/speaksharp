#!/usr/bin/env node
/**
 * #1120 S1 (PR #1155) — EXECUTABLE STT launch preflight release gate.
 *
 * ENFORCEABLE, env-readable invariant (so it can gate CI + release automation): the client
 * (`VITE_CLOUD_STT_ENABLED`) and Edge (`CLOUD_STT_ENABLED`) Cloud gates must AGREE and both be OFF. FAILS
 * (nonzero) on disagreement or when either/both are ON. Only the exact string "true" enables a gate.
 *
 * The Private-primary hierarchy is a PostHog RUNTIME assignment (`stt_private_primary_v1`) — it is NOT readable
 * from the build/release environment, so it is NEVER synthesized here (an absent hard-disable var does NOT prove
 * the flag is ON). A launch/rollback verdict therefore requires the operator to pass the VERIFIED hierarchy value
 * EXPLICITLY; with none supplied the gate validates ONLY the Cloud invariant and reports the hierarchy as
 * UNVERIFIED (confirm the deployed `stt_private_primary_v1` assignment in PostHog, then re-run with --launch).
 *
 * `evaluatePreflight` is the CLI companion to the app-side pure acceptance function
 * `evaluateSttLaunchPreflight` (frontend/src/config/sttLaunchPreflight.ts): that mirror already takes an EXPLICIT
 * `hierarchyPrimary`; this CLI's job is to refuse to INVENT one from the environment.
 *
 * Usage:
 *   node scripts/stt-launch-preflight.mjs                    # Cloud invariant only; hierarchy UNVERIFIED
 *   node scripts/stt-launch-preflight.mjs --launch           # assert VERIFIED hierarchy ON  (Private-primary launch)
 *   node scripts/stt-launch-preflight.mjs --rollback         # assert VERIFIED hierarchy OFF (Browser-default rollback)
 *   node scripts/stt-launch-preflight.mjs --hierarchy=on|off # equivalent explicit form
 * Exit 0 = acceptable posture; exit 1 = blocked (Cloud mismatch/ON, or a contradictory hierarchy assertion).
 */

const isExactTrue = (v) => v === 'true';

// hierarchyPrimary: true (operator-verified ON) | false (verified OFF) | undefined (not supplied → UNVERIFIED).
export function evaluatePreflight(env, { hierarchyPrimary = undefined } = {}) {
  const clientCloudEnabled = isExactTrue(env.VITE_CLOUD_STT_ENABLED);
  const serverCloudEnabled = isExactTrue(env.CLOUD_STT_ENABLED);
  const hierarchyHardDisabled = isExactTrue(env.VITE_STT_PRIVATE_PRIMARY_DISABLED);

  const reasons = [];
  const cloudGatesAgree = clientCloudEnabled === serverCloudEnabled;
  const cloudFullyOff = !clientCloudEnabled && !serverCloudEnabled;
  const cloudOk = cloudGatesAgree && cloudFullyOff;

  if (!cloudGatesAgree) {
    reasons.push(`Cloud client/Edge gate DISAGREEMENT: VITE_CLOUD_STT_ENABLED=${clientCloudEnabled} vs CLOUD_STT_ENABLED=${serverCloudEnabled}`);
  } else if (!cloudFullyOff) {
    reasons.push('Both Cloud gates ON — internal characterization only, NOT public-launch acceptable');
  }

  // A build-time hard kill contradicts an asserted hierarchy-ON.
  const hierarchyContradiction = hierarchyPrimary === true && hierarchyHardDisabled;
  if (hierarchyContradiction) {
    reasons.push('Hierarchy asserted ON but VITE_STT_PRIVATE_PRIMARY_DISABLED="true" hard-kills it — contradictory');
  }

  const hierarchyState = hierarchyPrimary === undefined ? 'UNVERIFIED'
    : hierarchyPrimary === true ? 'ON' : 'OFF';

  const launchAcceptable = hierarchyPrimary === true && !hierarchyHardDisabled && cloudOk;
  const rollbackAcceptable = hierarchyPrimary === false && cloudOk;
  // No explicit hierarchy: validate the Cloud invariant only; the launch/rollback posture is NOT asserted here.
  const cloudOnlyAcceptable = hierarchyPrimary === undefined && cloudOk;

  const publicReleaseBlocked = !launchAcceptable && !rollbackAcceptable && !cloudOnlyAcceptable;
  const state = launchAcceptable ? 'LAUNCH (verified hierarchy ON, Cloud OFF)'
    : rollbackAcceptable ? 'ROLLBACK (verified hierarchy OFF, Cloud OFF)'
      : cloudOnlyAcceptable ? 'CLOUD-OFF OK (hierarchy UNVERIFIED — confirm stt_private_primary_v1 in PostHog)'
        : 'BLOCKED';
  return { launchAcceptable, rollbackAcceptable, cloudOnlyAcceptable, publicReleaseBlocked, hierarchyState, state, reasons };
}

function parseHierarchyArg(argv) {
  if (argv.includes('--launch') || argv.includes('--hierarchy=on')) return true;
  if (argv.includes('--rollback') || argv.includes('--hierarchy=off')) return false;
  return undefined; // not supplied → UNVERIFIED
}

// CLI entrypoint (skipped when imported by the drift test).
if (import.meta.url === `file://${process.argv[1]}`) {
  const hierarchyPrimary = parseHierarchyArg(process.argv);
  const v = evaluatePreflight(process.env, { hierarchyPrimary });
  if (v.publicReleaseBlocked) {
    console.error('\n❌ STT launch preflight FAILED — not an acceptable public release posture:');
    v.reasons.forEach((r) => console.error(`  • ${r}`));
    console.error('  Cloud must be OFF + agree on BOTH gates (client + Edge). For a launch/rollback verdict pass');
    console.error('  --launch / --rollback with the VERIFIED PostHog hierarchy state; otherwise only Cloud is checked.\n');
    process.exit(1);
  }
  console.log(`✅ STT launch preflight OK — ${v.state}. Cloud is OFF, absent, unreachable, and denied before cost.`);
  if (v.hierarchyState === 'UNVERIFIED') {
    console.log('   ℹ️  Hierarchy NOT asserted here (PostHog runtime flag). Confirm stt_private_primary_v1 in PostHog, then re-run with --launch to certify the launch posture.');
  }
  process.exit(0);
}
