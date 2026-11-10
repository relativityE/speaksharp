/**
 * #1258 B1 — interrupted-run recovery entry point (Browser PM 6097765962). Dispatched only as an `rc-gates.yml` gate-3
 * diagnostic single spec. Deliberately NOT named `rwt-*`: it is not a browser journey, so the RWT fixture, identity and
 * per-journey telemetry readback do not apply.
 *
 * #1580 P1 4237980480: it runs only from the repository's default branch with checkout HEAD = the dispatched commit, checked
 * here BEFORE the service-role client exists (rc-gates also checks it in a credential-free step before this one). WITHOUT a
 * delete acknowledgement it detects and HOLDs (lists and counts, deletes nothing). WITH `RWT-INTERRUPTED-RUN-RECOVERY-DELETE@<sha>`
 * naming that exact commit — and only under separate PO Production authority for that dispatch — it deletes each eligible
 * run-owned account through the existing fail-closed `cleanupRunOwnedAccount` (residue 0). Prints counts and a status only.
 */
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { PROTECTED_DEFAULT_BRANCH, RECOVERY_REPOSITORY, recoverInterruptedRuns, recoveryAuthority, recoveryReportLine, runOwnedDomain, runProvenanceFrom } from './helpers/rwtInterruptedRunRecovery';

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
// rc-gates carries this on the existing `rwt_writes_ack` input (the dispatch-input cap is 10); only the distinct, SHA-bound
// recovery value deletes, and the RWT journeys refuse it.
const ACK = process.env.RWT_WRITES_ACK ?? '';

/** Run-scoped recovery: GitHub's own record of the interrupted run (read-only token, this repository only); null when unavailable. */
async function readRunRecord(runId: string): Promise<unknown> {
    const token = process.env.RECOVERY_RUN_PROVENANCE_TOKEN ?? '';
    if (!token || process.env.GITHUB_REPOSITORY !== RECOVERY_REPOSITORY) return null;
    try {
        const r = await fetch(`https://api.github.com/repos/${RECOVERY_REPOSITORY}/actions/runs/${runId}`, {
            headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
        });
        return r.ok ? await r.json() : null;
    } catch {
        return null;
    }
}

const checkoutHead = (): string => {
    try {
        return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch {
        return '';
    }
};

test.describe('RWT interrupted-run recovery (governed)', () => {
    test('detect run-owned accounts left by interrupted runs; recover only with the SHA-bound ack', async () => {
        test.setTimeout(900_000);
        const sha = process.env.GITHUB_SHA ?? '';
        // Before any credential is touched: first workflow attempt only, default branch, HEAD = dispatch SHA, and any delete
        // ack bound to that SHA.
        const authority = recoveryAuthority({
            ref: process.env.GITHUB_REF ?? '', sha, head: checkoutHead(), defaultBranch: PROTECTED_DEFAULT_BRANCH, ack: ACK,
            attempt: process.env.GITHUB_RUN_ATTEMPT ?? '',
        });
        if (!authority.ok) throw new Error(`HOLD: interrupted-run recovery authority refused (${authority.reason}); no credential was used`);
        test.skip(!SUPABASE_URL || !SERVICE_ROLE, 'HOLD: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured for this run');
        const runProvenance = authority.runId ? runProvenanceFrom(await readRunRecord(authority.runId), authority.runId) : null;
        const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });
        const report = await recoverInterruptedRuns({
            admin: admin as never, nowMs: Date.now(), ack: authority.deleteAuthorized ? ACK : '', sha, domain: runOwnedDomain(process.env),
            runId: authority.runId ?? null, runProvenance,
        });
        console.log(recoveryReportLine(report));
        // HOLD states are outcomes, not errors; only a cleanup that could not prove deletion fails the run.
        expect(report.status, 'a cleanup could not prove deletion and zero residue').not.toBe('FAILED');
    });
});
