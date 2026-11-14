"use strict";
// Nightly AHT suite, the payment wall after the trial ends (J1.e, J1.f, J2). Product rules (Akin, 14 Nov): "No payment,
// no service or access to their past data. They have the option to delete account, not encouraged (conversion funnel),
// but available." So the wall offers paying, offers deletion without promoting it, and shows no History, PDF or export
// first (no export before deletion). The spec maps the page to a WallRead; selectors come from the payment-wall PR (#1863).
function paymentWallVerdict(w) {
    const problems = [];
    if (!w.wallShown)
        problems.push('no payment wall');
    if (!w.payActionVisible)
        problems.push('no way to pay');
    if (!w.deleteOffered)
        problems.push('deleting the account is not offered');
    if (w.deletePromoted)
        problems.push('deleting the account is promoted over paying');
    if (w.historyVisible)
        problems.push('History is reachable');
    if (w.progressVisible)
        problems.push('Progress is reachable');
    if (w.pdfVisible)
        problems.push('a PDF is offered');
    if (w.exportVisible)
        problems.push('an export is offered');
    if (w.recordStartEnabled)
        problems.push('recording can start');
    return problems.length > 0 ? { outcome: 'FAIL', detail: problems.join('; ') } : { outcome: 'PASS', detail: 'walled: pay offered, delete available but not promoted, no past data' };
}
/** `trial-expired-server-refuses`: every named deployed endpoint refuses the expired account's own token. */
function serverRefusesVerdict(probes, required) {
    const missing = required.filter((n) => !probes.some((p) => p.name === n));
    if (required.length === 0 || missing.length > 0)
        return { outcome: 'FAIL', detail: `not probed: ${missing.join(', ') || 'nothing required'}` };
    const bad = probes.filter((p) => !(p.status >= 400 && p.status < 500) || p.providerWorkObserved);
    if (bad.length > 0) {
        return { outcome: 'FAIL', detail: bad.map((p) => `${p.name} ${p.status}${p.providerWorkObserved ? ' with provider work' : ''}`).join(', ') };
    }
    return { outcome: 'PASS', detail: `${probes.length} endpoint(s) refused the expired account` };
}
/** J1.c `short-stop-no-save` (G5): a Stop pressed too early saves nothing and says nothing was saved. */
function shortStopVerdict(r) {
    if (!r.settled)
        return { outcome: 'HOLD', detail: 'the page did not settle after Stop' };
    const added = r.sessionIdsAfter.filter((id) => !r.sessionIdsBefore.includes(id));
    const problems = [];
    if (added.length > 0)
        problems.push(`${added.length} session row(s) saved`);
    if (r.acceptedSaveRequests > 0)
        problems.push(`${r.acceptedSaveRequests} save request(s) accepted`);
    if (r.savedConfirmationShown)
        problems.push('the page said the take was saved');
    return problems.length > 0 ? { outcome: 'FAIL', detail: problems.join('; ') } : { outcome: 'PASS', detail: 'nothing saved after a short Stop' };
}

module.exports = { paymentWallVerdict, serverRefusesVerdict, shortStopVerdict };
