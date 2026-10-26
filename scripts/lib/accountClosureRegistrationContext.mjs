const MAX_TEXT_LENGTH = 262144;
const MAX_AGE_MS = 15 * 60_000;
const CONTEXT_KEYS = ['candidateSha', 'mainSha', 'migrationDigest', 'target', 'configDigest', 'evidenceDigest', 'deployments', 'legacyScopes'];
const BINDING_KEYS = ['candidateSha', 'mainSha', 'migrationDigest', 'target', 'configDigest', 'evidenceDigest', 'generation'];
const RECEIPT_KEYS = ['binding', 'observedAt', 'expiresAt', 'sourceRef', 'evidenceDigest'];
const text = (v) => typeof v === 'string' && /^[a-zA-Z0-9_.:-]{1,160}$/.test(v);
const sha = (v, length = 64) => typeof v === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(v);
const uuid = (v) => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const time = (v) => {
    if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)) return NaN;
    const n = Date.parse(v);
    return Number.isFinite(n) && new Date(n).toISOString() === v ? n : NaN;
};
const generation = (v) => typeof v === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(v) && BigInt(v) <= 9223372036854775807n;
const canonical = (v) => Array.isArray(v) ? v.map(canonical) : object(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/**
 * Offline assembly ONLY, with no imports, I/O, registration callback or CLI.
 * Both arguments must be bounded JSON text; objects/accessors/toJSON are never
 * read or coerced. JSON.parse supplies plain data (standard duplicate-key
 * last-value semantics); this is not a signature or raw-JSON canonicalizer.
 * The expected document must come from an independently pinned caller, never
 * from the observations. No pure validator can establish that independence.
 *
 * CANDIDATE_ONLY proves structural consistency of injected data, NOT authentic
 * provenance, complete platform coverage, schema installation, provider truth,
 * account readiness, registration or activation. sourceRef/digests are supplied
 * references, not verified receipts. All operational guards remain elsewhere.
 * Legacy cutover, effective configuration and per-account observations are
 * distinct layers; routine account closure requires no global worker shutdown.
 * Account booleans are retained claims, never authorization. In particular,
 * closure-eligible fenced_unknown remains providerOutcome:'unknown'.
 */
export function assembleAccountClosureRegistrationContext(expectedJson, observationsJson) {
    const missingFields = [];
    const add = (path, reason) => { missingFields.push({ path, reason }); };
    function parse(raw, path) {
        if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_TEXT_LENGTH) {
            add(path, 'INVALID_TYPE'); return null;
        }
        let parsed;
        try { parsed = JSON.parse(raw); } catch { add(path, 'INVALID_TYPE'); return null; }
        let count = 0;
        function bounded(v, depth) {
            if (++count > 10000 || depth > 24) return false;
            if (typeof v === 'number' && !Number.isFinite(v)) return false;
            if (!object(v) && !Array.isArray(v)) return true;
            const keys = Object.keys(v);
            if (keys.length > 128 || keys.some((k) => ['__proto__', 'prototype', 'constructor'].includes(k))) return false;
            return keys.every((k) => bounded(v[k], depth + 1));
        }
        if (!bounded(parsed, 0)) { add(path, 'INVALID_TYPE'); return null; }
        return parsed;
    }
    function closed(v, keys, path) {
        if (!object(v)) { add(path, v === undefined ? 'MISSING' : 'INVALID_TYPE'); return false; }
        for (const k of keys) if (!Object.hasOwn(v, k)) add(`${path}.${k}`, 'MISSING');
        for (const k of Object.keys(v)) if (!keys.includes(k)) add(path, 'INVALID_TYPE');
        return keys.every((k) => Object.hasOwn(v, k)) && Object.keys(v).every((k) => keys.includes(k));
    }
    function field(v, predicate, path) {
        if (!predicate(v)) add(path, v === undefined ? 'MISSING' : 'INVALID_TYPE');
    }
    function target(v, path) {
        if (!closed(v, ['projectId', 'environment'], path)) return;
        field(v.projectId, text, `${path}.projectId`);
        field(v.environment, (x) => ['production', 'disposable'].includes(x), `${path}.environment`);
    }
    function inventory(v, kind, path) {
        if (!Array.isArray(v) || v.length === 0 || v.length > 128) { add(path, 'INCOMPLETE_SCOPE'); return; }
        const keys = kind === 'deployment' ? ['function', 'region', 'deploymentId', 'version', 'sha']
            : ['scopeId', 'deploymentId', 'region', 'sha'];
        const seen = new Set();
        for (const [i, item] of v.entries()) {
            const p = `${path}[${i}]`;
            if (!closed(item, keys, p)) continue;
            for (const k of keys) field(item[k], k === 'sha' ? (x) => sha(x, 40) : text, `${p}.${k}`);
            if (kind === 'deployment' && !['stripe-checkout', 'account-closure'].includes(item.function)) add(`${p}.function`, 'INVALID_TYPE');
            const key = kind === 'deployment' ? `${item.function}:${item.region}` : item.scopeId;
            if (seen.has(key)) add(p, 'INCOMPLETE_SCOPE');
            seen.add(key);
        }
        if (kind === 'deployment' && !['stripe-checkout', 'account-closure'].every((name) => v.some((d) => d?.function === name))) {
            add(path, 'INCOMPLETE_SCOPE');
        }
    }
    function context(v, path) {
        if (!closed(v, CONTEXT_KEYS, path)) return;
        for (const k of ['candidateSha', 'mainSha', 'migrationDigest', 'configDigest', 'evidenceDigest']) {
            field(v[k], (x) => sha(x, k.endsWith('Sha') ? 40 : 64), `${path}.${k}`);
        }
        target(v.target, `${path}.target`);
        inventory(v.deployments, 'deployment', `${path}.deployments`);
        inventory(v.legacyScopes, 'legacy', `${path}.legacyScopes`);
        if (Array.isArray(v.deployments)) for (const [i, d] of v.deployments.entries()) {
            if (object(d) && d.sha !== v.candidateSha) add(`${path}.deployments[${i}].sha`, 'MISMATCH');
        }
    }
    const expected = parse(expectedJson, 'expected');
    const observations = parse(observationsJson, 'observations');
    const expectedShape = closed(expected, ['now', 'maximumAgeMs', 'context', 'generation', 'accountId'], 'expected');
    const observedShape = closed(observations, ['context', 'generation', 'legacyEvidence', 'configurationEvidence', 'accountEvidence'], 'observations');
    if (expectedShape) {
        field(expected.now, (v) => Number.isFinite(time(v)), 'expected.now');
        field(expected.maximumAgeMs, (v) => Number.isSafeInteger(v) && v > 0 && v <= MAX_AGE_MS, 'expected.maximumAgeMs');
        context(expected.context, 'expected.context');
        field(expected.generation, generation, 'expected.generation');
        field(expected.accountId, uuid, 'expected.accountId');
    }
    if (observedShape) {
        context(observations.context, 'observations.context');
        field(observations.generation, generation, 'observations.generation');
    }
    const validExpectation = expectedShape && !missingFields.some((f) => f.path.startsWith('expected'));
    if (validExpectation && observedShape) {
        for (const k of CONTEXT_KEYS) {
            if (['deployments', 'legacyScopes'].includes(k)) continue;
            if (!same(observations.context?.[k], expected.context[k])) add(`observations.context.${k}`, 'MISMATCH');
        }
        if (observations.generation !== expected.generation) add('observations.generation', 'MISMATCH');
        function coverage(actual, wanted, path) {
            if (!Array.isArray(actual) || actual.length !== wanted.length
                || !wanted.every((entry) => actual.filter((item) => same(item, entry)).length === 1)) add(path, 'INCOMPLETE_SCOPE');
        }
        coverage(observations.context?.deployments, expected.context.deployments, 'observations.context.deployments');
        coverage(observations.context?.legacyScopes, expected.context.legacyScopes, 'observations.context.legacyScopes');
        const binding = Object.fromEntries(BINDING_KEYS.map((k) => [k, k === 'generation' ? expected.generation : expected.context[k]]));
        function receipt(v, extras, path) {
            if (!closed(v, [...RECEIPT_KEYS, ...extras], path)) return false;
            if (!closed(v.binding, BINDING_KEYS, `${path}.binding`)) return false;
            for (const k of BINDING_KEYS) if (!same(v.binding[k], binding[k])) add(`${path}.binding.${k}`, 'MISMATCH');
            if (!text(v.sourceRef)) add(`${path}.sourceRef`, 'UNVERIFIED');
            field(v.evidenceDigest, sha, `${path}.evidenceDigest`);
            const at = time(v.observedAt); const end = time(v.expiresAt); const now = time(expected.now);
            if (!Number.isFinite(at)) add(`${path}.observedAt`, 'INVALID_TYPE');
            if (!Number.isFinite(end)) add(`${path}.expiresAt`, 'INVALID_TYPE');
            if (Number.isFinite(at) && Number.isFinite(end)
                && (at > now || now - at > expected.maximumAgeMs || end <= now || end <= at || end - at > expected.maximumAgeMs)) {
                add(path, 'STALE');
            }
            return true;
        }
        const legacy = observations.legacyEvidence;
        if (receipt(legacy, ['scopes'], 'observations.legacyEvidence')) {
            inventory(legacy.scopes, 'legacy', 'observations.legacyEvidence.scopes');
            coverage(legacy.scopes, expected.context.legacyScopes, 'observations.legacyEvidence.scopes');
        }
        const config = observations.configurationEvidence;
        if (receipt(config, ['deployments', 'configDigest'], 'observations.configurationEvidence')) {
            inventory(config.deployments, 'deployment', 'observations.configurationEvidence.deployments');
            coverage(config.deployments, expected.context.deployments, 'observations.configurationEvidence.deployments');
            if (config.configDigest !== expected.context.configDigest) add('observations.configurationEvidence.configDigest', 'MISMATCH');
        }
        const account = observations.accountEvidence;
        if (receipt(account, ['accountId', 'pending', 'admissionDenied', 'settled', 'coaching'], 'observations.accountEvidence')) {
            if (account.accountId !== expected.accountId) add('observations.accountEvidence.accountId', 'MISMATCH');
            for (const k of ['pending', 'admissionDenied']) field(account[k], (v) => typeof v === 'boolean', `observations.accountEvidence.${k}`);
            if (closed(account.settled, ['recording', 'checkout', 'coaching'], 'observations.accountEvidence.settled')) {
                for (const k of ['recording', 'checkout', 'coaching']) field(account.settled[k], (v) => typeof v === 'boolean', `observations.accountEvidence.settled.${k}`);
            }
            if (closed(account.coaching, ['providerOutcome', 'closureDisposition', 'fenceEvidenceDigest'], 'observations.accountEvidence.coaching')) {
                const c = account.coaching;
                field(c.providerOutcome, (v) => ['success', 'failed', 'unknown'].includes(v), 'observations.accountEvidence.coaching.providerOutcome');
                field(c.closureDisposition, (v) => ['settled', 'fenced_unknown', 'unresolved'].includes(v), 'observations.accountEvidence.coaching.closureDisposition');
                field(c.fenceEvidenceDigest, (v) => v === null || sha(v), 'observations.accountEvidence.coaching.fenceEvidenceDigest');
                if ((c.closureDisposition === 'fenced_unknown' && (c.providerOutcome !== 'unknown' || !sha(c.fenceEvidenceDigest)))
                    || (c.closureDisposition === 'settled' && c.providerOutcome === 'unknown')
                    || (account.settled?.coaching === true && c.closureDisposition === 'unresolved')) add('observations.accountEvidence.coaching', 'MISMATCH');
            }
        }
    }
    const failures = [...new Map(missingFields.map((entry) => [`${entry.path}:${entry.reason}`, entry])).values()];
    return {
        kind: 'OFFLINE_CONTEXT_ASSEMBLY', status: failures.length === 0 ? 'CANDIDATE_ONLY' : 'HOLD',
        contextCandidate: failures.length === 0 ? {
            registrationContext: observations.context, suppliedGeneration: observations.generation,
            legacyEvidence: observations.legacyEvidence, configurationEvidence: observations.configurationEvidence,
            accountEvidence: observations.accountEvidence,
        } : null,
        missingFields: failures, registrationAuthorized: false, activationAuthorized: false,
        proofClass: 'INJECTED_PROVENANCE_ONLY',
    };
}
