#!/usr/bin/env node
/**
 * Trigger the PostHog Gate B single-user targeting proof workflow on GitHub.
 *
 * The control-plane secret (POSTHOG_PERSONAL_API_KEY) lives only as a GitHub Actions
 * secret, so the proof MUST run in the cloud, not locally. This script dispatches
 * .github/workflows/posthog-gate-b.yml via the locally-authenticated `gh` CLI,
 * watches the run, and downloads the evidence artifact.
 *
 * Prereqs: the workflow file must already be on the DEFAULT branch (main) for
 * workflow_dispatch to be available, and `gh auth status` must be logged in.
 *
 * Usage:
 *   node scripts/trigger-posthog-gate-b.mjs <app_user_id> [cohort_name]
 * Example:
 *   node scripts/trigger-posthog-gate-b.mjs 842e3ba4-45e1-4f48-ab46-61b90537c52f
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WORKFLOW = 'posthog-gate-b.yml';
const appUserId = process.argv[2];
const cohortName = process.argv[3] || 'stt_ab_disposable_pro_testers';

if (!appUserId) {
  console.error('Usage: node scripts/trigger-posthog-gate-b.mjs <app_user_id> [cohort_name]');
  process.exit(1);
}
if (!/^[0-9a-fA-F-]{36}$/.test(appUserId)) {
  console.error(`Refusing to dispatch: app_user_id "${appUserId}" is not a UUID (Supabase user.id / distinct_id).`);
  process.exit(1);
}

function gh(args, opts = {}) {
  return execFileSync('gh', args, { encoding: 'utf8', ...opts });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  gh(['auth', 'status'], { stdio: ['ignore', 'ignore', 'ignore'] });
} catch {
  console.error('gh is not authenticated. Run `gh auth login` first.');
  process.exit(1);
}

console.log(`▶ Dispatching ${WORKFLOW} (single-user targeting proof)`);
console.log(`    app_user_id = ${appUserId}`);
console.log(`    cohort_name = ${cohortName}`);
gh(['workflow', 'run', WORKFLOW, '-f', `app_user_id=${appUserId}`, '-f', `cohort_name=${cohortName}`], {
  stdio: ['ignore', 'inherit', 'inherit'],
});

// Resolve the dispatched run id (poll briefly; dispatch is async).
let runId = '';
for (let i = 0; i < 15 && !runId; i += 1) {
  await sleep(3000);
  try {
    const out = gh(['run', 'list', '--workflow', WORKFLOW, '--limit', '1', '--json', 'databaseId,status,createdAt']);
    const arr = JSON.parse(out);
    if (arr[0]?.databaseId) runId = String(arr[0].databaseId);
  } catch { /* keep polling */ }
}
if (!runId) {
  console.error('Could not resolve the dispatched run id. Check: gh run list --workflow ' + WORKFLOW);
  process.exit(1);
}

console.log(`▶ Watching run ${runId} (Actions → PostHog Gate B) ...`);
let runFailed = false;
try {
  gh(['run', 'watch', runId, '--exit-status'], { stdio: ['ignore', 'inherit', 'inherit'] });
} catch {
  runFailed = true; // non-zero exit = workflow failed (e.g., NOT TARGETING_VERIFIED)
}

// Pull the evidence artifact.
const dir = mkdtempSync(join(tmpdir(), 'gate-b-evidence-'));
try {
  gh(['run', 'download', runId, '-n', 'posthog-gate-b-evidence', '-D', dir], { stdio: ['ignore', 'inherit', 'inherit'] });
  console.log(`\n▶ Evidence downloaded to: ${dir}`);
  console.log('  - gate-b-evidence.json (machine-readable)  - gate-b-evidence.txt (full log)');
} catch {
  console.error('Could not download the evidence artifact (run may have failed before upload). See the run logs above.');
}

console.log(runFailed
  ? '\n❌ Gate B run did NOT pass (likely classification != TARGETING_VERIFIED, or PostHog write scope blocked). Inspect the evidence.'
  : '\n✅ Gate B run passed: single-user targeting VERIFIED. Next: Dev runs the no-forceAuto app-selection proof.');
process.exit(runFailed ? 1 : 0);
