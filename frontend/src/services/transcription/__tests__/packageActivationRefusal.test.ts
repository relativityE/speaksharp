/**
 * #1760 Increment A, finding B: an `approvedPackages` row must not activate an imported package.
 *
 * The earlier selector admitted a package as the production default when the config named its digest with ANY
 * syntactically valid 64-hex evidenceSha256: nothing bound that hash to a completed evaluation. Until the
 * model-decision increment binds adoption to authoritative evidence, a package is production-eligible only through
 * the registry's activationReady, like every other candidate. The registry is extended with one package candidate;
 * the selector under test is the real one.
 */
import { describe, expect, it, vi } from 'vitest';

const { PACKAGE_ID, DIGEST } = vi.hoisted(() => ({ PACKAGE_ID: 'fixture:approved-row-package', DIGEST: 'd'.repeat(64) }));
vi.mock('../candidateRegistry', async (original) => {
    const actual = await original<typeof import('../candidateRegistry')>();
    const base = actual.CANDIDATES['v2:base.en'];
    const imported = { ...base, id: PACKAGE_ID, activationReady: false, comparisonReady: false,
        notReadyReason: 'Imported package requires product qualification and explicit activation admission',
        modelPackage: { descriptor: {} as never, sourcePath: 'fixture.json', digest: DIGEST } };
    const CANDIDATES = { ...actual.CANDIDATES, [PACKAGE_ID]: imported };
    return { ...actual, CANDIDATES, CANDIDATE_IDS: Object.keys(CANDIDATES) };
});

import { activeCandidate, InactiveCandidateError, type PrivateSttConfig } from '../candidateSelection';

const productionBuild = { VITE_INTERNAL_BUILD: 'false' };

describe('an approval row is not an activation path', () => {
    it('refuses a package named with a matching digest and a well-formed but unbound evidence hash', () => {
        const config: PrivateSttConfig = { candidate: PACKAGE_ID,
            approvedPackages: [{ packageDigest: DIGEST, evidenceSha256: 'e'.repeat(64) }] };
        expect(() => activeCandidate(config, productionBuild)).toThrow(InactiveCandidateError);
    });
    it('still runs the same package for internal comparison only with the explicit acknowledgement on an internal build', () => {
        const config: PrivateSttConfig = { candidate: PACKAGE_ID, acknowledgeNotProductionReady: true };
        expect(activeCandidate(config, { VITE_INTERNAL_BUILD: 'true' }).id).toBe(PACKAGE_ID);
        expect(() => activeCandidate(config, productionBuild)).toThrow(InactiveCandidateError);
    });
    it('leaves the incumbent the production default', () => {
        expect(activeCandidate({ candidate: 'v2:base.en' }, productionBuild).id).toBe('v2:base.en');
    });
});
