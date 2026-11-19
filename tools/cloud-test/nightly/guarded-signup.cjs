"use strict";
// Nightly AHT suite: the ONLY signup path the new runner may use (Sam, 16 Nov). A nightly-owned wrapper around the existing
// factory (`signUpDisposableAccount(page, email)` in tests/live/helpers/rwtJourney.ts, passed in by the caller so this file
// edits no shared helper):
//   1. the wrapper fixes the exact reservation email: the journey, run and attempt in the local part, and a domain fixed for
//      the run and verified against the configured test domain (the local part alone is never trusted);
//   2. the attempt is recorded durably through the bridge's guarded route (`createAccount(leg, lookupRef, send)`), which also
//      refuses a second create for the journey, including after a restart;
//   3. only then, inside `send`, the factory is called ONCE with that exact email.
// The guard is required, not optional: without a `createAccount` route, nothing on the page is touched. This proves the runner
// SUBMITS once; it does not prove the network delivers once.
const { reservationEmail } = require('./account-reservation.cjs');

const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

/**
 * The run's guarded signup. `domain` is fixed when the runner is built and must equal `configuredDomain` (the run's
 * LIVE_TEST_EMAIL_DOMAIN); every reservation in the run uses it.
 */
function guardedSignup({ prefix, runId, runAttempt, domain, configuredDomain, createAccount, factory }) {
    if (typeof createAccount !== 'function')
        throw new Error('the guarded signup needs the bridge\'s createAccount route: there is no unguarded signup path');
    if (typeof factory !== 'function')
        throw new Error('the guarded signup needs the signup factory');
    const fixed = typeof domain === 'string' ? domain.toLowerCase() : '';
    if (!DOMAIN.test(fixed) || typeof configuredDomain !== 'string' || fixed !== configuredDomain.toLowerCase())
        throw new Error('the reservation domain is not fixed to the configured test domain, so the local part alone would not identify the account');
    /**
     * Signs up the journey's one run-owned account for `leg`. Resolves `{ created: true, account }` with the factory's handle,
     * or `{ created: false, reason }` when the guard refused (nothing was clicked). A factory failure after the record is
     * written propagates: the attempt stays unresolved and admission stays closed.
     */
    return async function signUpGuarded(page, leg) {
        const journey = String(leg).split('.')[0];
        const email = reservationEmail({ prefix, journey, runId, runAttempt, domain: fixed });
        const lookupRef = email.slice(0, email.indexOf('@'));
        let account = null;
        let factoryCalls = 0;
        const route = await createAccount(leg, lookupRef, async ({ retries }) => {
            if (retries !== 0)
                throw new Error('the guarded signup sends once: the route must forbid retries');
            factoryCalls += 1;
            account = await factory(page, email);
            if (!account || typeof account.uid !== 'string' || !account.uid)
                return { outcome: 'unknown' };
            return { outcome: 'created', accountRef: `account-${journey.toLowerCase()}` };
        }, { emailDomain: fixed });
        if (!route || route.sent !== true)
            return { created: false, reason: route?.reason ?? 'the guarded route refused the create', factoryCalls };
        if (route.answered !== true)
            return { created: false, reason: route.reason ?? 'the create was not answered', factoryCalls, unresolved: true };
        return { created: true, account, email, factoryCalls };
    };
}

module.exports = { guardedSignup };
