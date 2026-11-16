"use strict";
// Nightly AHT suite: recovering a guarded signup whose reply never arrived (Sam, 16 Nov). The integration of the pieces that
// already exist, with no second resolver:
//   - the attempt's durable record (cleanup-evidence.cjs) names its one reservation (`lookupRef`, the email's local part);
//   - the exact reservation email is rebuilt with the SAME fixed, verified domain the guarded signup used (guarded-signup.cjs);
//   - the complete exact-email lookup (account-lookup.cjs) reads the user listing; only a COMPLETE listing may say zero, and a
//     match without an id is unreadable;
//   - only `one` is recorded, as `.landed` (recordAttemptLanded, which re-checks it against the journey's one create through
//     account-reservation.cjs): scoped cleanup of that account is permitted, admission stays closed until a complete zero
//     residue after it. Every other outcome writes nothing, so admission stays closed and the reason is named.
// Pure orchestration over an injected `listUsers` (the admin client's shape); no hosted auth is called here.
const crypto = require('node:crypto');
const { enumerateUsers, exactEmailLookup } = require('./account-lookup.cjs');
const { readSentAttempt, recordAttemptLanded } = require('./cleanup-evidence.cjs');

const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

/**
 * Tries to establish the account an unanswered guarded signup may have created. Resolves `{ state: 'landed', lookup: 'one' }`
 * after recording it, or `{ state: 'blocked', lookup, reason }` having written nothing. Never resolves the attempt by itself.
 */
async function recoverUnansweredSignup({ evidenceDir, runId, attemptId, listUsers, domain, configuredDomain, runOwnedPrefix, now = () => new Date() }) {
    const fixed = typeof domain === 'string' ? domain.toLowerCase() : '';
    if (!DOMAIN.test(fixed) || typeof configuredDomain !== 'string' || fixed !== configuredDomain.toLowerCase())
        return { state: 'blocked', lookup: 'unreadable', reason: 'the reservation domain is not fixed to the configured test domain' };
    const sent = readSentAttempt(evidenceDir, runId, attemptId);
    if (!sent || typeof sent.lookupRef !== 'string')
        return { state: 'blocked', lookup: 'unreadable', reason: 'the attempt was never recorded or its record is unreadable' };
    const email = `${sent.lookupRef}@${fixed}`;
    const found = exactEmailLookup(await enumerateUsers(listUsers), { email, runOwnedPrefix });
    if (found.lookup !== 'one')
        return { state: 'blocked', lookup: found.lookup, reason: found.reason };
    // Only a digest of the server id is recorded; the id itself never reaches the evidence directory.
    const accountRef = `account-${crypto.createHash('sha256').update(found.uid).digest('hex').slice(0, 24)}`;
    try {
        recordAttemptLanded(evidenceDir, runId, attemptId, { lookupRef: sent.lookupRef, lookup: 'one', accountRef, observedAt: now().toISOString() });
    }
    catch (e) {
        return { state: 'blocked', lookup: 'one', reason: e.message };
    }
    return { state: 'landed', lookup: 'one', reason: 'the account was found under the reservation; scoped cleanup is permitted', accountRef };
}

module.exports = { recoverUnansweredSignup };
