import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    PrivateWorkerNaturalLanguageJourneyError,
    PRIVATE_WORKER_DIMENSION_WER_BOUNDS,
    PRIVATE_WORKER_MEASURED_ONLY_DIMENSIONS,
    PRIVATE_WORKER_MIN_REFERENCE_SEPARATION,
    PRIVATE_WORKER_DIMENSION_EXERCISE,
    PRIVATE_WORKER_PUNCTUATION_ERROR_BOUND,
    fillerRecall,
    provePrivateWorkerNaturalLanguageJourney,
    punctuationErrorRate,
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
    // #1429 — THIS REFERENCE USED TO CARRY NO PUNCTUATION AT ALL. It was
    // `a calm river flows past the old stone bridge` while claiming `punctuation_placement`, and it
    // passed, because the bound is scored with Track-B word error rate whose normalizer strips
    // punctuation before comparing. A transcript with every mark wrong cleared a bound named for
    // punctuation placement, so the dimension was a label the measurement could not see. The contract
    // now refuses that fixture, and this reference actually exercises the dimension it claims.
    { reference: 'The river flows past the bridge. It is calm today. The stone is old.', dimension: 'punctuation_placement' },
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
    // One substitution ("beside" for "past") and one dropped mark, so both scores stay non-trivial:
    // the word bound is exercised and the punctuation rate is a real number rather than a perfect 0.
    'The river flows beside the bridge. It is calm today The stone is old.',
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

    it('CASUALTY: a dimension the reference cannot exercise is REFUSED, not silently cleared', () => {
        /**
         * THE DEFECT THIS CONTRACT SHIPPED WITH. `punctuation_placement` is scored by Track-B word error
         * rate, whose normalizer strips punctuation before comparing — so the bound could be satisfied
         * by a reference containing no punctuation at all, and this very file used to do exactly that
         * with `a calm river flows past the old stone bridge`. A transcript with every mark wrong
         * cleared a bound named for punctuation placement. A green artifact carried the dimension name
         * without ever exercising it, which is worse than declaring nothing, because it reads as proof.
         */
        const mislabelled = fixtures.map((fixture, index) => (index === 1
            ? {
                ...fixture,
                referenceText: 'a calm river flows past the old stone bridge',
                referenceTextSha256: sha256('a calm river flows past the old stone bridge'),
            }
            : fixture));

        expect(() => provePrivateWorkerNaturalLanguageJourney(
            mislabelled,
            withTranscript(1, 'a calm river flows past the old stone bridge'),
        )).toThrow(/declares quality dimension 'punctuation_placement' but its reference does not exercise it/);
    });

    it('CASUALTY: the measured-only filler dimension cannot be claimed by a filler-free reference', () => {
        // The other half of the same defect. `filler_recognition` carries a null bound, so nothing
        // scored it at all — a fixture could drop every filler and still satisfy the lane as long as
        // its remaining words stayed nearer its own reference than any other. The exemption suppresses
        // the BOUND; it must never suppress the requirement that the fixture demonstrate the dimension.
        const fillerFree = 'i think we should review the plan today';
        const mislabelled = fixtures.map((fixture, index) => (index === 2
            ? { ...fixture, referenceText: fillerFree, referenceTextSha256: sha256(fillerFree) }
            : fixture));

        expect(() => provePrivateWorkerNaturalLanguageJourney(mislabelled, withTranscript(2, fillerFree)))
            .toThrow(/declares quality dimension 'filler_recognition' but its reference does not exercise it/);
    });

    it('MEASUREMENT: punctuation is scored by something that can SEE it, and is published unbounded', () => {
        // The scorer is the point: word error rate reports these two as identical, because it removes
        // punctuation before comparing. A dimension named for punctuation needs a measurement that does
        // not, and the two numbers below are what make that concrete.
        const reference = 'The river flows past the bridge. It is calm today. The stone is old.';
        expect(punctuationErrorRate(reference, 'The river flows past the bridge It is calm today The stone is old'),
            'every mark missing is a total failure, not a pass').toBe(1);
        expect(punctuationErrorRate(reference, reference), 'identical punctuation scores zero').toBe(0);
        expect(punctuationErrorRate('no marks at all here', 'no marks at all here'),
            'an unmeasurable dimension reports null, NEVER a flattering zero').toBeNull();

        const proof = provePrivateWorkerNaturalLanguageJourney(fixtures, passingObservations());
        const punctuationRow = proof.results[1];
        expect(punctuationRow.punctuationErrorRate,
            'the punctuation fixture publishes a real measured figure').toBeGreaterThan(0);
        expect(proof.results[0].punctuationErrorRate ?? null,
            'a fixture that does not claim the dimension is not scored for it').toBeNull();
        // Deliberately unbounded until a real-worker distribution exists. Recorded here so that
        // introducing a bound is a visible decision rather than a silent one.
        expect(PRIVATE_WORKER_PUNCTUATION_ERROR_BOUND).toBeNull();
        expect(PRIVATE_WORKER_MEASURED_ONLY_DIMENSIONS.punctuation_placement_marks).toMatch(/blind to punctuation/i);
    });

    it('CASUALTY: punctuation that MOVED is an error, not a perfect score', () => {
        /**
         * My first scorer compared the ORDERED MARK SEQUENCE only, so it was blind to placement — the
         * one thing the dimension is named for. These two strings both reduce to [',', '.', '!'] and
         * scored a perfect 0 with every mark moved; Track-B WER sees identical words, so the journey
         * could publish a flattering punctuation figure for a transcript whose punctuation was
         * entirely wrong. I replaced a metric that could not see punctuation with one that could not
         * see position.
         */
        const reference = 'Hello, world. Next!';
        expect(punctuationErrorRate(reference, 'Hello world, Next.!'),
            'every mark moved is not a perfect score').toBeGreaterThan(0);
        expect(punctuationErrorRate(reference, reference), 'identical placement still scores zero').toBe(0);
        expect(punctuationErrorRate(reference, 'Hello, world. Next?'),
            'a substituted mark in the right place is a smaller, non-zero error').toBeGreaterThan(0);
    });

    it('CASUALTY: filler recognition is scored on the HYPOTHESIS, and is never claimed as proven', () => {
        /**
         * The exercise contract only asked whether the FIXTURE contained a filler. Nothing asked
         * whether the worker returned one, so a recognizer that dropped every `um` produced a green
         * journey publishing `filler_recognition`. Half the hole, reported as closed.
         */
        expect(fillerRecall('so um i think uh we should review', 'so i think we should review'),
            'a worker that dropped every filler scores zero, not null').toBe(0);
        expect(fillerRecall('so um i think uh we should review', 'so um i think uh we should review'),
            'a worker that returned them all scores one').toBe(1);
        expect(fillerRecall('no fillers here at all', 'no fillers here at all'),
            'an unmeasurable dimension reports null, never a flattering zero').toBeNull();

        const proof = provePrivateWorkerNaturalLanguageJourney(fixtures, passingObservations());
        const fillerRow = proof.results[2];
        expect(fillerRow.fillerRecall, 'the measured recall is published').not.toBeUndefined();
        expect(fillerRow.qualityDimensions, 'the dimension is still DECLARED').toContain('filler_recognition');
        expect(fillerRow.provenQualityDimensions,
            'but a green artifact must never claim it was PROVEN').not.toContain('filler_recognition');
        expect(proof.results[0].provenQualityDimensions,
            'a bounded dimension IS claimed as proven').toContain('clean_words');
    });

    it('CASUALTY: a dimension registered without an exercise contract fails CLOSED', () => {
        // A bound added later without a matching exercise entry left `exercise` undefined and skipped
        // fixture validation entirely, so the NEXT dimension anyone added would qualify any reference.
        // Registration without a contract is the error, not a silent exemption.
        const registered = Object.keys(PRIVATE_WORKER_DIMENSION_WER_BOUNDS);
        const contracted = Object.keys(PRIVATE_WORKER_DIMENSION_EXERCISE);
        expect(registered.filter(d => !contracted.includes(d)),
            'every registered dimension defines how a fixture exercises it').toEqual([]);

        // And a prototype key cannot masquerade as a registered dimension.
        const prototypeNamed = fixtures.map((fixture, index) => (index === 0
            ? { ...fixture, qualityDimensions: ['toString'] }
            : fixture));
        expect(() => provePrivateWorkerNaturalLanguageJourney(prototypeNamed, passingObservations()))
            .toThrow(/declares unknown quality dimension 'toString'/);
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
        // 3 substitutions over 14 reference words = 0.214: inside the retired flat 0.5 bound, outside
        // the 0.2 this dimension now carries. The reference gained real punctuation (see fixtureSpecs),
        // so the arithmetic moved with it — the casualty's point is unchanged.
        const observations = withTranscript(1, 'The river runs past the bridge. It is warm today. The stone is new.');

        expect(() => provePrivateWorkerNaturalLanguageJourney(fixtures, observations))
            .toThrow(/fixture 'fixture-2' WER 0\.214 exceeds 0\.200 \(S=3 D=0 I=0 over 14 reference words\)/);
    });

    it('CASUALTY: an invented quality dimension fails closed instead of escaping its bound', () => {
        const renamed = fixtures.map((fixture, index) => index === 1
            ? { ...fixture, qualityDimensions: ['no_bound_please'] }
            : fixture);

        expect(() => provePrivateWorkerNaturalLanguageJourney(renamed, withTranscript(1, 'The river runs past the bridge. It is warm today. The stone is new.')))
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
            const error = failWith(withTranscript(1, 'The river runs past the bridge. It is warm today. The stone is new.'));

            expect(error).toBeInstanceOf(PrivateWorkerNaturalLanguageJourneyError);
            expect(error.diagnostics.map(d => d.fixtureId)).toEqual(['fixture-1', 'fixture-2', 'fixture-3']);
            const failed = error.diagnostics.find(d => d.fixtureId === 'fixture-2')!;
            expect(failed.categories).toEqual(['wer_bound']);
            expect(failed.wer).toBeCloseTo(0.214, 3);
            expect(failed.substitutions).toBe(3);
            expect(failed.referenceWords).toBe(14);
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
            const error = failWith(withTranscript(1, 'The river runs past the bridge. It is warm today. The stone is new.'));

            const serialized = JSON.stringify(error.diagnostics);
            for (const text of [...fixtureSpecs.map(spec => spec.reference), ...transcripts]) {
                expect(serialized).not.toContain(text);
            }
        });
    });
});
