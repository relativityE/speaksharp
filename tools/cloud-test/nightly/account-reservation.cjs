"use strict";
// Nightly AHT suite: the run-owned account a journey reserves, and what happens when a create request's reply never arrives.
//
// The rule (Sam, 16 Nov): an unanswered create must never lead to a second account, and no timer resolves it.
//   - A journey's reservation fixes ONE run-owned email before any create (the attempt's durable `lookupRef`), and admits
//     exactly ONE create under it: no retry and no create under another email. A second create could land after the first
//     account was found and deleted (late-after-delete), which no one-account-per-email rule prevents.
//   - An unanswered create is resolved only by an exact-email, unique-result admin lookup that FINDS the account: with one
//     create sent, `one` is that create, so it is the reservation's account (deleted through the normal checked path) and
//     nothing else can land later. `zero` proves nothing: the create may still land, so the reservation stays unresolved.
//   - An unreadable, ambiguous or non-run-owned lookup, or a reservation with any create count but one, stays unresolved.
// Admission stays refused while a reservation is unresolved. Pure: no network, and no account is created here.

/** The email local part a journey reservation owns: prefix, journey, run id, run attempt. Lower-case, stable, no secret. */
const LOCAL_PART = /^[a-z0-9][a-z0-9.-]{0,62}$/;
function reservationEmail({ prefix, journey, runId, runAttempt, domain }) {
    const parts = [prefix, journey, runId, runAttempt, domain];
    if (parts.some((p) => typeof p !== 'string' || p.length === 0))
        throw new Error('a reservation email needs a prefix, journey, run id, run attempt and domain');
    if (!/^\d+$/.test(runId) || !/^\d+$/.test(runAttempt))
        throw new Error('the run id and run attempt must be whole numbers');
    const local = `${prefix}${journey.toLowerCase()}-${runId}-${runAttempt}`;
    if (!LOCAL_PART.test(local) || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain))
        throw new Error('the reservation email is not a plain run-owned address');
    return `${local}@${domain.toLowerCase()}`;
}

/**
 * One email and ONE create per journey reservation. `admitCreate(journey, email)` is asked before the create is sent: the
 * first call fixes the email and admits the one create; every later call is refused, whether it names another email (a
 * second account) or the same one (a retry that could land after the first account is deleted).
 */
class AccountReservations {
    #reservations = new Map();
    admitCreate(journey, email) {
        const e = typeof email === 'string' ? email.toLowerCase() : '';
        if (!e)
            return { admitted: false, reason: 'a create needs the reservation email' };
        const held = this.#reservations.get(journey);
        if (held === undefined) {
            this.#reservations.set(journey, { email: e, createsSent: 1 });
            return { admitted: true, email: e };
        }
        if (held.email !== e)
            return { admitted: false, reason: `${journey} already reserved one email; a create under another address could make a second account` };
        return { admitted: false, reason: `${journey} already sent its one create; a retry could land after that account is deleted` };
    }
    emailOf(journey) { return this.#reservations.get(journey)?.email ?? null; }
    createsSent(journey) { return this.#reservations.get(journey)?.createsSent ?? 0; }
}

const LOOKUPS = new Set(['one', 'zero', 'ambiguous', 'not_run_owned', 'unreadable']);

/**
 * Whether an unanswered create is resolved, from the reservation's create count and the latest exact-email lookup.
 * `{ state: 'resolved', how: 'landed' }` only for one create sent and the account found; otherwise `{ state: 'unresolved',
 * reason }`, and admission stays refused.
 */
function resolveUnansweredCreate({ lookup, createsSent }) {
    if (createsSent !== 1)
        return { state: 'unresolved', reason: `the reservation sent ${Number.isInteger(createsSent) ? createsSent : 'an unknown number of'} creates, not exactly one: a late one could land after the found account is deleted` };
    if (!LOOKUPS.has(lookup))
        return { state: 'unresolved', reason: 'the exact-email lookup outcome is not one the resolver knows' };
    if (lookup === 'unreadable')
        return { state: 'unresolved', reason: 'the exact-email lookup could not be read, so nothing is known about the account' };
    if (lookup === 'ambiguous')
        return { state: 'unresolved', reason: 'more than one account carries the reservation email; refusing to choose' };
    if (lookup === 'not_run_owned')
        return { state: 'unresolved', reason: 'the only account with that email is not run-owned; refusing to touch it' };
    if (lookup === 'zero')
        return { state: 'unresolved', reason: 'no account carries the email yet, and absence proves nothing: the one create may still land' };
    return { state: 'resolved', how: 'landed', detail: 'the one create landed: that account is the reservation\'s, deleted through the checked path, and no other create can land' };
}

module.exports = { AccountReservations, reservationEmail, resolveUnansweredCreate };
