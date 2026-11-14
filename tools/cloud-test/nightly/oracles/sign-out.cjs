"use strict";
// Nightly AHT suite, J1.d sign-out rows (GAP-04), as #1864 (098f0ae) splits them:
//   - `signout-no-unauthorized-read`: around sign-out, no read succeeds without a valid session and no saved data
//     reaches the signed-out page. A 403 (or 401) denial is a correct answer, not a failure (Sam, 14 Nov).
//   - `signout-no-stale-request`: after sign-out completes, the page sends no further authenticated request with the
//     old session, whatever the answer. Reported separately.
// The spec records, per request from the sign-out press on, only content-free facts: method, path, status (null when
// no response came), a digest of the bearer it carried, whether it was sent after sign-out completed, and how many of
// the account's own identifiers (session ids, user id, transcript digests) the body held. Bodies and tokens are never stored.
// The session's token can refresh during the leg, so the spec records the digest of every token issued to the session
// before sign-out (`signedInBearerDigests`), and a request with any of them counts as the session's.
const ok = (s) => s !== null && s >= 200 && s < 300;
const DIGEST = /^[0-9a-f]{64}$/;
function precondition(o) {
    if (!o.signOutCompletedObserved)
        return { outcome: 'HOLD', detail: 'the signed-out state was not observed' };
    const digests = o.signedInBearerDigests;
    if (!Array.isArray(digests) || digests.length === 0 || !digests.every((d) => DIGEST.test(d)))
        return { outcome: 'HOLD', detail: 'the signed-in token digests were not recorded' };
    if (!Array.isArray(o.requests) || typeof o.ownedIdentifiersRendered !== 'number')
        return { outcome: 'HOLD', detail: 'the requests or the signed-out page were not observed' };
    const unread = o.requests.filter((r) => typeof r.ownedIdentifiersInBody !== 'number' || typeof r.sentAfterSignOutCompleted !== 'boolean');
    if (unread.length > 0)
        return { outcome: 'HOLD', detail: `${unread.length} request(s) not fully observed` };
    return null;
}
/** A token issued to the session before sign-out, the first one or any refresh of it. */
const sessionToken = (o, r) => r.bearerDigest !== null && o.signedInBearerDigests.includes(r.bearerDigest);
/** A request had a valid session only if it carried one of the session's tokens before sign-out completed. */
const hadValidSession = (o, r) => !r.sentAfterSignOutCompleted && sessionToken(o, r);
function unauthorizedReadVerdict(o) {
    const pre = precondition(o);
    if (pre)
        return pre;
    const refused = o.requests.filter((r) => r.status === 401 || r.status === 403).length;
    const reads = o.requests.filter((r) => ok(r.status) && r.ownedIdentifiersInBody > 0 && !hadValidSession(o, r));
    const problems = [];
    if (reads.length > 0)
        problems.push(`${reads.length} read(s) returned the account's data without a valid session (${[...new Set(reads.map((r) => `${r.method} ${r.path}`))].join(', ')})`);
    if (o.ownedIdentifiersRendered > 0)
        problems.push(`${o.ownedIdentifiersRendered} of the account's own identifiers reached the signed-out page`);
    if (problems.length > 0)
        return { outcome: 'FAIL', detail: problems.join('; ') };
    return { outcome: 'PASS', detail: `no read succeeded without a valid session and no data reached the page (${refused} denial(s), correct)` };
}
function staleRequestVerdict(o) {
    const pre = precondition(o);
    if (pre)
        return pre;
    const stale = o.requests.filter((r) => r.sentAfterSignOutCompleted && sessionToken(o, r));
    if (stale.length > 0) {
        return { outcome: 'FAIL', detail: `${stale.length} request(s) sent with the old session after sign-out (${[...new Set(stale.map((r) => `${r.method} ${r.path}`))].join(', ')})` };
    }
    return { outcome: 'PASS', detail: 'no authenticated request with the old session after sign-out' };
}

module.exports = { staleRequestVerdict, unauthorizedReadVerdict };
