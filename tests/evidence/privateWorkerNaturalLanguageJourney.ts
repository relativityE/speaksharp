import { createHash } from 'node:crypto';
import { wordErrorRate } from './werMetric';

export const PRIVATE_WORKER_NATURAL_LANGUAGE_TRACK = 'track_b' as const;
export const PRIVATE_WORKER_MIN_FIXTURE_WORDS = 5;

/**
 * Per-dimension WER acceptance, keyed by the manifest's `qualityDimensions`.
 *
 * A single flat bound across every fixture asserted an accuracy claim the controlled
 * corpus cannot support for all of its dimensions. Bounds are therefore declared per
 * dimension, and a dimension may be declared MEASURED-ONLY (`null`) when the corpus
 * cannot honestly carry that dimension — never to make a red run green.
 *
 * A dimension absent from this table is a failure, not an escape hatch: a bound must
 * not be dodged by inventing a dimension name in the manifest.
 */
export const PRIVATE_WORKER_DIMENSION_WER_BOUNDS: Readonly<Record<string, number | null>> = Object.freeze({
    clean_words: 0.2,
    punctuation_placement: 0.2,
    filler_recognition: null,
});

/**
 * Why a dimension is measured but not bounded here. Required for every `null` bound so
 * the exemption is argued on the record rather than assumed.
 */
export const PRIVATE_WORKER_MEASURED_ONLY_DIMENSIONS: Readonly<Record<string, string>> = Object.freeze({
    filler_recognition:
        'The controlled corpus is synthesized speech. Its "um"/"uh" are the synthesizer pronouncing the '
        + 'spelling of a filler, not the acoustics of human disfluency, so a recognition bound scored on them '
        + 'measures the synthesizer rather than the recognizer. Measured and published here; human disfluency '
        + 'recognition is owed by the real-microphone corpus and is not closed by this lane.',
});

/**
 * Every transcript must be measurably closer to its own reference than to any other
 * fixture's reference. This is the anti-stub and anti-misroute proof, and unlike an
 * absolute accuracy bound it does not depend on how strong the model is.
 */
export const PRIVATE_WORKER_MIN_REFERENCE_SEPARATION = 0.1;

const SHA256_RE = /^[0-9a-f]{64}$/i;

export interface NaturalLanguageFixtureContract {
    fixtureId: string;
    fixtureSha256: string;
    referenceText: string;
    referenceTextSha256: string;
    qualityDimensions: string[];
}

export interface PrivateWorkerInputTuple {
    sha256: string;
    samples: number;
    bytes: number;
    durationSeconds: number;
}

export interface PrivateWorkerNaturalLanguageObservation {
    fixtureId: string;
    transcript: string;
    mainThreadInput: PrivateWorkerInputTuple;
    workerInput: PrivateWorkerInputTuple;
}

export interface SanitizedPrivateWorkerFixtureResult {
    fixtureId: string;
    fixtureSha256: string;
    referenceTextSha256: string;
    transcriptSha256: string;
    qualityDimensions: string[];
    /** Tightest declared bound across this fixture's dimensions; null = measured only. */
    appliedWerBound: number | null;
    referenceWords: number;
    hypothesisWords: number;
    substitutions: number;
    deletions: number;
    insertions: number;
    wer: number;
    /** Lowest WER this transcript scores against any OTHER fixture's reference. */
    nearestOtherReferenceWer: number;
    /** nearestOtherReferenceWer - wer. Must clear PRIVATE_WORKER_MIN_REFERENCE_SEPARATION. */
    referenceSeparation: number;
    normalizationVersion: string;
    inputSha256: string;
    inputSamples: number;
    inputBytes: number;
    inputDurationSeconds: number;
    inputHashesMatch: true;
}

