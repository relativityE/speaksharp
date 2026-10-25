// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { assembleAccountClosureRegistrationContext as assemble } from '../../scripts/lib/accountClosureRegistrationContext.mjs';

const hash = (c, length = 64) => c.repeat(length);
const user = '11111111-1111-4111-8111-111111111111';
function fixture() {
    const context = {
        candidateSha: hash('a', 40), mainSha: hash('b', 40), migrationDigest: hash('c'),
        target: { projectId: 'test-project', environment: 'disposable' }, configDigest: hash('d'), evidenceDigest: hash('e'),
        deployments: ['account-closure', 'stripe-checkout'].map((name) => ({ function: name, region: 'us-east-1',
            deploymentId: `${name}-7`, version: '7', sha: hash('a', 40) })),
        legacyScopes: [{ scopeId: 'checkout-old', deploymentId: 'checkout-6', region: 'us-east-1', sha: hash('f', 40) }],
    };
    const expected = { now: '2026-10-24T22:00:00.000Z', maximumAgeMs: 60000, context, generation: '7', accountId: user };
    const binding = { candidateSha: context.candidateSha, mainSha: context.mainSha, migrationDigest: context.migrationDigest,
        target: context.target, configDigest: context.configDigest, evidenceDigest: context.evidenceDigest, generation: '7' };
    const receipt = { binding, observedAt: '2026-10-24T21:59:45.000Z', expiresAt: '2026-10-24T22:00:30.000Z',
        sourceRef: 'injected-fixture-only', evidenceDigest: hash('1') };
    return JSON.parse(JSON.stringify({ expected, observations: { context, generation: '7',
        legacyEvidence: { ...receipt, scopes: context.legacyScopes },
        configurationEvidence: { ...receipt, deployments: context.deployments, configDigest: context.configDigest },
        accountEvidence: { ...receipt, accountId: user, pending: true, admissionDenied: true,
            settled: { recording: true, checkout: true, coaching: true },
            coaching: { providerOutcome: 'unknown', closureDisposition: 'fenced_unknown', fenceEvidenceDigest: hash('2') } },
    } }));
}
const run = (s = fixture()) => assemble(JSON.stringify(s.expected), JSON.stringify(s.observations));
function held(s, path, reason) {
    const result = run(s);
    expect(result.status).toBe('HOLD');
    expect(result.contextCandidate).toBeNull();
    expect(result.missingFields).toContainEqual({ path, reason });
    expect(result.registrationAuthorized).toBe(false);
    expect(result.activationAuthorized).toBe(false);
    return result;
}

