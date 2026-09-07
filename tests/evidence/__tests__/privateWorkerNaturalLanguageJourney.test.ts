import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    PRIVATE_WORKER_MAX_FIXTURE_WER,
    provePrivateWorkerNaturalLanguageJourney,
    type NaturalLanguageFixtureContract,
    type PrivateWorkerNaturalLanguageObservation,
} from '../privateWorkerNaturalLanguageJourney';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const references = [
    'the meeting starts at nine please arrive early',
    'a calm river flows past the old stone bridge',
] as const;

const fixtures: NaturalLanguageFixtureContract[] = references.map((referenceText, index) => ({
    fixtureId: `fixture-${index + 1}`,
    fixtureSha256: String(index + 1).repeat(64),
    referenceText,
    referenceTextSha256: sha256(referenceText),
    qualityDimensions: ['clean_words'],
}));

function observation(
    fixtureId: string,
    transcript: string,
    hash: string,
): PrivateWorkerNaturalLanguageObservation {
    const samples = 16_000;
    const tuple = { sha256: hash, samples, bytes: samples * 4, durationSeconds: 1 };
    return {
        fixtureId,
        transcript,
        mainThreadInput: { ...tuple },
        workerInput: { ...tuple },
    };
}

const passingObservations = (): PrivateWorkerNaturalLanguageObservation[] => [
    observation('fixture-1', references[0], 'a'.repeat(64)),
    observation('fixture-2', 'a calm river flows by the old stone bridge', 'b'.repeat(64)),
];

describe('Private-v2 natural-language worker journey contract', () => {
    it('returns sanitized measurements only after every fixture crosses the worker boundary', () => {
        const proof = provePrivateWorkerNaturalLanguageJourney(fixtures, passingObservations());

        expect(proof.fixtureCount).toBe(2);
        expect(proof.track).toBe('track_b');
        expect(proof.maximumAllowedWer).toBe(PRIVATE_WORKER_MAX_FIXTURE_WER);
        expect(proof.maximumWer).toBeLessThanOrEqual(PRIVATE_WORKER_MAX_FIXTURE_WER);
        expect(proof.results.map(result => result.inputHashesMatch)).toEqual([true, true]);
        expect(proof.results.map(result => result.fixtureId)).toEqual(['fixture-1', 'fixture-2']);
        expect(JSON.stringify(proof)).not.toContain(references[0]);
        expect(JSON.stringify(proof)).not.toContain(references[1]);
    });

    it('CASUALTY: rejects the constant non-empty worker stub that the old smoke accepted', () => {
        const observations = passingObservations().map(item => ({ ...item, transcript: 'worker transcript' }));

        expect(() => provePrivateWorkerNaturalLanguageJourney(fixtures, observations))
            .toThrow(/WER .* exceeds/);
    });

    it('CASUALTY: rejects a stale worker hash even when both transcripts are accurate', () => {
        const observations = passingObservations();
        observations[1] = {
            ...observations[1],
            workerInput: { ...observations[1].workerInput, sha256: observations[0].workerInput.sha256 },
        };

        expect(() => provePrivateWorkerNaturalLanguageJourney(fixtures, observations))
            .toThrow(/main-thread and worker PCM tuples differ/);
    });

    it('CASUALTY: rejects a run that silently exercises only the first fixture', () => {
        expect(() => provePrivateWorkerNaturalLanguageJourney(fixtures, passingObservations().slice(0, 1)))
            .toThrow(/fixture 'fixture-2' did not cross the worker journey/);
    });

    it('rejects unpinned or token-sized text masquerading as a natural-language fixture', () => {
        const invalidFixtures = fixtures.map((fixture, index) => index === 0
            ? { ...fixture, referenceText: 'beep', referenceTextSha256: sha256('different') }
            : fixture);

        expect(() => provePrivateWorkerNaturalLanguageJourney(invalidFixtures, passingObservations()))
            .toThrow(/reference text does not match|fewer than/);
    });
});
