#!/usr/bin/env tsx
/**
 * Canary active-trial lane, run-owned trial account (#1826). Run with `pnpm exec tsx scripts/canary-run-owned.ts <command>`.
 *
 *   setup   — create and bind this run's single trial account; export CANARY_EMAIL / CANARY_LANE_PASSWORD (masked) to
 *             later steps through $GITHUB_ENV.
 *   cleanup — delete this run+attempt's account with the shared zero-residue proof (tests/live/helpers/runOwnedCleanup.ts).
 *   sweep   — remove proven orphans of finished runs; fails only on an unproven deletion, a failed listing or the cap.
 *
 * Production write scope: one account created and deleted per run, plus bounded orphan deletes, all `ctrial-run-*`
 * accounts carrying this repository/workflow's exact run binding. Output is closed codes and counts only.
 */
import { appendFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { cleanupRunOwnedAccount } from '../tests/live/helpers/runOwnedCleanup';
import { canaryCleanup } from './lib/canaryCleanupAdapter';
import { RUN_OWNED_PREFIX } from './lib/canaryRunOwnedSweep.mjs';
import { cleanupLane, describeSweep, makeGetRun, setupLane, sweepLane } from './lib/canaryRunOwnedLane.mjs';

const command = process.argv[2];
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GITHUB_ENV, GITHUB_TOKEN, GITHUB_REPOSITORY } = process.env;
if (!['setup', 'cleanup', 'sweep'].includes(command ?? '') || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('canary-run-owned: invalid-configuration');
    process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
// The lane passes the admin to use: the binding-guarded client for in-run cleanup and the sweep, the plain one only for the
// bind-failure cleanup of the account this process itself just created.
// Bind-failure cleanup of the account THIS process just created: no take can exist yet, so the plain shared cleanup.
const bindFailureCleanup = async ({ admin: client, uid, email }: { admin: unknown; uid: string; email: string }) => {
    await cleanupRunOwnedAccount({ admin: client as never, capturedUid: uid, createdEmail: email, runOwnedPrefix: RUN_OWNED_PREFIX });
};
// In-run cleanup and the sweep: the adapter that preserves an account with any unsettled take (Sam's option c).
const cleanup = canaryCleanup;

if (command === 'setup') {
    if (!GITHUB_ENV) { console.error('canary-run-owned setup: no-github-env'); process.exit(1); }
    const result = await setupLane({
        admin,
        env: process.env,
        mask: (value: string) => console.log(`::add-mask::${value}`),
        exportEnv: (name: string, value: string) => appendFileSync(GITHUB_ENV, `${name}=${value}\n`),
        cleanup: bindFailureCleanup,
    });
    console.log(`canary-run-owned setup: ${result.code}`);
    process.exit(result.ok ? 0 : 1);
}

if (command === 'cleanup') {
    const result = await cleanupLane({ admin, env: process.env, cleanup });
    console.log(`canary-run-owned cleanup: ${result.code} deleted=${result.deleted}`);
    if (result.preserved) console.log(`::warning::canary run-owned account PRESERVED (${result.code}) for authorized recovery: run=${result.preserved.runId} attempt=${result.preserved.runAttempt} account=${result.preserved.accountPattern}`);
    process.exit(result.ok ? 0 : 1);
}

if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) { console.error('canary-run-owned sweep: no-github-token'); process.exit(1); }
const result = await sweepLane({ admin, env: process.env, cleanup, getRun: makeGetRun({ fetchImpl: fetch, token: GITHUB_TOKEN, repository: GITHUB_REPOSITORY }) });
console.log(`canary-run-owned ${describeSweep(result.report)}`);
for (const p of result.preserved ?? []) console.log(`::warning::canary run-owned orphan PRESERVED (${p.step}) for authorized recovery: run=${p.runId} attempt=${p.runAttempt} account=${p.accountPattern}`);
if (result.report && Object.keys(result.report.left).length) console.log('::warning::canary run-owned sweep left accounts it could not prove finished; see counts above');
process.exit(result.ok ? 0 : 1);