describe('offline registration context candidate — no authenticity or operational authority', () => {
    it('assembles consistent injected data without converting UNKNOWN into provider success', () => {
        const s = fixture(); const before = structuredClone(s); const result = run(s);
        expect(result).toEqual({ kind: 'OFFLINE_CONTEXT_ASSEMBLY', status: 'CANDIDATE_ONLY', missingFields: [],
            contextCandidate: { registrationContext: s.observations.context, suppliedGeneration: '7',
                legacyEvidence: s.observations.legacyEvidence, configurationEvidence: s.observations.configurationEvidence,
                accountEvidence: s.observations.accountEvidence },
            registrationAuthorized: false, activationAuthorized: false, proofClass: 'INJECTED_PROVENANCE_ONLY' });
        expect(result).not.toHaveProperty('context'); expect(result).not.toHaveProperty('generation');
        expect(result.contextCandidate.accountEvidence.coaching.providerOutcome).toBe('unknown');
        expect(s).toEqual(before);
    });

    it('retains non-ready account observations without representing them as closure permission', () => {
        const s = fixture(); s.observations.accountEvidence.pending = false;
        s.observations.accountEvidence.admissionDenied = false;
        s.observations.accountEvidence.settled = { recording: false, checkout: false, coaching: false };
        s.observations.accountEvidence.coaching = { providerOutcome: 'unknown', closureDisposition: 'unresolved', fenceEvidenceDigest: null };
        const result = run(s);
        expect(result.status).toBe('CANDIDATE_ONLY');
        expect(result.contextCandidate.accountEvidence).toEqual(s.observations.accountEvidence);
        expect(result.registrationAuthorized).toBe(false); expect(result.activationAuthorized).toBe(false);
    });

    it('compares complete scope identities independently of list and object key order', () => {
        const s = fixture(); s.observations.context.deployments.reverse();
        s.observations.configurationEvidence.deployments.reverse();
        s.observations.context.target = { environment: 'disposable', projectId: 'test-project' };
        expect(run(s).status).toBe('CANDIDATE_ONLY');
    });

    it.each(['candidateSha', 'mainSha', 'migrationDigest', 'configDigest', 'evidenceDigest', 'target'])(
        'rejects candidate-controlled %s even when its own layers agree', (key) => {
            expect.hasAssertions();
            const s = fixture(); const value = key === 'target' ? { projectId: 'other', environment: 'disposable' }
                : hash('9', key.endsWith('Sha') ? 40 : 64);
            s.observations.context[key] = value;
            for (const k of ['legacyEvidence', 'configurationEvidence', 'accountEvidence']) {
                if (Object.hasOwn(s.observations[k].binding, key)) s.observations[k].binding[key] = value;
            }
            held(s, `observations.context.${key}`, 'MISMATCH');
        },
    );

    it.each(['legacyEvidence', 'configurationEvidence', 'accountEvidence'])('requires the separate %s layer', (layer) => {
        expect.hasAssertions();
        const s = fixture(); delete s.observations[layer]; held(s, `observations.${layer}`, 'MISSING');
    });

    it.each(['candidateSha', 'mainSha', 'migrationDigest', 'target', 'configDigest', 'evidenceDigest', 'generation'])('rejects cross-bound layer %s', (key) => {
        expect.hasAssertions();
        const s = fixture(); s.observations.configurationEvidence.binding[key] = key === 'target'
            ? { projectId: 'other', environment: 'disposable' } : key === 'generation' ? '8' : hash('8', key.endsWith('Sha') ? 40 : 64);
        held(s, `observations.configurationEvidence.binding.${key}`, 'MISMATCH');
    });

    it.each(['legacyEvidence', 'configurationEvidence', 'accountEvidence'])('requires provenance reference on %s, without authenticating its string', (layer) => {
        expect.hasAssertions();
        const s = fixture(); s.observations[layer].sourceRef = '';
        held(s, `observations.${layer}.sourceRef`, 'UNVERIFIED');
    });

    it.each(['candidateSha', 'mainSha', 'migrationDigest', 'configDigest', 'evidenceDigest', 'target', 'deployments', 'legacyScopes'])(
        'requires context field %s', (key) => {
            expect.hasAssertions();
            const s = fixture(); delete s.observations.context[key]; held(s, `observations.context.${key}`, 'MISSING');
        },
    );

    it.each(['complete', 'verified', 'registrationAuthorized', 'activationAuthorized'])('does not trust caller completeness/authority flag %s', (key) => {
        expect.hasAssertions();
        const s = fixture(); s.observations[key] = true; held(s, 'observations', 'INVALID_TYPE');
    });

    it('does not promote the partial HOLD snapshot produced by the existing acquisition contract', () => {
        const s = fixture(); const output = assemble(JSON.stringify(s.expected), JSON.stringify({ status: 'HOLD',
            facts: { target: s.expected.context.target, candidateSha: s.expected.context.candidateSha }, activationAuthorized: false }));
        expect(output.status).toBe('HOLD'); expect(output.contextCandidate).toBeNull();
        expect(output.missingFields).toContainEqual({ path: 'observations.context', reason: 'MISSING' });
    });

    it.each(['missing', 'duplicate', 'wrong-region', 'wrong-version', 'wrong-sha', 'unexpected'])(
        'rejects %s configuration inventory even with an unchanged digest/count claim', (kind) => {
            expect.hasAssertions();
            const s = fixture(); const list = s.observations.configurationEvidence.deployments;
            if (kind === 'missing') list.pop();
            if (kind === 'duplicate') list[1] = structuredClone(list[0]);
            if (kind === 'wrong-region') list[0].region = 'eu-west-1';
            if (kind === 'wrong-version') list[0].version = '8';
            if (kind === 'wrong-sha') list[0].sha = hash('9', 40);
            if (kind === 'unexpected') list.push({ ...list[0], region: 'eu-west-1' });
            held(s, 'observations.configurationEvidence.deployments', 'INCOMPLETE_SCOPE');
        },
    );

    it('rejects an incomplete legacy list separately from responding configuration instances', () => {
        expect.hasAssertions();
        const s = fixture(); s.observations.legacyEvidence.scopes = [];
        held(s, 'observations.legacyEvidence.scopes', 'INCOMPLETE_SCOPE');
    });

    it.each([
        ['future', '2026-10-24T22:00:00.001Z', '2026-10-24T22:00:30.000Z'],
        ['stale', '2026-10-24T21:58:59.999Z', '2026-10-24T22:00:30.000Z'],
        ['expiry boundary', '2026-10-24T21:59:45.000Z', '2026-10-24T22:00:00.000Z'],
        ['too long', '2026-10-24T21:59:45.000Z', '2026-10-24T22:00:45.001Z'],
        ['reversed', '2026-10-24T21:59:45.000Z', '2026-10-24T21:59:44.000Z'],
    ])('holds %s provenance under the separately supplied clock', (_name, observedAt, expiresAt) => {
        expect.hasAssertions();
        const s = fixture(); Object.assign(s.observations.accountEvidence, { observedAt, expiresAt });
        held(s, 'observations.accountEvidence', 'STALE');
    });

    it('rejects dates normalized by Date.parse and an invalid expected time budget', () => {
        expect.hasAssertions();
        const s = fixture(); s.expected.now = '2026-02-30T22:00:00.000Z'; s.expected.maximumAgeMs = 900001;
        held(s, 'expected.now', 'INVALID_TYPE'); held(s, 'expected.maximumAgeMs', 'INVALID_TYPE');
    });

    it('rejects cross-account evidence even when every release binding agrees', () => {
        expect.hasAssertions();
        const s = fixture(); s.observations.accountEvidence.accountId = '22222222-2222-4222-8222-222222222222';
        held(s, 'observations.accountEvidence.accountId', 'MISMATCH');
    });

    it.each([
        ['fenced unknown without fence', { providerOutcome: 'unknown', closureDisposition: 'fenced_unknown', fenceEvidenceDigest: null }],
        ['fence relabeled as success', { providerOutcome: 'success', closureDisposition: 'fenced_unknown', fenceEvidenceDigest: hash('2') }],
        ['unknown relabeled as settled', { providerOutcome: 'unknown', closureDisposition: 'settled', fenceEvidenceDigest: null }],
        ['unresolved marked closure eligible', { providerOutcome: 'unknown', closureDisposition: 'unresolved', fenceEvidenceDigest: null }],
    ])('holds contradictory coaching evidence: %s', (_name, value) => {
        expect.hasAssertions();
        const s = fixture(); s.observations.accountEvidence.coaching = value;
        held(s, 'observations.accountEvidence.coaching', 'MISMATCH');
    });

    it.each(['success', 'failed'])('keeps a known provider outcome %s distinct from fenced unknown', (outcome) => {
        const s = fixture(); s.observations.accountEvidence.coaching = { providerOutcome: outcome, closureDisposition: 'settled', fenceEvidenceDigest: null };
        expect(run(s).contextCandidate.accountEvidence.coaching.providerOutcome).toBe(outcome);
    });

    it.each([7, '07', '-1', '9223372036854775808', null])('refuses noncanonical/overflow generation %j without coercion', (value) => {
        expect.hasAssertions();
        const s = fixture(); s.observations.generation = value; held(s, 'observations.generation', 'INVALID_TYPE');
    });

    it('rejects non-string arguments without invoking getters, toJSON, toString or Proxy traps', () => {
        let called = 0; const bomb = new Proxy({}, { get() { called++; throw new Error('do not read'); }, ownKeys() { called++; throw new Error('do not enumerate'); } });
        const s = fixture();
        expect(assemble(bomb, JSON.stringify(s.observations)).status).toBe('HOLD');
        expect(assemble(JSON.stringify(s.expected), bomb).status).toBe('HOLD');
        expect(called).toBe(0);
        // This test proves the non-string boundary only, not general Proxy safety.
    });

    it.each(['', '{', 'null', '[]', 'true', '"' + 'x'.repeat(262144) + '"', '{"__proto__":{"verified":true}}', '{"n":1e400}'])(
        'holds malformed, oversized or unsafe JSON without returning input data', (value) => {
            const result = assemble(JSON.stringify(fixture().expected), value);
            expect(result.status).toBe('HOLD'); expect(result.contextCandidate).toBeNull();
            expect(result.registrationAuthorized).toBe(false); expect(result.activationAuthorized).toBe(false);
        },
    );

    it('bounds recursive and wide documents before canonical comparison', () => {
        let deep = {}; for (let i = 0; i < 30; i++) deep = { child: deep };
        for (const value of [deep, Array.from({ length: 129 }, () => null)]) {
            expect(assemble(JSON.stringify(fixture().expected), JSON.stringify(value)).missingFields)
                .toContainEqual({ path: 'observations', reason: 'INVALID_TYPE' });
        }
    });
});
