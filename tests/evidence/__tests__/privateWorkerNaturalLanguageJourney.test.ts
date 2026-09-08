import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    PrivateWorkerNaturalLanguageJourneyError,
    PRIVATE_WORKER_DIMENSION_WER_BOUNDS,
    PRIVATE_WORKER_MEASURED_ONLY_DIMENSIONS,
    PRIVATE_WORKER_MIN_REFERENCE_SEPARATION,
    provePrivateWorkerNaturalLanguageJourney,
    type NaturalLanguageFixtureContract,
    type PrivateWorkerNaturalLanguageObservation,
} from '../privateWorkerNaturalLanguageJourney';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * Shaped after the pinned corpus: two dimensions the synthesized corpus can carry, and
 * one (`filler_recognition`) it cannot. `fixture-3`'s transcript is the one the real
 * production worker actually returned for the pinned filler fixture — WER 0.583 under
 * `track_b`, which is why a flat 0.5 bound turned this lane red.
 */
const fixtureSpecs = [
    { reference: 'the meeting starts at nine please arrive early', dimension: 'clean_words' },
    { reference: 'a calm river flows past the old stone bridge', dimension: 'punctuation_placement' },
    { reference: 'so um i think uh we should um review the plan today', dimension: 'filler_recognition' },
] as const;

const fixtures: NaturalLanguageFixtureContract[] = fixtureSpecs.map((spec, index) => ({
    fixtureId: `fixture-${index + 1}`,
    fixtureSha256: String(index + 1).repeat(64),
    referenceText: spec.reference,
    referenceTextSha256: sha256(spec.reference),
    qualityDimensions: [spec.dimension],
}));

const transcripts = [
    'the meeting starts at nine please arrive early',
    'a calm river flows by the old stone bridge',
    'so i am i think i wish you a review of the plan today',
] as const;

function observation(index: number, transcript: string): PrivateWorkerNaturalLanguageObservation {
    const samples = 16_000 * (index + 1);
    const tuple = {
        sha256: String.fromCharCode(97 + index).repeat(64),
        samples,
        bytes: samples * 4,
        durationSeconds: samples / 16_000,
    };
    return {
        fixtureId: `fixture-${index + 1}`,
        transcript,
        mainThreadInput: { ...tuple },
        workerInput: { ...tuple },
    };
}

const passingObservations = (): PrivateWorkerNaturalLanguageObservation[] =>
    transcripts.map((transcript, index) => observation(index, transcript));

const withTranscript = (index: number, transcript: string): PrivateWorkerNaturalLanguageObservation[] => {
    const observations = passingObservations();
    observations[index] = { ...observations[index], transcript };
    return observations;
};

