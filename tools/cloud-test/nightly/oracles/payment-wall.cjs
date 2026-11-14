"use strict";
// Nightly AHT suite, the payment wall after the trial ends (J1.e, J1.f, J2). Product rules (Akin, 14 Nov): "No payment,
// no service or access to their past data. They have the option to delete account, not encouraged (conversion funnel),
// but available." So the wall offers paying, offers deletion without promoting it, and shows no History, PDF or export
// first (no export before deletion). The spec maps the page to a WallRead; selectors come from the payment-wall PR (#1863).
const WALL_FIELDS = Object.freeze(['wallShown', 'payActionVisible', 'deleteOffered', 'deletePromoted', 'historyVisible', 'progressVisible', 'pdfVisible', 'exportVisible', 'recordStartEnabled']);
/** Names the fields that are not an explicit boolean: a field the spec forgot to map is never read as healthy. */
const notObserved = (o, fields, type) => fields.filter((f) => typeof o?.[f] !== type);
function paymentWallVerdict(w) {
    const missing = notObserved(w, WALL_FIELDS, 'boolean');
    if (missing.length > 0)
        return { outcome: 'HOLD', detail: `not observed: ${missing.join(', ')}` };
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
/**
 * The answers that mean "refused for lack of entitlement": 401, 402 or 403. Any other 4xx (404 for a moved path, 400 for
 * a bad probe body, 429 for a rate limit) proves nothing about the wall, so it fails the row.
 */
const REFUSAL_STATUSES = Object.freeze([401, 402, 403]);
/** `trial-expired-server-refuses`: every named deployed endpoint refuses the expired account's own token. */
function serverRefusesVerdict(probes, required) {
    const missing = required.filter((n) => !probes.some((p) => p.name === n));
    if (required.length === 0 || missing.length > 0)
        return { outcome: 'FAIL', detail: `not probed: ${missing.join(', ') || 'nothing required'}` };
    const unobserved = probes.filter((p) => typeof p.providerWorkObserved !== 'boolean');
    if (unobserved.length > 0)
        return { outcome: 'HOLD', detail: `provider work not observed for ${unobserved.map((p) => p.name).join(', ')}` };
    const bad = probes.filter((p) => !REFUSAL_STATUSES.includes(p.status) || p.providerWorkObserved);
    if (bad.length > 0) {
        return { outcome: 'FAIL', detail: bad.map((p) => `${p.name} ${p.status}${p.providerWorkObserved ? ' with provider work' : ''}`).join(', ') };
    }
    return { outcome: 'PASS', detail: `${probes.length} endpoint(s) refused the expired account` };
}
/** J1.c `short-stop-no-save` (G5): a Stop pressed too early saves nothing and says nothing was saved. */
function shortStopVerdict(r) {
    if (r?.settled !== true)
        return { outcome: 'HOLD', detail: 'the page did not settle after Stop' };
    const missing = [
        ...(Array.isArray(r.sessionIdsBefore) ? [] : ['sessionIdsBefore']), ...(Array.isArray(r.sessionIdsAfter) ? [] : ['sessionIdsAfter']),
        ...notObserved(r, ['acceptedSaveRequests'], 'number'), ...notObserved(r, ['savedConfirmationShown'], 'boolean'),
    ];
    if (missing.length > 0)
        return { outcome: 'HOLD', detail: `not observed: ${missing.join(', ')}` };
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

module.exports = { REFUSAL_STATUSES, paymentWallVerdict, serverRefusesVerdict, shortStopVerdict };
