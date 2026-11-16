"use strict";
// Nightly AHT suite: the exact-email account lookup a lost-reply recovery depends on (Sam, 16 Nov), offline and nightly-owned.
// The shared `tests/live/helpers/proofAuthority.ts` (`pollForRecoveryUid`) is NOT changed here; its gaps are what this pins:
//   - it reads at most 50 x 200 users and stops silently at the cap, so past 10,000 users a present account reads as `zero`;
//   - it ignores the total, and a matching row with no id reads as `zero`.
// auth-js 2.86.0 `listUsers` also cannot be trusted for completeness on its own: `total` is set only when a Link header is
// present (otherwise 0), and next/last page are parsed from the FIRST DIGIT of the page number only. So an enumeration is
// complete only when it ends on a SHORT page and every reported total agrees with what was collected. Anything else,
// including a listing error or a malformed page, is `unreadable`: never `zero`.
const FULL_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Pages through `listUsers({ page, perPage })` (the admin client's shape: `{ data: { users, total? }, error }`) and returns
 * `{ complete, reason, users }`. Complete only on a short last page with every reported total equal to the count collected.
 */
async function enumerateUsers(listUsers, { perPage = 200, maxPages = 50 } = {}) {
    if (!Number.isInteger(perPage) || perPage < 1 || !Number.isInteger(maxPages) || maxPages < 1)
        return { complete: false, reason: 'the page size or page cap is not a positive whole number', users: [] };
    const users = [];
    const totals = new Set();
    for (let page = 1; page <= maxPages; page += 1) {
        let r;
        try {
            r = await listUsers({ page, perPage });
        }
        catch {
            return { complete: false, reason: `the listing threw on page ${page}`, users };
        }
        if (!r || r.error)
            return { complete: false, reason: `the listing failed on page ${page}`, users };
        const batch = r.data?.users;
        if (!Array.isArray(batch) || batch.length > perPage)
            return { complete: false, reason: `page ${page} is malformed`, users };
        users.push(...batch);
        const total = r.data?.total;
        if (Number.isInteger(total) && total > 0) totals.add(total);
        if (batch.length < perPage) {
            if ([...totals].some((t) => t !== users.length))
                return { complete: false, reason: `the reported total (${[...totals].join('/')}) disagrees with the ${users.length} users read`, users };
            return { complete: true, reason: `read ${users.length} users, ending on a short page`, users };
        }
    }
    return { complete: false, reason: `the page cap (${maxPages} x ${perPage}) was reached on a full page: the listing is truncated`, users };
}

/**
 * The exact-email outcome over an enumeration: `one` (with `uid`), `zero`, `ambiguous`, `not_run_owned`, or `unreadable`.
 * Only a COMPLETE enumeration can say `zero`; a matching row without an id is `unreadable`, never `zero`.
 */
function exactEmailLookup(enumeration, { email, runOwnedPrefix }) {
    if (typeof email !== 'string' || !FULL_EMAIL.test(email) || typeof runOwnedPrefix !== 'string' || !runOwnedPrefix)
        return { lookup: 'unreadable', reason: 'the lookup needs the exact run-owned email and its prefix' };
    if (!enumeration || enumeration.complete !== true || !Array.isArray(enumeration.users))
        return { lookup: 'unreadable', reason: enumeration?.reason ?? 'the user listing is not complete' };
    const want = email.toLowerCase();
    const matches = enumeration.users.filter((u) => typeof u?.email === 'string' && u.email.toLowerCase() === want);
    if (matches.length === 0) return { lookup: 'zero', reason: 'a complete listing has no account with that email' };
    if (matches.length > 1) return { lookup: 'ambiguous', reason: `${matches.length} accounts carry that email` };
    const only = matches[0];
    if (!only.email.toLowerCase().startsWith(runOwnedPrefix.toLowerCase())) return { lookup: 'not_run_owned', reason: 'the only match is not run-owned' };
    if (typeof only.id !== 'string' || only.id.length === 0) return { lookup: 'unreadable', reason: 'the matching account has no id' };
    return { lookup: 'one', uid: only.id, reason: 'exactly one run-owned account carries that email' };
}

module.exports = { enumerateUsers, exactEmailLookup };
