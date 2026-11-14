"use strict";
// Nightly AHT suite, J9.a billing check. Sam's correction (14 Nov): J9 creates a billing-portal session, so it is
// BOUNDED (one attempt, a hard timeout), the portal's bearer URL is NEVER logged, stored or attached (a portal session
// works for anyone holding the link), and cleanup is RECONCILED without promising zero billing rows. J9.a runs in Stripe
// test mode only, so a portal address that is not a test-mode session is refused before it is opened.
const PORTAL_TIMEOUT_MS = 20_000;
const PORTAL_URL_RE = /https?:\/\/billing\.stripe\.com\/p\/session\/[A-Za-z0-9_]+[^\s"'<>]*/g;
const TEST_MODE_PORTAL_RE = /^https:\/\/billing\.stripe\.com\/p\/session\/test_[A-Za-z0-9_]+(?:[/?#][^\s"'<>]*)?$/;
/** Replaces every billing-portal address in a text with a fixed marker. Every log line from this module goes through it. */
function redactPortalUrls(text) {
    return text.replace(PORTAL_URL_RE, '[billing-portal-url]');
}
// The timer is cleared once the attempt settles, so a finished leg never leaves a pending timer behind.
function withTimeout(p, ms) {
    let timer;
    const bound = new Promise((r) => { timer = setTimeout(() => r('timeout'), ms); });
    return Promise.race([p, bound]).finally(() => clearTimeout(timer));
}
/** One bounded attempt. The address never leaves this function: not in the verdict, not in a log line, not in an error. */
async function portalOpensVerdict(ports, timeoutMs = PORTAL_TIMEOUT_MS) {
    const log = (line) => ports.log(redactPortalUrls(line));
    let url;
    try {
        const created = await withTimeout(ports.createSession(), timeoutMs);
        if (created === 'timeout') {
            log('portal session: timed out');
            return { outcome: 'FAIL', detail: 'creating the portal session timed out' };
        }
        url = created.url;
    }
    catch (e) {
        log(`portal session: refused (${redactPortalUrls(e instanceof Error ? e.message : String(e))})`);
        return { outcome: 'FAIL', detail: 'creating the portal session failed' };
    }
    if (!TEST_MODE_PORTAL_RE.test(url)) {
        log('portal session: not a Stripe test-mode portal address; not opened');
        return { outcome: 'FAIL', detail: 'the portal address is not a Stripe test-mode session' };
    }
    try {
        const shown = await withTimeout(ports.openAndConfirm(url), timeoutMs);
        if (shown === 'timeout') {
            log('portal: timed out');
            return { outcome: 'FAIL', detail: 'the portal did not open in time' };
        }
        log(`portal: ${shown.portalShown ? 'shown' : 'not shown'}`);
        return shown.portalShown ? { outcome: 'PASS', detail: 'the test-mode billing portal opened' } : { outcome: 'FAIL', detail: 'the portal page was not shown' };
    }
    catch (e) {
        log(`portal: failed (${redactPortalUrls(e instanceof Error ? e.message : String(e))})`);
        return { outcome: 'FAIL', detail: 'opening the portal failed' };
    }
}
/**
 * Billing rows left after a run, reported rather than promised away: Stripe and the product keep some by design
 * (customer, subscription, portal or checkout records). The check fails only when a row belongs to another account,
 * and holds when a table is not on the reviewed list, so a new kind of row is looked at before it is accepted.
 */
function reconcileBillingRows(rows, reviewedRetainedTables) {
    const retained = rows.filter((r) => r.count > 0).map((r) => `${r.table}=${r.count}`);
    const foreign = rows.filter((r) => r.otherAccountRows > 0);
    if (foreign.length > 0)
        return { outcome: 'FAIL', retained, detail: `rows of another account touched in ${foreign.map((r) => r.table).join(', ')}` };
    const unreviewed = rows.filter((r) => r.count > 0 && !reviewedRetainedTables.includes(r.table));
    if (unreviewed.length > 0)
        return { outcome: 'HOLD', retained, detail: `retained rows in unreviewed tables: ${unreviewed.map((r) => r.table).join(', ')}` };
    return { outcome: 'PASS', retained, detail: retained.length > 0 ? `retained by design: ${retained.join(', ')}` : 'no billing rows retained' };
}

module.exports = { PORTAL_TIMEOUT_MS, portalOpensVerdict, reconcileBillingRows, redactPortalUrls };