describe('Private-v2 natural-language worker journey contract', () => {
    it('returns sanitized measurements only after every fixture crosses the worker boundary', () => {
        const proof = provePrivateWorkerNaturalLanguageJourney(fixtures, passingObservations());

        expect(proof.fixtureCount).toBe(3);
        expect(proof.track).toBe('track_b');
        expect(proof.results.map(result => result.fixtureId)).toEqual(['fixture-1', 'fixture-2', 'fixture-3']);
        expect(proof.results.map(result => result.inputHashesMatch)).toEqual([true, true, true]);
        for (const text of [...fixtureSpecs.map(spec => spec.reference), ...transcripts]) {
            expect(JSON.stringify(proof)).not.toContain(text);
        }
    });

    it('binds each fixture to the bound its declared quality dimension can honestly carry', () => {
        const proof = provePrivateWorkerNaturalLanguageJourney(fixtures, passingObservations());

        expect(proof.results.map(result => result.appliedWerBound)).toEqual([
            PRIVATE_WORKER_DIMENSION_WER_BOUNDS.clean_words,
            PRIVATE_WORKER_DIMENSION_WER_BOUNDS.punctuation_placement,
            null,
        ]);
        expect(proof.boundedFixtureCount).toBe(2);
        expect(proof.measuredOnlyFixtureCount).toBe(1);
        // The filler fixture is still MEASURED — the exemption suppresses the bound, never the number.
        expect(proof.results[2].wer).toBeCloseTo(0.583, 3);
        expect(PRIVATE_WORKER_MEASURED_ONLY_DIMENSIONS.filler_recognition).toMatch(/synthes/i);
    });

    it('CASUALTY: the measured-only exemption is not a hole — an unrelated transcript still fails', () => {
        // Under a naive "drop the bound for filler_recognition" fix this passes: the
        // transcript is non-empty, distinct, and no accuracy bound applies to it.
        const observations = withTranscript(2, 'zebra lantern orbit pancake velvet thunder marble');

        expect(() => provePrivateWorkerNaturalLanguageJourney(fixtures, observations))
            .toThrow(/fixture 'fixture-3' transcript is not measurably bound to its own reference/);
    });

    it('CASUALTY: rejects the constant non-empty worker stub that the old smoke accepted', () => {
        const observations = passingObservations().map(item => ({ ...item, transcript: 'worker transcript ready' }));

        expect(() => provePrivateWorkerNaturalLanguageJourney(fixtures, observations))
            .toThrow(/returned the same transcript as 'fixture-1'/);
    });

    it('CASUALTY: rejects a stub that varies its constant per call, defeating distinctness alone', () => {
        const observations = passingObservations().map((item, index) => ({
            ...item,
            transcript: `worker transcript number ${index + 1} ready`,
        }));

        expect(() => provePrivateWorkerNaturalLanguageJourney(fixtures, observations))
            .toThrow(/is not measurably bound to its own reference/);
    });

    it('CASUALTY: rejects mis-routed audio even though every transcript is a real recognition', () => {
        const observations = passingObservations();
        const first = observations[0].transcript;
        observations[0] = { ...observations[0], transcript: observations[1].transcript };
        observations[1] = { ...observations[1], transcript: first };

        expect(() => provePrivateWorkerNaturalLanguageJourney(fixtures, observations))
            .toThrow(/fixture 'fixture-1' transcript is not measurably bound to its own reference/);
    });

    it('CASUALTY: the tightened bound bites where the old flat 0.5 bound did not', () => {
        // 3 substitutions over 9 reference words = 0.333: inside the retired flat bound.
        const observations = withTranscript(1, 'a calm river runs by the new stone bridge');

        expect(() => provePrivateWorkerNaturalLanguageJourney(fixtures, observations))
            .toThrow(/fixture 'fixture-2' WER 0\.333 exceeds 0\.200 \(S=3 D=0 I=0 over 9 reference words\)/);
    });

    it('CASUALTY: an invented quality dimension fails closed instead of escaping its bound', () => {
        const renamed = fixtures.map((fixture, index) => index === 1
            ? { ...fixture, qualityDimensions: ['no_bound_please'] }
            : fixture);

        expect(() => provePrivateWorkerNaturalLanguageJourney(renamed, withTranscript(1, 'a calm river runs by the new stone bridge')))
            .toThrow(/fixture 'fixture-2' declares unknown quality dimension 'no_bound_please'/);
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

    it('publishes the separation each transcript actually cleared', () => {
        const proof = provePrivateWorkerNaturalLanguageJourney(fixtures, passingObservations());

        expect(proof.minimumReferenceSeparation).toBe(PRIVATE_WORKER_MIN_REFERENCE_SEPARATION);
        expect(proof.observedMinimumReferenceSeparation).toBeGreaterThanOrEqual(PRIVATE_WORKER_MIN_REFERENCE_SEPARATION);
        for (const result of proof.results) {
            expect(result.nearestOtherReferenceWer).toBeGreaterThan(result.wer);
        }
    });

    describe('a red run is diagnosable from the run itself', () => {
        const failWith = (observations: PrivateWorkerNaturalLanguageObservation[]): PrivateWorkerNaturalLanguageJourneyError => {
            try {
                provePrivateWorkerNaturalLanguageJourney(fixtures, observations);
            } catch (error) {
                return error as PrivateWorkerNaturalLanguageJourneyError;
            }
            throw new Error('expected the journey to fail');
        };

        it('CASUALTY: the per-fixture record SURVIVES the aggregate throw', () => {
            const error = failWith(withTranscript(1, 'a calm river runs by the new stone bridge'));

            expect(error).toBeInstanceOf(PrivateWorkerNaturalLanguageJourneyError);
            expect(error.diagnostics.map(d => d.fixtureId)).toEqual(['fixture-1', 'fixture-2', 'fixture-3']);
            const failed = error.diagnostics.find(d => d.fixtureId === 'fixture-2')!;
            expect(failed.categories).toEqual(['wer_bound']);
            expect(failed.wer).toBeCloseTo(0.333, 3);
            expect(failed.substitutions).toBe(3);
            expect(failed.referenceWords).toBe(9);
            expect(failed.appliedWerBound).toBe(0.2);
            expect(failed.transcriptSha256).toMatch(/^[0-9a-f]{64}$/);
            expect(failed.inputHashesMatch).toBe(true);
        });

        it('CASUALTY: a fixture that never produced a transcript still reports its PCM tuple', () => {
            const error = failWith(withTranscript(2, '   '));

            const silent = error.diagnostics.find(d => d.fixtureId === 'fixture-3')!;
            expect(silent.categories).toEqual(['transcript_missing']);
            expect(silent.wer).toBeNull();
            // The tuple is the evidence that distinguishes "worker never received audio" from
            // "worker received audio and returned nothing" — it must not be lost with the throw.
            expect(silent.workerInput).toMatchObject({ samples: 48_000, bytes: 192_000 });
            expect(silent.inputHashesMatch).toBe(true);
        });

        it('names the mismatch category for a PCM tuple divergence', () => {
            const observations = passingObservations();
            observations[1] = {
                ...observations[1],
                workerInput: { ...observations[1].workerInput, sha256: observations[0].workerInput.sha256 },
            };

            const error = failWith(observations);

            expect(error.problems.map(problem => problem.category)).toContain('pcm_tuple');
            const mismatched = error.diagnostics.find(d => d.fixtureId === 'fixture-2')!;
            expect(mismatched.inputHashesMatch).toBe(false);
            expect(mismatched.mainThreadInput?.sha256).not.toBe(mismatched.workerInput?.sha256);
        });

        it('CASUALTY: no reference or transcript text is carried in the preserved record', () => {
            const error = failWith(withTranscript(1, 'a calm river runs by the new stone bridge'));

            const serialized = JSON.stringify(error.diagnostics);
            for (const text of [...fixtureSpecs.map(spec => spec.reference), ...transcripts]) {
                expect(serialized).not.toContain(text);
            }
        });
    });
});
