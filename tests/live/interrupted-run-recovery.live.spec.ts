/**
 * #1258 B1 — interrupted-run recovery entry point (Browser PM 6097765962). Dispatched only as an `rc-gates.yml` gate-3
 * diagnostic single spec. Deliberately NOT named `rwt-*`: it is not a browser journey, so the RWT fixture, identity and
 * per-journey telemetry readback do not apply. WITHOUT the exact recovery value on `rwt_writes_ack` (`RWT_WRITES_ACK`) it detects and HOLDs (lists and counts, deletes nothing).
 * WITH it — and only under separate PO Production authority for that dispatch — it deletes each eligible run-owned account
 * through the existing fail-closed `cleanupRunOwnedAccount` (residue = 0). Prints counts and a status only.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { recoverInterruptedRuns, recoveryReportLine } from './helpers/rwtInterruptedRunRecovery';

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
// rc-gates carries this on the existing `rwt_writes_ack` input (the dispatch-input cap is 10); only the distinct
// recovery value deletes, and the RWT journeys refuse it.
const ACK = process.env.RWT_WRITES_ACK ?? '';

test.describe('RWT interrupted-run recovery (governed)', () => {
    test('detect run-owned accounts left by interrupted runs; recover only with the exact ack', async () => {
        test.setTimeout(900_000);
        test.skip(!SUPABASE_URL || !SERVICE_ROLE, 'HOLD: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured for this run');
        const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });
        const report = await recoverInterruptedRuns({ admin: admin as never, nowMs: Date.now(), ack: ACK });
        console.log(recoveryReportLine(report));
        // HOLD states are outcomes, not errors; only a cleanup that could not prove deletion fails the run.
        expect(report.status, 'a cleanup could not prove deletion and zero residue').not.toBe('FAILED');
    });
});
