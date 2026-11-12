/**
 * AHT-07 / AHT-08 recovery executor entry point (recovery-store proposal 2026-11-12, §7 item 1). DRAFT: not dispatched by any
 * workflow; docs/rwt-feedback-recovery-executor.draft-job.yml sketches the job and stays unwired until Akin's go. Deliberately NOT
 * named `rwt-*`: it is not a browser journey, so the RWT fixture, identity and per-journey telemetry readback do not apply.
 *
 * Mirrors interrupted-run-recovery.live.spec.ts. It runs only from protected `main`, on the first workflow attempt, with checkout
 * HEAD = the dispatched commit, checked here BEFORE any credential exists. WITHOUT `RWT-FEEDBACK-RECOVERY-DELETE@<sha>` naming
 * that exact commit it detects and HOLDs: it verifies the store mounted at RWT_RECOVERY_DIR, lists the inventory files and reads
 * them locally (no service-role client is created). WITH that ack, and only under separate Production authority for that
 * dispatch, it calls `recoverFromInventory` per ready file. Prints counts and a status only.
 * Known limit: a runner killed before its writer-stopped record cannot be recovered; its file HOLDs and is kept.
 */
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { feedbackRecoveryAuthority, feedbackRecoveryReportLine, runFeedbackRecovery } from './helpers/feedbackRecoveryExecutor';

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
// Its own input, never the RWT journeys' `rwt_writes_ack`: only the distinct, SHA-bound recovery value deletes.
const ACK = process.env.RWT_FEEDBACK_RECOVERY_ACK ?? '';

const checkoutHead = (): string => {
    try {
        return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch {
        return '';
    }
};

test.describe('RWT feedback recovery executor (governed)', () => {
    test('detect AHT-07/AHT-08 recovery inventories; recover only with the SHA-bound ack', async () => {
        test.setTimeout(600_000);
        const git = { ref: process.env.GITHUB_REF ?? '', sha: process.env.GITHUB_SHA ?? '', head: checkoutHead(), attempt: process.env.GITHUB_RUN_ATTEMPT ?? '' };
        // Before any credential is touched: protected main, first attempt, HEAD = dispatch SHA, and any delete ack bound to it.
        const authority = feedbackRecoveryAuthority({ ...git, ack: ACK });
        if (!authority.ok) throw new Error(`HOLD: feedback recovery authority refused (${authority.reason}); no credential was used`);
        // Detection needs no credential; the service-role client exists only when deletion is authorized.
        if (authority.deleteAuthorized) test.skip(!SUPABASE_URL || !SERVICE_ROLE, 'HOLD: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured for this run');
        const admin = authority.deleteAuthorized
            ? createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } })
            : null;
        const report = await runFeedbackRecovery({ env: process.env, git, ack: authority.deleteAuthorized ? ACK : '', admin: admin as never });
        console.log(feedbackRecoveryReportLine(report));
        // HOLD states are outcomes, not errors; only a recovery that FAILed (a survivor, a foreign row, an inexact delete) fails.
        expect(report.status, 'a recovery could not prove exact deletion and zero residue').not.toBe('FAILED');
    });
});
