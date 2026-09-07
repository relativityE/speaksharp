import { createHash } from 'node:crypto';
import { wordErrorRate } from './werMetric';

export const PRIVATE_WORKER_NATURAL_LANGUAGE_TRACK = 'track_b' as const;
export const PRIVATE_WORKER_MAX_FIXTURE_WER = 0.5;
export const PRIVATE_WORKER_MIN_FIXTURE_WORDS = 5;

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
    referenceWords: number;
    hypothesisWords: number;
    substitutions: number;
    deletions: number;
    insertions: number;
    wer: number;
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
    maximumAllowedWer: number;
    averageWer: number;
    maximumWer: number;
    results: SanitizedPrivateWorkerFixtureResult[];
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

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
 * constant passes that check. This contract requires every pinned natural-language
 * fixture to produce a bounded-error transcript and independently binds the exact
 * Float32 PCM tuple observed on the page to the tuple hashed inside the worker.
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
        const score = wordErrorRate(fixture.referenceText, transcript, {
            track: PRIVATE_WORKER_NATURAL_LANGUAGE_TRACK,
        });
        if (score.wer === null) {
            problems.push(`fixture '${fixture.fixtureId}' has no measurable reference`);
            continue;
        }
        if (score.wer > PRIVATE_WORKER_MAX_FIXTURE_WER) {
            problems.push(
                `fixture '${fixture.fixtureId}' WER ${score.wer.toFixed(3)} exceeds ${PRIVATE_WORKER_MAX_FIXTURE_WER.toFixed(3)}`,
            );
        }

        const hypothesisWords = transcript.split(/\s+/).filter(Boolean).length;
        results.push({
            fixtureId: fixture.fixtureId,
            fixtureSha256: fixture.fixtureSha256,
            referenceTextSha256: fixture.referenceTextSha256,
            transcriptSha256: sha256(transcript),
            referenceWords: score.referenceWords,
            hypothesisWords,
            substitutions: score.substitutions,
            deletions: score.deletions,
            insertions: score.insertions,
            wer: score.wer,
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
        maximumAllowedWer: PRIVATE_WORKER_MAX_FIXTURE_WER,
        averageWer: wers.reduce((total, wer) => total + wer, 0) / wers.length,
        maximumWer: Math.max(...wers),
        results,
    };
}
