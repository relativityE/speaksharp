'use strict';
// Offline design fixture. Never imported by the runtime and not a source of production authority.
const { reservationEmail } = require('../../../nightly/account-reservation.cjs');
const SHA = /^[a-f0-9]{64}$/;
const DOMAIN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const deny = reason => ({ forwarded: false, reason });
const PATH = '/auth/v1/signup';
function reviewSignupGate(scope, transport) {
    const { binding, context, runId, origin, configuredDomain, leg, caseId } = scope;
    const target = new URL(origin);
    if (!SHA.test(binding) || !SHA.test(context) || !DOMAIN.test(configuredDomain)
        || target.protocol !== 'https:' || origin !== target.origin || target.port
        || leg !== 'J4.a' || caseId !== 'AHT-05' || typeof transport !== 'function') throw new Error('bad fixture scope');
    const email = reservationEmail({ prefix: 'rwt-journey-', journey: 'J4', runId, runAttempt: '1', domain: configuredDomain });
    const lookupRef = email.split('@')[0];
    let grant = null, signal = null, consumed = false;
    // This lives on the parent side in the fixture. A production producer would have to run only
    // inside createAccount's already-durable send callback; child claims/serialized grants are not enough.
    function admitFromParent(record, approvalSignal) {
        if (grant || !(approvalSignal instanceof AbortSignal) || approvalSignal.aborted
            || record?.binding !== binding || record.context !== context || record.runId !== runId
            || record.leg !== leg || record.caseId !== caseId || record.origin !== origin
            || record.attemptId !== 'J4.a-1' || record.retries !== 0 || record.durablyRecorded !== true
            || record.lookupRef !== lookupRef || record.emailDomain !== configuredDomain) return null;
        grant = Object.freeze({});
        signal = approvalSignal;
        return grant;
    }
    async function send(request, ticket) {
        if (!grant || ticket !== grant || consumed || signal.aborted) return deny('no-live-parent-grant');
        consumed = true; // even a malformed authorized attempt cannot be retried
        if (request?.binding !== binding || request.context !== context || request.runId !== runId
            || request.leg !== leg || request.caseId !== caseId || request.method !== 'POST'
            || request.url !== origin + PATH || request.contentType !== 'application/json'
            || !Buffer.isBuffer(request.body) || request.body.length > 4096) return deny('request-outside-scope');
        const bytes = Buffer.from(request.body); // transport bytes cannot change after validation
        let payload;
        try { payload = JSON.parse(bytes.toString('utf8')); } catch { return deny('bad-signup-body'); }
        if (JSON.stringify(Object.keys(payload ?? {}).sort()) !== '["email","password"]'
            || payload.email !== email || typeof payload.password !== 'string' || !payload.password) return deny('bad-signup-body');
        // Deliberately use an exact closed encoding for the fixture: no alternate duplicate JSON keys,
        // string encoding ambiguities, metadata, phone, or email-confirmation/redirect options.
        if (!bytes.equals(Buffer.from(JSON.stringify({ email: payload.email, password: payload.password })))) {
            return deny('bad-signup-encoding');
        }
        try {
            await transport({ url: origin + PATH, method: 'POST', body: bytes, signal, redirects: 'error', retries: 0 });
            return { forwarded: true, outcome: 'unresolved' }; // endpoint terminal evidence is a separate contract
        } catch { return { forwarded: true, outcome: 'unresolved' }; }
    }
    return Object.freeze({ admitFromParent, send });
}
module.exports = { reviewSignupGate, PATH };
