import { describe, expect, it } from 'vitest';
import { CANDIDATES, identityOf } from '../../transcription/candidateRegistry';
import { attributionFromEngine, isAttributable } from '../candidateAttribution';

/** What PrivateSTT.getMetadata() returns for a run that actually resolved a candidate. */
const engineReporting = (id: keyof typeof CANDIDATES) => ({
    candidateId: id, modelIdentity: identityOf(CANDIDATES[id]),
});

describe('attribution records what RAN, not what was requested', () => {
    it('CASUALTY: an int8 session is attributed to int8, never to q4', () => {
        // The bug that already happened once, in getMetadata(): the model was read from a DEFAULT
        // constant, so an int8 session was recorded as q4. Repeating it in telemetry would make the
        // ear test wrong in exactly the comparison it exists to settle.
        const a = attributionFromEngine(engineReporting('v4:base:int8'));
        expect(a.candidate_id).toBe('v4:base:int8');
        expect(a.candidate_id).not.toBe('v4:base:q4');
        expect(a.asset_digest).toBe(CANDIDATES['v4:base:int8'].assets.pinDigest);
        expect(a.asset_digest).not.toBe(CANDIDATES['v4:base:q4'].assets.pinDigest);
    });

    it('CASUALTY: the source is the ENGINE, so a config intention cannot supply the id', () => {
        // Passing an engine that resolved nothing must not produce an id, no matter what was
        // configured — the config states an intention; only the engine knows what it initialised.
        expect(attributionFromEngine({}).candidate_id).toBeNull();
        expect(attributionFromEngine(null).candidate_id).toBeNull();
        expect(attributionFromEngine(undefined).candidate_id).toBeNull();
    });

    it('each of the three human-test candidates is distinctly attributable', () => {
        const ids = ['v2:base.en', 'v4:base:int8', 'moonshine:streaming-medium'] as const;
        const seen = ids.map((id) => attributionFromEngine(engineReporting(id)));
        for (const [i, a] of seen.entries()) {
            expect(a.candidate_id).toBe(ids[i]);
            expect(isAttributable(a)).toBe(true);
        }
        // Distinct digests, so two sessions cannot be confused by their asset identity.
        expect(new Set(seen.map((a) => a.asset_digest)).size).toBe(3);
        expect(new Set(seen.map((a) => a.runtime_version)).size).toBeGreaterThan(1);
    });

    it('CASUALTY: an unresolved session is reported UNATTRIBUTABLE rather than guessed', () => {
        // A null says "this session cannot be attributed". A guessed value would assert that a model
        // produced a transcript it may not have produced, which is worse than an absent field.
        const a = attributionFromEngine({});
        expect(isAttributable(a)).toBe(false);
        expect(a).toEqual({ candidate_id: null, engine: null, runtime_version: null, asset_digest: null });
    });

    it('a partially-identified engine is still not attributable', () => {
        const a = attributionFromEngine({ candidateId: 'v2:base.en', modelIdentity: {} });
        expect(a.candidate_id).toBe('v2:base.en');
        expect(isAttributable(a)).toBe(false);   // runtime_version missing
    });
});
