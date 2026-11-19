'use strict';

// Offline precursor to the supervised J4.a capability. This only binds identity.
// It authorizes no browser, signup, cleanup, or network operation.
const { createHash, randomBytes } = require('node:crypto');

const BINDING = 'speaksharp.cloud-test.j4a-binding.v1';
const OFFER = 'speaksharp.cloud-test.j4a-offer.v1';
const ACK = 'speaksharp.cloud-test.j4a-bound.v1';
const FIELDS = ['campaignId', 'runId', 'attempt', 'caseId', 'requestSha256',
    'planSha256', 'configSha256', 'sourceSha', 'servedSha'];
const IDENTITY = /^[A-Za-z0-9._:-]{1,128}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40}$/;
const NONCE = /^[a-f0-9]{32}$/;
const matches = (shape, value) => typeof value === 'string' && shape.test(value);
const exact = (obj, keys) => obj !== null && typeof obj === 'object' && !Array.isArray(obj)
    && Object.keys(obj).length === keys.length && keys.every((key) => Object.hasOwn(obj, key));

function bindingDigest(identity) {
    if (!exact(identity, FIELDS) || !matches(IDENTITY, identity.campaignId) || !matches(IDENTITY, identity.runId)
        || identity.caseId !== 'AHT-05' || identity.attempt !== 1
        || !['requestSha256', 'planSha256', 'configSha256'].every((k) => matches(SHA256, identity[k]))
        || !['sourceSha', 'servedSha'].every((k) => matches(SHA, identity[k])))
        throw new Error('J4A_BINDING_INVALID');
    return createHash('sha256').update(JSON.stringify([BINDING, ...FIELDS.map((key) => identity[key])])).digest('hex');
}

/** The supervising parent uses its own reviewed run identity and issues exactly one challenge. */
function beginBinding(parentIdentity) {
    const digest = bindingDigest(parentIdentity);
    const nonce = randomBytes(16).toString('hex');
    const offer = Object.freeze({ schema: OFFER, digest, nonce });
    let pending = true;
    return Object.freeze({
        offer,
        accept(ack) {
            if (!pending)
                throw new Error('J4A_BINDING_ALREADY_CONSUMED');
            pending = false; // malformed first reply is terminal; no retries on this attempt
            if (!exact(ack, ['schema', 'digest', 'nonce']) || ack.schema !== ACK
                || ack.digest !== digest || ack.nonce !== nonce)
                throw new Error('J4A_BINDING_REJECTED');
            return digest;
        },
    });
}

/** The child must use its locally validated identity, not identity received from the parent. */
function acknowledgeBinding(childIdentity, offer) {
    const digest = bindingDigest(childIdentity);
    if (!exact(offer, ['schema', 'digest', 'nonce']) || offer.schema !== OFFER
        || !matches(NONCE, offer.nonce) || offer.digest !== digest)
        throw new Error('J4A_BINDING_REJECTED');
    return Object.freeze({ schema: ACK, digest, nonce: offer.nonce });
}

module.exports = { beginBinding, acknowledgeBinding };
