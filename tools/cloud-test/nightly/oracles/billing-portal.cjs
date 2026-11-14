"use strict";
// Nightly AHT suite, J9.a billing check. Sam's correction (14 Nov): J9 creates a billing-portal session, so it is
// BOUNDED (one attempt, a hard timeout), the portal's bearer URL is NEVER logged, stored or attached (a portal session
// works for anyone holding the link), and cleanup is RECONCILED without promising zero billing rows. J9.a runs in Stripe
// test mode only, so a portal address that is not a test-mode session is refused before it is opened.
const { isCount } = require('../counts.cjs');
const PORTAL_TIMEOUT_MS = 20_000;
// Any portal-session path, on any host (custom portal domains included), with or without the scheme, in any case, and
// with its slashes plain, percent-encoded or JSON-escaped.
const SLASH = '(?:/|%2f|\\\\/)';
const PORTAL_URL_RE = new RegExp(`(?:https?:${SLASH}${SLASH})?[a-z0-9.-]*${SLASH}p${SLASH}session${SLASH}[a-z0-9_]+[^\\s"'<>]*`, 'gi');
const MARKER = '[billing-portal-url]';
const TEST_MODE_PORTAL_RE = /^https:\/\/billing\.stripe\.com\/p\/session\/test_[A-Za-z0-9_]+(?:[/?#][^\s"'<>]*)?$/;
/**
 * Replaces every billing-portal address in a text with a fixed marker. Every log line from this module goes through it.
 * `known` holds the addresses this check created: each one, its encoded forms and its bare session token are removed
 * exactly, whatever shape the text puts them in, after the pattern has caught every portal path.
 */
function redactPortalUrls(text, known = []) {
    let out = String(text).replace(PORTAL_URL_RE, MARKER);
    for (const v of known) {
        if (typeof v !== 'string' || v === '')
            continue;
        const token = /\/p\/session\/([A-Za-z0-9_]+)/i.exec(v)?.[1];
        for (const form of new Set([v, encodeURIComponent(v), JSON.stringify(v).slice(1, -1), token].filter(Boolean))) {
            const re = new RegExp(form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
            out = out.replace(re, MARKER);
        }
    }
    return out;
}
// The timer is cleared once the attempt settles, so a finished leg never leaves a pending timer behind.
function withTimeout(p, ms) {
    let timer;
    const bound = new Promise((r) => { timer = setTimeout(() => r('timeout'), ms); });
    return Promise.race([p, bound]).finally(() => clearTimeout(timer));
}
/**
 * One bounded attempt. The address never leaves this function: not in the verdict, not in a log line, not in an error.
 * `ports.assertTestMode` (assertTestModeFixture on the fixture, key and objects, sync or async) must return exactly true before any session is
 * created, so a live key never creates a live portal session.
 */
async function portalOpensVerdict(ports, timeoutMs = PORTAL_TIMEOUT_MS) {
    let url;
    const log = (line) => ports.log(redactPortalUrls(line, url ? [url] : []));
    if (typeof ports.assertTestMode !== 'function') {
        log('portal session: no test-mode check; not created');
        return { outcome: 'FAIL', detail: 'no Stripe test-mode check before creating the portal session' };
    }
    // The check is bounded like every other step: one that never answers fails the leg instead of hanging it, and no
    // session is created after a check that did not pass in time.
    try {
        // Wrapped in a promise so a check that throws synchronously is a refusal too.
        const checked = await withTimeout(new Promise((resolve) => resolve(ports.assertTestMode())), timeoutMs);
        if (checked === 'timeout') {
            log('portal session: the test-mode check timed out; not created');
            return { outcome: 'FAIL', detail: 'the Stripe test-mode check timed out, so no portal session was created' };
        }
        // Not throwing is not proof: only an explicit true proves test mode.
        if (checked !== true) {
            log('portal session: the test-mode check did not prove test mode; not created');
            return { outcome: 'FAIL', detail: 'the Stripe test-mode check did not prove test mode, so no portal session was created' };
        }
    }
    catch {
        log('portal session: the test-mode check refused; not created');
        return { outcome: 'FAIL', detail: 'the Stripe test-mode check refused, so no portal session was created' };
    }
    try {
        const created = await withTimeout(ports.createSession(), timeoutMs);
        if (created === 'timeout') {
            log('portal session: timed out');
            return { outcome: 'FAIL', detail: 'creating the portal session timed out' };
        }
        url = typeof created?.url === 'string' ? created.url : '';
    }
    catch (e) {
        log(`portal session: refused (${e instanceof Error ? e.message : String(e)})`);
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
        // Only an explicit true counts: a value the spec forgot to map, or mapped to a string, is never read as shown.
        const portalShown = shown?.portalShown === true;
        log(`portal: ${portalShown ? 'shown' : 'not shown'}`);
        return portalShown ? { outcome: 'PASS', detail: 'the test-mode billing portal opened' } : { outcome: 'FAIL', detail: 'the portal page was not shown' };
    }
    catch (e) {
        log(`portal: failed (${e instanceof Error ? e.message : String(e)})`);
        return { outcome: 'FAIL', detail: 'opening the portal failed' };
    }
}
/**
 * Billing rows left after a run, reported rather than promised away: Stripe and the product keep some by design
 * (customer, subscription, portal or checkout records). The check fails only when a row belongs to another account,
 * and holds when a table is not on the reviewed list, so a new kind of row is looked at before it is accepted.
 */
function reconcileBillingRows(rows, reviewedRetainedTables) {
    // An empty read, or a row without its counts, proves nothing: it holds rather than passing.
    if (!Array.isArray(rows) || rows.length === 0)
        return { outcome: 'HOLD', retained: [], detail: 'no billing table was read' };
    const unread = rows.filter((r) => typeof r?.table !== 'string' || !isCount(r.count) || !isCount(r.otherAccountRows));
    if (unread.length > 0)
        return { outcome: 'HOLD', retained: [], detail: `${unread.length} billing row count(s) not read` };
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
