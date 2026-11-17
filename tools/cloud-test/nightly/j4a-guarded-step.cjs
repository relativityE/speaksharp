'use strict';
// #1884 (Sam, 17 Nov): the actual J4.a step's effects through the bound supervised capability (`capabilities.nightly`, from
// bindSupervisedChild). Each call site puts the EFFECT inside the grant, so a grant can never be read as a send:
//   - signUp: the signup factory's click runs inside the guarded create (guarded-signup.cjs), once, retries 0, with the run's
//     fixed test domain recorded durably before it is sent;
//   - pressStart(click): the Start click runs inside the `starts` reservation. Refused: nothing is clicked (START_PRESS_CAP).
//     Granted but the click did not complete: NOT_RUN, and the parent records the send as lost, never ok;
//   - reserveCoaching(): for the guard proxy, before it forwards a coaching request. Resolves { granted: false } (the proxy
//     denies; nothing is forwarded) or { granted: true, sent(), failed() }: the parent's reservation settles ok only when the
//     proxy calls sent() after its upstream forward, and lost on failed() or if neither is ever called.
// Teardown is not here: the product's own deletion needs an emailed link, so cleanup is the parent's (decision with Sam).
const { guardedSignup } = require('./guarded-signup.cjs');

const LEG = 'J4.a';
const RUN_OWNED_PREFIX = 'rwt-journey-';
const fail = (code, why) => Object.assign(new Error(`${code}: ${why}`), { code });

/**
 * `cap`: the bound child capability. `identity`: the child's own bound identity (its runId names the reservation email).
 * `domain` / `configuredDomain`: the run's test domain, fixed when the step starts and checked against the configured one.
 * `factory(page, email)`: the signup UI action; called at most once, only inside the guarded create.
 */
function j4aGuardedRoutes(cap, { identity, domain, configuredDomain, factory }) {
    if (!cap || ['send', 'createAccount'].some((k) => typeof cap[k] !== 'function'))
        throw fail('NOT_RUN', 'no bound J4.a capability: nothing on the page may be touched');
    if (!identity || typeof identity.runId !== 'string' || identity.attempt !== 1)
        throw fail('NOT_RUN', 'no bound run identity for the reservation email');
    const signUpGuarded = guardedSignup({
        prefix: RUN_OWNED_PREFIX, runId: identity.runId, runAttempt: String(identity.attempt), domain, configuredDomain, factory,
        createAccount: (leg, lookupRef, send, options) => {
            if (leg !== LEG) throw fail('NOT_RUN', 'the J4.a capability creates only the J4.a account');
            return cap.createAccount(lookupRef, send, options);
        },
    });
    return Object.freeze({
        /** Resolves { created: true, account, email } or { created: false, reason }; never retries. */
        signUp: (page) => signUpGuarded(page, LEG),
        async pressStart(click) {
            if (typeof click !== 'function') throw fail('NOT_RUN', 'no Start click to guard');
            const r = await cap.send('starts', async () => { await click(); return null; });
            if (r?.granted !== true) throw fail('START_PRESS_CAP', 'the starts reservation was refused; nothing was clicked');
            if (r.ok !== true || r.lost === true) throw fail('NOT_RUN', 'the Start click did not complete after its grant');
        },
        reserveCoaching() {
            return new Promise((resolve) => {
                let settled = false;
                const result = cap.send('coaching', () => new Promise((sent, failed) => {
                    if (settled) { failed(new Error('late grant')); return; }
                    settled = true;
                    resolve(Object.freeze({ granted: true, sent: () => sent(null), failed: () => failed(new Error('forward failed')) }));
                }));
                Promise.resolve(result).then((r) => {
                    if (!settled) { settled = true; resolve({ granted: false, reason: r?.reason ?? 'the coaching reservation was refused' }); }
                }, () => { if (!settled) { settled = true; resolve({ granted: false, reason: 'the coaching reservation failed' }); } });
            });
        },
    });
}

module.exports = { LEG, RUN_OWNED_PREFIX, j4aGuardedRoutes };