export interface PrivateWorkerNaturalLanguageJourneyProof {
    fixtureCount: number;
    track: typeof PRIVATE_WORKER_NATURAL_LANGUAGE_TRACK;
    boundedFixtureCount: number;
    measuredOnlyFixtureCount: number;
    minimumReferenceSeparation: number;
    observedMinimumReferenceSeparation: number;
    averageWer: number;
    maximumWer: number;
    results: SanitizedPrivateWorkerFixtureResult[];
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Tightest bound across the declared dimensions; null when every dimension is measured-only. */
function resolveBound(fixture: NaturalLanguageFixtureContract): { bound: number | null; problems: string[] } {
    const problems: string[] = [];
    let bound: number | null = null;
    for (const dimension of fixture.qualityDimensions) {
        if (!(dimension in PRIVATE_WORKER_DIMENSION_WER_BOUNDS)) {
            problems.push(`fixture '${fixture.fixtureId}' declares unknown quality dimension '${dimension}'`);
            continue;
        }
        const declared = PRIVATE_WORKER_DIMENSION_WER_BOUNDS[dimension];
        if (declared === null) {
            if (!PRIVATE_WORKER_MEASURED_ONLY_DIMENSIONS[dimension]) {
                problems.push(`quality dimension '${dimension}' is unbounded without a recorded reason`);
            }
            continue;
        }
        bound = bound === null ? declared : Math.min(bound, declared);
    }
    return { bound, problems };
}

function tupleProblems(label: string, tuple: PrivateWorkerInputTuple): string[] {
    const problems: string[] = [];
    if (!SHA256_RE.test(tuple.sha256)) problems.push(`${label} PCM hash is not SHA-256`);
    if (!Number.isInteger(tuple.samples) || tuple.samples <= 0) problems.push(`${label} PCM sample count is not positive`);
    if (!Number.isInteger(tuple.bytes) || tuple.bytes <= 0) problems.push(`${label} PCM byte count is not positive`);
    if (!Number.isFinite(tuple.durationSeconds) || tuple.durationSeconds <= 0) problems.push(`${label} PCM duration is not positive`);
    if (tuple.bytes !== tuple.samples * Float32Array.BYTES_PER_ELEMENT) {
        problems.push(`${label} PCM byte count does not equal Float32 sample count`);
    }
    if (Math.abs(tuple.durationSeconds - tuple.samples / 16_000) > 1e-6) {
        problems.push(`${label} PCM duration does not equal samples / 16000`);
    }
    return problems;
}

/**
 * Executable contract for the production-shaped Private-v2 diagnostic.
 *
 * A non-empty string is not speech-recognition proof: a worker stub returning a
 * constant passes that check. Three independent properties are required of every
 * pinned fixture:
 *
 *   1. PCM identity — the exact Float32 tuple observed on the page equals the tuple
 *      hashed inside the worker that owns the model.
 *   2. Reference correlation — the transcript scores measurably closer to its OWN
 *      reference than to any other fixture's. A constant stub, a per-call constant,
 *      and a mis-routed fixture all fail this regardless of model strength.
 *   3. Accuracy — WER within the bound declared for the fixture's quality dimensions,
 *      where the corpus can honestly carry that dimension.
 *
 * The returned object contains hashes and measurements only, never transcript text.
 */
export function provePrivateWorkerNaturalLanguageJourney(
    fixtures: readonly NaturalLanguageFixtureContract[],
    observations: readonly PrivateWorkerNaturalLanguageObservation[],
): PrivateWorkerNaturalLanguageJourneyProof {
    const problems: string[] = [];
    if (fixtures.length < 2) problems.push('natural-language journey requires at least two fixtures');

    const fixtureIds = new Set<string>();
    const referenceHashes = new Set<string>();
    for (const fixture of fixtures) {
        if (!fixture.fixtureId.trim()) problems.push('fixture has no fixtureId');
        if (fixtureIds.has(fixture.fixtureId)) problems.push(`fixture '${fixture.fixtureId}' is duplicated`);
        fixtureIds.add(fixture.fixtureId);
        if (!SHA256_RE.test(fixture.fixtureSha256)) problems.push(`fixture '${fixture.fixtureId}' audio hash is not SHA-256`);
        if (!SHA256_RE.test(fixture.referenceTextSha256) || sha256(fixture.referenceText) !== fixture.referenceTextSha256) {
            problems.push(`fixture '${fixture.fixtureId}' reference text does not match its pinned SHA-256`);
        }
        const referenceWords = fixture.referenceText.trim().split(/\s+/).filter(Boolean).length;
        if (referenceWords < PRIVATE_WORKER_MIN_FIXTURE_WORDS) {
            problems.push(`fixture '${fixture.fixtureId}' has fewer than ${PRIVATE_WORKER_MIN_FIXTURE_WORDS} natural-language words`);
        }
        if (fixture.qualityDimensions.length === 0) problems.push(`fixture '${fixture.fixtureId}' has no quality dimension`);
        if (referenceHashes.has(fixture.referenceTextSha256)) problems.push(`fixture '${fixture.fixtureId}' repeats another reference text`);
        referenceHashes.add(fixture.referenceTextSha256);
    }

    const observationsByFixture = new Map<string, PrivateWorkerNaturalLanguageObservation>();
    for (const observation of observations) {
        if (!fixtureIds.has(observation.fixtureId)) problems.push(`unexpected observation '${observation.fixtureId}'`);
        if (observationsByFixture.has(observation.fixtureId)) problems.push(`observation '${observation.fixtureId}' is duplicated`);
        observationsByFixture.set(observation.fixtureId, observation);
    }

    const seenTranscripts = new Map<string, string>();
    const results: SanitizedPrivateWorkerFixtureResult[] = [];
    for (const fixture of fixtures) {
        const observation = observationsByFixture.get(fixture.fixtureId);
        if (!observation) {
            problems.push(`fixture '${fixture.fixtureId}' did not cross the worker journey`);
            continue;
        }

        problems.push(...tupleProblems(`${fixture.fixtureId} main-thread`, observation.mainThreadInput));
        problems.push(...tupleProblems(`${fixture.fixtureId} worker`, observation.workerInput));
        if (
            observation.mainThreadInput.sha256 !== observation.workerInput.sha256 ||
            observation.mainThreadInput.samples !== observation.workerInput.samples ||
            observation.mainThreadInput.bytes !== observation.workerInput.bytes ||
            Math.abs(observation.mainThreadInput.durationSeconds - observation.workerInput.durationSeconds) > 1e-6
        ) {
            problems.push(`fixture '${fixture.fixtureId}' main-thread and worker PCM tuples differ`);
        }

        const transcript = observation.transcript.trim();
        if (!transcript) {
            problems.push(`fixture '${fixture.fixtureId}' produced no transcript`);
            continue;
        }
        const transcriptHash = sha256(transcript);
        const twin = seenTranscripts.get(transcriptHash);
        if (twin) {
            problems.push(`fixture '${fixture.fixtureId}' returned the same transcript as '${twin}'`);
        }
        seenTranscripts.set(transcriptHash, fixture.fixtureId);

        const score = wordErrorRate(fixture.referenceText, transcript, {
            track: PRIVATE_WORKER_NATURAL_LANGUAGE_TRACK,
        });
        if (score.wer === null) {
            problems.push(`fixture '${fixture.fixtureId}' has no measurable reference`);
            continue;
        }

        const { bound, problems: boundProblems } = resolveBound(fixture);
        problems.push(...boundProblems);
        if (bound !== null && score.wer > bound) {
            problems.push(
                `fixture '${fixture.fixtureId}' WER ${score.wer.toFixed(3)} exceeds ${bound.toFixed(3)} `
                + `(S=${score.substitutions} D=${score.deletions} I=${score.insertions} over ${score.referenceWords} reference words)`,
            );
        }

        const otherWers = fixtures
            .filter(other => other.fixtureId !== fixture.fixtureId)
            .map(other => wordErrorRate(other.referenceText, transcript, {
                track: PRIVATE_WORKER_NATURAL_LANGUAGE_TRACK,
            }).wer)
            .filter((wer): wer is number => wer !== null);
        const nearestOtherReferenceWer = otherWers.length > 0 ? Math.min(...otherWers) : Number.POSITIVE_INFINITY;
        const referenceSeparation = nearestOtherReferenceWer - score.wer;
        if (referenceSeparation < PRIVATE_WORKER_MIN_REFERENCE_SEPARATION) {
            problems.push(
                `fixture '${fixture.fixtureId}' transcript is not measurably bound to its own reference: `
                + `own WER ${score.wer.toFixed(3)} vs nearest other reference ${nearestOtherReferenceWer.toFixed(3)} `
                + `(separation ${referenceSeparation.toFixed(3)} < ${PRIVATE_WORKER_MIN_REFERENCE_SEPARATION.toFixed(3)})`,
            );
        }

        const hypothesisWords = transcript.split(/\s+/).filter(Boolean).length;
        results.push({
            fixtureId: fixture.fixtureId,
            fixtureSha256: fixture.fixtureSha256,
            referenceTextSha256: fixture.referenceTextSha256,
            transcriptSha256: transcriptHash,
            qualityDimensions: [...fixture.qualityDimensions],
            appliedWerBound: bound,
            referenceWords: score.referenceWords,
            hypothesisWords,
            substitutions: score.substitutions,
            deletions: score.deletions,
            insertions: score.insertions,
            wer: score.wer,
            nearestOtherReferenceWer,
            referenceSeparation,
            normalizationVersion: score.normalizationVersion,
            inputSha256: observation.workerInput.sha256,
            inputSamples: observation.workerInput.samples,
            inputBytes: observation.workerInput.bytes,
            inputDurationSeconds: observation.workerInput.durationSeconds,
            inputHashesMatch: true,
        });
    }

    if (observations.length !== fixtures.length) {
        problems.push(`observed ${observations.length} worker journeys for ${fixtures.length} fixtures`);
    }
    if (problems.length > 0) throw new Error(problems.join('; '));

    const wers = results.map(result => result.wer);
    return {
        fixtureCount: results.length,
        track: PRIVATE_WORKER_NATURAL_LANGUAGE_TRACK,
        boundedFixtureCount: results.filter(result => result.appliedWerBound !== null).length,
        measuredOnlyFixtureCount: results.filter(result => result.appliedWerBound === null).length,
        minimumReferenceSeparation: PRIVATE_WORKER_MIN_REFERENCE_SEPARATION,
        observedMinimumReferenceSeparation: Math.min(...results.map(result => result.referenceSeparation)),
        averageWer: wers.reduce((total, wer) => total + wer, 0) / wers.length,
        maximumWer: Math.max(...wers),
        results,
    };
}
