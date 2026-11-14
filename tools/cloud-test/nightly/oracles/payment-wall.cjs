"use strict";
const { notCounts } = require('../counts.cjs');
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
 * The answers that mean "refused for lack of entitlement": 402 or 403. A 401 means the token itself was rejected (stale,
 * expired or malformed), so it says nothing about the wall; neither does any other 4xx (404 for a moved path, 400 for a
 * bad probe body, 429 for a rate limit). Each fails the row.
 */
const REFUSAL_STATUSES = Object.freeze([402, 403]);
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
/**
 * J1.c `short-stop-no-save` (G5): a Stop pressed too early saves no take and says nothing was saved.
 *
 * Discarding a short take is not "no row". The take's row may already exist when Stop is pressed (Start creates it), or
 * be created late, and #1861 settles the discard by marking that row `failed` through the save path. So the spec reads
 * every session row of the account, with its status, before the take and after the page settles, and counts the
 * accepted save requests by the status they asked for. Then, for each row that is new or whose status changed:
 *   - `completed` is a saved take: FAIL.
 *   - `failed` is the confirmed settlement of the discard: allowed.
 *   - any row left in another state (still `active`, null, unknown), new or not, is a discard that has not settled:
 *     HOLD, never PASS.
 * The only allowed settlement is a new row, or a placeholder (active, pending, null), now `failed`, and one short Stop
 * settles at most one row. An earlier saved take that changed FAILs. A read listing a row twice, a row that was there
 * before and is gone after, or any other change is not explained by a discard: HOLD. An accepted request that asked to
 * complete the take is a save: FAIL. The page's own "not settled" warning (#1861) means the discard is unresolved: HOLD,
 * and so does an accepted request to mark the take failed that no row reflects.
 */
const SETTLED_DISCARD = 'failed';
const SAVED_TAKE = 'completed';
/** A take still being recorded or not yet settled: the only states a discard may move to failed. */
const PLACEHOLDER = new Set(['active', 'pending', null]);
const isRow = (r) => typeof r?.id === 'string' && r.id.length > 0 && (r.status === null || typeof r.status === 'string');
const uniqueIds = (rows) => new Set(rows.map((x) => x.id)).size === rows.length;
function shortStopVerdict(r) {
    if (r?.settled !== true)
        return { outcome: 'HOLD', detail: 'the page did not settle after Stop' };
    const missing = [
        ...(Array.isArray(r.rowsBefore) && r.rowsBefore.every(isRow) ? [] : ['rowsBefore']),
        ...(Array.isArray(r.rowsAfter) && r.rowsAfter.every(isRow) ? [] : ['rowsAfter']),
        ...notCounts(r, ['acceptedCompletingSaves', 'acceptedFailedMarks']),
        ...notObserved(r, ['savedConfirmationShown', 'unsettledDiscardShown'], 'boolean'),
    ];
    if (missing.length > 0)
        return { outcome: 'HOLD', detail: `not observed: ${missing.join(', ')}` };
    // A read that names a row twice can hide one state behind the other: it can't be judged.
    if (!uniqueIds(r.rowsBefore) || !uniqueIds(r.rowsAfter))
        return { outcome: 'HOLD', detail: 'a session row is listed twice in the read' };
    const before = new Map(r.rowsBefore.map((x) => [x.id, x.status]));
    const after = new Map(r.rowsAfter.map((x) => [x.id, x.status]));
    const touched = [...after].filter(([id, status]) => !before.has(id) || before.get(id) !== status);
    const saved = touched.filter(([, s]) => s === SAVED_TAKE).length;
    // A row that was a saved take before and is anything else now: the short Stop changed an earlier saved take.
    const changedSaved = touched.filter(([id]) => before.get(id) === SAVED_TAKE).length;
    // The one allowed settlement: a new row, or a placeholder (active, pending, null), now marked failed.
    const settledAsFailed = touched.filter(([id, s]) => s === SETTLED_DISCARD && (!before.has(id) || PLACEHOLDER.has(before.get(id))));
    const otherChange = touched.filter(([id, s]) => s !== SAVED_TAKE && before.get(id) !== SAVED_TAKE && !settledAsFailed.some(([x]) => x === id)).length;
    // Any row still open after the page settled, new or not, is a take nobody settled.
    const unsettled = [...after.values()].filter((s) => s !== SAVED_TAKE && s !== SETTLED_DISCARD).length;
    const vanished = [...before.keys()].filter((id) => !after.has(id)).length;
    const problems = [];
    if (saved > 0)
        problems.push(`${saved} take(s) saved as completed`);
    if (changedSaved > 0)
        problems.push(`${changedSaved} earlier saved take(s) changed`);
    if (r.acceptedCompletingSaves > 0)
        problems.push(`${r.acceptedCompletingSaves} request(s) to complete the take accepted`);
    if (r.savedConfirmationShown)
        problems.push('the page said the take was saved');
    if (problems.length > 0)
        return { outcome: 'FAIL', detail: problems.join('; ') };
    const open = [];
    if (unsettled > 0)
        open.push(`${unsettled} row(s) neither completed nor marked failed: the discard has not settled`);
    if (vanished > 0)
        open.push(`${vanished} row(s) present before are gone`);
    if (otherChange > 0)
        open.push(`${otherChange} row(s) changed in a way a discard does not explain`);
    // One short Stop discards one take, so it settles at most one row.
    if (settledAsFailed.length > 1)
        open.push(`${settledAsFailed.length} rows marked failed by one short Stop`);
    if (r.unsettledDiscardShown)
        open.push('the page says the discard has not settled');
    if (r.acceptedFailedMarks > 0 && touched.length === 0)
        open.push(`${r.acceptedFailedMarks} request(s) to mark the take failed accepted, but no row shows it`);
    if (open.length > 0)
        return { outcome: 'HOLD', detail: open.join('; ') };
    return { outcome: 'PASS', detail: settledAsFailed.length > 0 ? 'nothing saved after a short Stop; its row settled as failed' : 'nothing saved after a short Stop' };
}

module.exports = { REFUSAL_STATUSES, paymentWallVerdict, serverRefusesVerdict, shortStopVerdict };
