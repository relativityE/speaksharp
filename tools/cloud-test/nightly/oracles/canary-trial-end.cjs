"use strict";
// Nightly AHT suite, J1.e and J2: ending a run-owned trial early. This is a production write, approved by the product
// owner on 14 Nov for accounts the test created AND tagged, and no others. It fails closed:
//   - the run must carry RWT_CANARY_CLAIM_ACK (else the legs are NOT RUN and nothing is written);
//   - the email must carry this run's prefix and match the UID the auth service returns;
//   - the account must already hold the server-issued `app_metadata.canary` claim (set by markRunOwnedAccountCanary);
//   - only `trial_expires_at` is written, only to a time in the past, only on `id = uid`; never
//     `commercial_trial_granted_at`, never another account; the write must report exactly that one row back.
// Cleanup removes the account afterwards (runOwnedCleanup), so the ended trial does not outlive the run.
class TrialEndRefused extends Error {
    constructor(reason) { super(`trial end refused (fail closed): ${reason}`); this.name = 'TrialEndRefused'; }
}
/** How far in the past the trial is set to end: far enough that no clock skew makes it still active. */
const ENDED_AGO_MS = 10 * 60 * 1000;
async function endRunOwnedTrial(ports, req) {
    if (!req.ackGranted)
        throw new TrialEndRefused('the run has no canary claim acknowledgement');
    if (!req.runPrefix || !req.email.startsWith(req.runPrefix))
        throw new TrialEndRefused('the account is not one this run created');
    if (!/^[0-9a-f-]{36}$/i.test(req.uid))
        throw new TrialEndRefused('the account id is not a single exact id');
    const user = await ports.getUser(req.uid);
    if ((user.email ?? '').toLowerCase() !== req.email.toLowerCase())
        throw new TrialEndRefused('the id does not belong to the run\'s email');
    if (user.appMetadata.canary !== true)
        throw new TrialEndRefused('the account does not carry the server-issued canary claim');
    const expiresAt = new Date(req.nowMs - ENDED_AGO_MS).toISOString();
    const { updatedIds } = await ports.setTrialExpiresAt(req.uid, expiresAt);
    if (updatedIds.length !== 1 || updatedIds[0] !== req.uid) {
        throw new TrialEndRefused(`the write changed ${updatedIds.length} row(s), expected exactly this account`);
    }
    return { expiresAt };
}
/** The production port over a service-role client: one column, one exact id, the changed ids read back. */
function supabaseTrialEndPorts(admin) {
    return {
        async getUser(uid) {
            const { data, error } = await admin.auth.admin.getUserById(uid);
            if (error || !data.user)
                throw new TrialEndRefused(`the account could not be read: ${error?.code ?? 'missing'}`);
            return { email: data.user.email ?? null, appMetadata: data.user.app_metadata ?? {} };
        },
        async setTrialExpiresAt(uid, expiresAtIso) {
            const { data, error } = await admin.from('user_profiles').update({ trial_expires_at: expiresAtIso }).eq('id', uid).select('id');
            if (error)
                throw new TrialEndRefused(`the write failed: ${error.code ?? 'unknown'}`);
            return { updatedIds: (data ?? []).map((r) => r.id) };
        },
    };
}

module.exports = { ENDED_AGO_MS, TrialEndRefused, endRunOwnedTrial, supabaseTrialEndPorts };
