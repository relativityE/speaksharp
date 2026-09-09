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
 * A DIMENSION MUST BE EXERCISED BY THE FIXTURE THAT CLAIMS IT.
 *
 * The WER bounds above are scored with Track-B word error rate, whose normalizer strips punctuation
 * and is blind to whether a filler was recognised. Without this table a fixture could declare
 * `punctuation_placement` over a reference containing no punctuation at all — and the contract test
 * did exactly that, with `a calm river flows past the old stone bridge` — so a transcript with every
 * punctuation mark wrong cleared a bound named for punctuation. The dimension name became a label
 * the measurement could not see, which is worse than declaring no dimension: it reads as proof.
 *
 * Each predicate answers one question about the REFERENCE only: can this fixture exercise the thing
 * it claims? A fixture that cannot is a contract failure, never a pass.
 */
export const PRIVATE_WORKER_DIMENSION_EXERCISE:
    Readonly<Record<string, { requirement: string; exercises: (referenceText: string) => boolean }>> = Object.freeze({
        clean_words: {
            requirement: `at least ${PRIVATE_WORKER_MIN_FIXTURE_WORDS} reference words`,
            exercises: (reference) => reference.split(/\s+/).filter(Boolean).length >= PRIVATE_WORKER_MIN_FIXTURE_WORDS,
        },
        punctuation_placement: {
            // Two marks, so the dimension is about PLACEMENT rather than the presence of one full stop.
            requirement: 'at least two sentence-punctuation marks in the reference',
            exercises: (reference) => (reference.match(/[.,!?;:]/g) ?? []).length >= 2,
        },
        filler_recognition: {
            requirement: 'at least one filler token in the reference',
            exercises: (reference) => /\b(um+|uh+|ah+|er+|hmm+)\b/i.test(reference),
        },
    });

/**
 * Punctuation is scored SEPARATELY, because word error rate cannot see it.
 *
 * Measured and published, deliberately NOT bounded yet: no real-worker distribution for punctuation
 * placement has been measured on this corpus, and choosing a threshold before measuring one is how a
 * bound comes to mean nothing. Until that measurement exists this dimension proves TRANSPORT and word
 * accuracy, and its punctuation figure is diagnostic — it is not evidence that the recognizer places
 * punctuation well.
 */
export const PRIVATE_WORKER_PUNCTUATION_ERROR_BOUND: number | null = null;

/** The metric that can actually OBSERVE a given quality dimension. */
export type PrivateWorkerDimensionMetric = 'word_error_rate' | 'punctuation_error_rate' | 'filler_recall';

/**
 * #1429 P1 — THE ONE PLACE THAT DECIDES WHETHER A DIMENSION IS PROVEN, AND WHAT PROVED IT.
 *
 * `PRIVATE_WORKER_DIMENSION_WER_BOUNDS` above is the WER GATE: which fixtures must clear which word
 * error rate. It is not a statement about what a dimension proves, and reading it as one is how this
 * artifact came to contradict itself — a `punctuation_placement` fixture was published with
 * `provenQualityDimensions: []` and, in the same row, `appliedWerBound: 0.2` and a place in
 * `boundedFixtureCount`. A reader could take that as a punctuation claim backed by a bound, when the
 * only bound cleared was scored by a metric that cannot see punctuation at all.
 *
 * This table names, per dimension, the metric that CAN see it and the bound that metric must clear.
 * `bound: null` means measured-only: the figure is published, and it proves nothing. Proof status,
 * the per-dimension bounds published on every row, and the bounded/measured-only aggregate counts all
 * derive from here, so they cannot drift apart again.
 *
 * It also removes the hard-coded punctuation exception that stood in for this table. That exception
 * was right about punctuation and wrong in both directions in general: any future dimension with a
 * non-null WER entry would have been published as proven even though WER cannot observe it, and a
 * dimension with a genuinely bounded scorer of its own would have been refused for having no WER
 * entry. A dimension is proven here only by the metric that measures it.
 */
export const PRIVATE_WORKER_DIMENSION_ACCEPTANCE: Readonly<Record<string, {
    metric: PrivateWorkerDimensionMetric;
    bound: number | null;
}>> = Object.freeze({
    clean_words: { metric: 'word_error_rate', bound: PRIVATE_WORKER_DIMENSION_WER_BOUNDS.clean_words },
    punctuation_placement: { metric: 'punctuation_error_rate', bound: PRIVATE_WORKER_PUNCTUATION_ERROR_BOUND },
    filler_recognition: { metric: 'filler_recall', bound: null },
});

/** What a published row says about ONE declared dimension: who measured it, against what, and whether that proves it. */
export interface PrivateWorkerDimensionAcceptance {
    dimension: string;
    /** The metric that can observe this dimension — not necessarily the one that gated the fixture. */
    metric: PrivateWorkerDimensionMetric | null;
    /** The bound that metric had to clear; `null` = measured-only, so the dimension is not proven. */
    bound: number | null;
    proven: boolean;
}

const FILLER_TOKEN = /^(um+|uh+|ah+|er+|hmm+)$/i;

/**
 * Each punctuation mark PAIRED WITH THE WORD IT FOLLOWS, e.g. `2:.` for a full stop after the third
 * word.
 *
 * A mark-only sequence is blind to placement, which is the one thing this dimension is named for.
 * `Hello, world. Next!` and `Hello world, Next.!` both reduce to `[',', '.', '!']` and scored a
 * perfect 0 with every mark moved — and Track-B WER sees identical words, so the journey could publish
 * a flattering punctuation figure for a transcript whose punctuation was entirely wrong. Binding each
 * mark to its word index makes moving a mark a real error.
 */
function positionedMarks(text: string): string[] {
    const marks: string[] = [];
    let wordIndex = -1;
    let inWord = false;
    for (const char of text) {
        if (/[\p{L}\p{N}'-]/u.test(char)) {
            if (!inWord) { wordIndex += 1; inWord = true; }
            continue;
        }
        inWord = false;
        if (/[.,!?;:]/.test(char)) marks.push(`${wordIndex}:${char}`);
    }
    return marks;
}

/**
 * How much of the reference's disfluency the hypothesis actually recovered, in [0,1]; `null` when the
 * reference carries no filler to recognise.
 *
 * Without this, `filler_recognition` was validated only on the REFERENCE side — the fixture had to
 * contain a filler, but nothing ever asked whether the worker returned one. A recognizer that dropped
 * every `um` still produced a green journey publishing that dimension.
 */
export function fillerRecall(referenceText: string, hypothesisText: string): number | null {
    const tokens = (text: string) => text.split(/[^\p{L}\p{N}'-]+/u).filter(Boolean);
    const referenceFillers = tokens(referenceText).filter(t => FILLER_TOKEN.test(t));
    if (referenceFillers.length === 0) return null;
    const hypothesisFillers = tokens(hypothesisText).filter(t => FILLER_TOKEN.test(t));
    const pool = hypothesisFillers.map(t => t.toLowerCase());
    let matched = 0;
    for (const filler of referenceFillers.map(t => t.toLowerCase())) {
        const at = pool.indexOf(filler);
        if (at !== -1) { pool.splice(at, 1); matched += 1; }
    }
    return matched / referenceFillers.length;
}

/**
 * Punctuation error rate: edit distance over the POSITIONED mark sequence, normalized by the
 * reference's mark count. `null` when the reference carries no punctuation, never 0 — an unmeasurable
 * dimension reporting a perfect score is the exact fabrication this lane exists to stop.
 */
/**
 * What this run can claim about one declared dimension, read from the acceptance contract and from
 * nowhere else. An unregistered dimension proves nothing and says so, rather than defaulting to the
 * WER table and inheriting a bound that never looked at it.
 */
function dimensionAcceptance(dimension: string): PrivateWorkerDimensionAcceptance {
    if (!Object.hasOwn(PRIVATE_WORKER_DIMENSION_ACCEPTANCE, dimension)) {
        return { dimension, metric: null, bound: null, proven: false };
    }
    const { metric, bound } = PRIVATE_WORKER_DIMENSION_ACCEPTANCE[dimension];
    return { dimension, metric, bound, proven: bound !== null };
}

function dimensionIsProven(dimension: string): boolean {
    return dimensionAcceptance(dimension).proven;
}

export function punctuationErrorRate(referenceText: string, hypothesisText: string): number | null {
    const reference = positionedMarks(referenceText);
    if (reference.length === 0) return null;
    const hypothesis = positionedMarks(hypothesisText);
    // Levenshtein over marks. Two rows only: the sequences are short and the full matrix is not needed.
    let previous = Array.from({ length: hypothesis.length + 1 }, (_, i) => i);
    for (let r = 1; r <= reference.length; r += 1) {
        const current = [r];
        for (let h = 1; h <= hypothesis.length; h += 1) {
            current[h] = reference[r - 1] === hypothesis[h - 1]
                ? previous[h - 1]
                : 1 + Math.min(previous[h - 1], previous[h], current[h - 1]);
        }
        previous = current;
    }
    return previous[hypothesis.length] / reference.length;
}

/**
 * Why a dimension is measured but not bounded here. Required for every `null` bound so
 * the exemption is argued on the record rather than assumed.
 */
export const PRIVATE_WORKER_MEASURED_ONLY_DIMENSIONS: Readonly<Record<string, string>> = Object.freeze({
    punctuation_placement_marks:
        'Word error rate is blind to punctuation, so the WER bound on this dimension proves word accuracy '
        + 'and transport, not punctuation placement. The mark-level rate is measured and published here but '
        + 'not bounded: no real-worker punctuation distribution has been measured on this corpus, and a '
        + 'threshold chosen before that measurement would assert an accuracy claim nothing supports.',
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

/**
 * Mismatch categories. A red run must say WHICH contract broke without anyone reading the code, and
 * without any transcript or reference text leaving the machine that produced it.
 */
export type PrivateWorkerProblemCategory =
    | 'fixture_contract'
    | 'quality_dimension'
    | 'observation_coverage'
    | 'pcm_tuple'
    | 'transcript_missing'
    | 'transcript_duplicate'
    | 'wer_bound'
    | 'punctuation_bound'
    | 'reference_separation';

export interface PrivateWorkerProblem {
    fixtureId: string | null;
    category: PrivateWorkerProblemCategory;
    detail: string;
}

/**
 * Per-fixture measurements retained EVEN WHEN THE AGGREGATE PROOF FAILS. Aggregate validation used
 * to throw before anything per-fixture survived, so a red run said only that something was wrong and
 * a maintainer had to reproduce it locally to learn what. Hashes and counts only — never text.
 */
export interface PrivateWorkerFixtureDiagnostic {
    /** Positioned punctuation error rate; null when the fixture does not claim the dimension. */
    punctuationErrorRate?: number | null;
    /** Fraction of the reference's fillers the worker returned; null when the dimension is not claimed. */
    fillerRecall?: number | null;
    fixtureId: string;
    fixtureSha256: string | null;
    referenceTextSha256: string | null;
    transcriptSha256: string | null;
    qualityDimensions: string[];
    appliedWerBound: number | null;
    referenceWords: number | null;
    hypothesisWords: number | null;
    substitutions: number | null;
    deletions: number | null;
    insertions: number | null;
    wer: number | null;
    nearestOtherReferenceWer: number | null;
    referenceSeparation: number | null;
    mainThreadInput: PrivateWorkerInputTuple | null;
    workerInput: PrivateWorkerInputTuple | null;
    inputHashesMatch: boolean | null;
    categories: PrivateWorkerProblemCategory[];
}

/** Carries the sanitized per-fixture record past the throw, so CI can publish it. */
export class PrivateWorkerNaturalLanguageJourneyError extends Error {
    readonly problems: PrivateWorkerProblem[];
    readonly diagnostics: PrivateWorkerFixtureDiagnostic[];

    constructor(problems: PrivateWorkerProblem[], diagnostics: PrivateWorkerFixtureDiagnostic[]) {
        super(problems.map(problem => problem.detail).join('; '));
        this.name = 'PrivateWorkerNaturalLanguageJourneyError';
        this.problems = problems;
        this.diagnostics = diagnostics;
    }
}

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
    /**
     * Positioned punctuation error rate for fixtures claiming `punctuation_placement`; null otherwise.
     * Published so the dimension carries a figure a reader can check, and deliberately unbounded — see
     * PRIVATE_WORKER_PUNCTUATION_ERROR_BOUND.
     */
    punctuationErrorRate?: number | null;
    /** Measured filler recall for fixtures claiming `filler_recognition`; null otherwise. Unbounded. */
    fillerRecall?: number | null;
    /**
     * The subset of `qualityDimensions` this row actually PROVES — those carrying a bound the result
     * had to clear. A measured-only dimension is declared and measured but never proven, and a reader
     * of this artifact must be able to tell the difference without knowing the bounds table.
     */
    provenQualityDimensions: string[];
    /**
     * Every declared dimension with the metric that can observe it and the bound that metric had to
     * clear. This is the per-metric publication that keeps `appliedWerBound` from being read as a
     * claim about the declared dimensions: a `punctuation_placement` row now carries
     * `{ metric: 'punctuation_error_rate', bound: null, proven: false }` in plain sight.
     */
    dimensionAcceptance: PrivateWorkerDimensionAcceptance[];
    fixtureId: string;
    fixtureSha256: string;
    referenceTextSha256: string;
    transcriptSha256: string;
    qualityDimensions: string[];
    /**
     * The Track-B WER gate this fixture's transcript had to clear; null when no declared dimension
     * carries a WER entry.
     *
     * #1429 P1 — THIS IS A WORD-ACCURACY GATE, NOT A DIMENSION PROOF. A punctuation-blind metric
     * clearing 0.2 says the words were right; it says nothing about the dimension the fixture
     * declares. Read `dimensionAcceptance` and `provenQualityDimensions` for what the run proved.
     */
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
    /** Fixtures with at least one PROVEN dimension — see `dimensionAcceptance`, not `appliedWerBound`. */
    boundedFixtureCount: number;
    /** Fixtures whose every declared dimension is measured-only. Their figures are published, unproven. */
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
        // OWN properties only: `dimension in ...` accepts inherited names like `toString`, so a manifest
        // could declare a prototype key and pass the "known dimension" check.
        if (!Object.hasOwn(PRIVATE_WORKER_DIMENSION_WER_BOUNDS, dimension)) {
            problems.push(`fixture '${fixture.fixtureId}' declares unknown quality dimension '${dimension}'`);
            continue;
        }
        // A dimension registered without an exercise contract used to leave `exercise` undefined and
        // skip fixture validation entirely, so the NEXT dimension anyone adds would qualify any
        // reference. Registration without a contract is now the error, not a silent exemption.
        if (!Object.hasOwn(PRIVATE_WORKER_DIMENSION_EXERCISE, dimension)) {
            problems.push(
                `quality dimension '${dimension}' is registered with a bound but no exercise contract, `
                + 'so nothing can check that a fixture claiming it actually demonstrates it');
            continue;
        }
        // THE LABEL MUST BE EXERCISED. Checked before any bound is applied, so a dimension a fixture
        // cannot demonstrate is refused outright rather than quietly cleared by a blind measurement.
        const exercise = PRIVATE_WORKER_DIMENSION_EXERCISE[dimension];
        if (exercise && !exercise.exercises(fixture.referenceText)) {
            problems.push(
                `fixture '${fixture.fixtureId}' declares quality dimension '${dimension}' but its reference `
                + `does not exercise it (requires ${exercise.requirement})`);
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
 * On failure this throws `PrivateWorkerNaturalLanguageJourneyError`, which CARRIES the
 * sanitized per-fixture record. Aggregate validation used to throw with nothing
 * per-fixture surviving, so a red run said only that something was wrong. Both the
 * success value and the error contain hashes and measurements only, never transcript text.
 */
export function provePrivateWorkerNaturalLanguageJourney(
    fixtures: readonly NaturalLanguageFixtureContract[],
    observations: readonly PrivateWorkerNaturalLanguageObservation[],
): PrivateWorkerNaturalLanguageJourneyProof {
    const problems: PrivateWorkerProblem[] = [];
    const fail = (fixtureId: string | null, category: PrivateWorkerProblemCategory, detail: string) => {
        problems.push({ fixtureId, category, detail });
    };

    if (fixtures.length < 2) fail(null, 'fixture_contract', 'natural-language journey requires at least two fixtures');

    const fixtureIds = new Set<string>();
    const referenceHashes = new Set<string>();
    for (const fixture of fixtures) {
        const id = fixture.fixtureId;
        if (!id.trim()) fail(null, 'fixture_contract', 'fixture has no fixtureId');
        if (fixtureIds.has(id)) fail(id, 'fixture_contract', `fixture '${id}' is duplicated`);
        fixtureIds.add(id);
        if (!SHA256_RE.test(fixture.fixtureSha256)) fail(id, 'fixture_contract', `fixture '${id}' audio hash is not SHA-256`);
        if (!SHA256_RE.test(fixture.referenceTextSha256) || sha256(fixture.referenceText) !== fixture.referenceTextSha256) {
            fail(id, 'fixture_contract', `fixture '${id}' reference text does not match its pinned SHA-256`);
        }
        const referenceWords = fixture.referenceText.trim().split(/\s+/).filter(Boolean).length;
        if (referenceWords < PRIVATE_WORKER_MIN_FIXTURE_WORDS) {
            fail(id, 'fixture_contract', `fixture '${id}' has fewer than ${PRIVATE_WORKER_MIN_FIXTURE_WORDS} natural-language words`);
        }
        if (fixture.qualityDimensions.length === 0) fail(id, 'quality_dimension', `fixture '${id}' has no quality dimension`);
        if (referenceHashes.has(fixture.referenceTextSha256)) fail(id, 'fixture_contract', `fixture '${id}' repeats another reference text`);
        referenceHashes.add(fixture.referenceTextSha256);
    }

    const observationsByFixture = new Map<string, PrivateWorkerNaturalLanguageObservation>();
    for (const observation of observations) {
        if (!fixtureIds.has(observation.fixtureId)) fail(observation.fixtureId, 'observation_coverage', `unexpected observation '${observation.fixtureId}'`);
        if (observationsByFixture.has(observation.fixtureId)) fail(observation.fixtureId, 'observation_coverage', `observation '${observation.fixtureId}' is duplicated`);
        observationsByFixture.set(observation.fixtureId, observation);
    }

    const seenTranscripts = new Map<string, string>();
    const results: SanitizedPrivateWorkerFixtureResult[] = [];
    const diagnostics: PrivateWorkerFixtureDiagnostic[] = [];

    for (const fixture of fixtures) {
        const id = fixture.fixtureId;
        const { bound, problems: boundProblems } = resolveBound(fixture);
        for (const detail of boundProblems) fail(id, 'quality_dimension', detail);

        const diagnostic: PrivateWorkerFixtureDiagnostic = {
            fixtureId: id,
            fixtureSha256: fixture.fixtureSha256 ?? null,
            referenceTextSha256: fixture.referenceTextSha256 ?? null,
            transcriptSha256: null,
            qualityDimensions: [...fixture.qualityDimensions],
            appliedWerBound: bound,
            punctuationErrorRate: null,
            referenceWords: null,
            hypothesisWords: null,
            substitutions: null,
            deletions: null,
            insertions: null,
            wer: null,
            nearestOtherReferenceWer: null,
            referenceSeparation: null,
            mainThreadInput: null,
            workerInput: null,
            inputHashesMatch: null,
            categories: [],
        };
        diagnostics.push(diagnostic);

        const observation = observationsByFixture.get(id);
        if (!observation) {
            fail(id, 'observation_coverage', `fixture '${id}' did not cross the worker journey`);
            continue;
        }

        diagnostic.mainThreadInput = { ...observation.mainThreadInput };
        diagnostic.workerInput = { ...observation.workerInput };

        for (const detail of tupleProblems(`${id} main-thread`, observation.mainThreadInput)) fail(id, 'pcm_tuple', detail);
        for (const detail of tupleProblems(`${id} worker`, observation.workerInput)) fail(id, 'pcm_tuple', detail);
        const tuplesAgree =
            observation.mainThreadInput.sha256 === observation.workerInput.sha256 &&
            observation.mainThreadInput.samples === observation.workerInput.samples &&
            observation.mainThreadInput.bytes === observation.workerInput.bytes &&
            Math.abs(observation.mainThreadInput.durationSeconds - observation.workerInput.durationSeconds) <= 1e-6;
        diagnostic.inputHashesMatch = tuplesAgree;
        if (!tuplesAgree) fail(id, 'pcm_tuple', `fixture '${id}' main-thread and worker PCM tuples differ`);

        const transcript = observation.transcript.trim();
        if (!transcript) {
            fail(id, 'transcript_missing', `fixture '${id}' produced no transcript`);
            continue;
        }
        const transcriptHash = sha256(transcript);
        diagnostic.transcriptSha256 = transcriptHash;
        const twin = seenTranscripts.get(transcriptHash);
        if (twin) fail(id, 'transcript_duplicate', `fixture '${id}' returned the same transcript as '${twin}'`);
        seenTranscripts.set(transcriptHash, id);

        const score = wordErrorRate(fixture.referenceText, transcript, {
            track: PRIVATE_WORKER_NATURAL_LANGUAGE_TRACK,
        });
        if (score.wer === null) {
            fail(id, 'transcript_missing', `fixture '${id}' has no measurable reference`);
            continue;
        }

        const hypothesisWords = transcript.split(/\s+/).filter(Boolean).length;
        diagnostic.referenceWords = score.referenceWords;
        diagnostic.hypothesisWords = hypothesisWords;
        diagnostic.substitutions = score.substitutions;
        diagnostic.deletions = score.deletions;
        diagnostic.insertions = score.insertions;
        diagnostic.wer = score.wer;

        // PUNCTUATION, SCORED BY SOMETHING THAT CAN SEE IT. Word error rate normalizes punctuation away,
        // so this is measured on the raw texts and reported separately. Only fixtures that actually claim
        // the dimension are scored for it.
        if (fixture.qualityDimensions.includes('punctuation_placement')) {
            const punctuation = punctuationErrorRate(fixture.referenceText, transcript);
            diagnostic.punctuationErrorRate = punctuation;
            if (punctuation === null) {
                fail(id, 'quality_dimension',
                    `fixture '${id}' claims punctuation_placement but its reference carries no punctuation to score`);
            } else if (PRIVATE_WORKER_PUNCTUATION_ERROR_BOUND !== null
                && punctuation > PRIVATE_WORKER_PUNCTUATION_ERROR_BOUND) {
                fail(id, 'punctuation_bound',
                    `fixture '${id}' punctuation error rate ${punctuation.toFixed(3)} exceeds `
                    + `${PRIVATE_WORKER_PUNCTUATION_ERROR_BOUND.toFixed(3)}`);
            }
        }

        // FILLER RECOGNITION IS SCORED ON THE HYPOTHESIS, not merely required of the reference.
        // The exercise contract only asks whether the fixture CONTAINS a filler; without this, a worker
        // that dropped every one still produced a green journey publishing `filler_recognition`.
        // Measured and published, deliberately unbounded — the corpus is synthesized speech and a bound
        // scored on it would measure the synthesizer (see PRIVATE_WORKER_MEASURED_ONLY_DIMENSIONS).
        if (fixture.qualityDimensions.includes('filler_recognition')) {
            const recall = fillerRecall(fixture.referenceText, transcript);
            diagnostic.fillerRecall = recall;
            if (recall === null) {
                fail(id, 'quality_dimension',
                    `fixture '${id}' claims filler_recognition but its reference carries no filler to score`);
            }
        }

        if (bound !== null && score.wer > bound) {
            fail(id, 'wer_bound',
                `fixture '${id}' WER ${score.wer.toFixed(3)} exceeds ${bound.toFixed(3)} `
                + `(S=${score.substitutions} D=${score.deletions} I=${score.insertions} over ${score.referenceWords} reference words)`);
        }

        const otherWers = fixtures
            .filter(other => other.fixtureId !== id)
            .map(other => wordErrorRate(other.referenceText, transcript, {
                track: PRIVATE_WORKER_NATURAL_LANGUAGE_TRACK,
            }).wer)
            .filter((wer): wer is number => wer !== null);
        const nearestOtherReferenceWer = otherWers.length > 0 ? Math.min(...otherWers) : Number.POSITIVE_INFINITY;
        const referenceSeparation = nearestOtherReferenceWer - score.wer;
        diagnostic.nearestOtherReferenceWer = nearestOtherReferenceWer;
        diagnostic.referenceSeparation = referenceSeparation;
        if (referenceSeparation < PRIVATE_WORKER_MIN_REFERENCE_SEPARATION) {
            fail(id, 'reference_separation',
                `fixture '${id}' transcript is not measurably bound to its own reference: `
                + `own WER ${score.wer.toFixed(3)} vs nearest other reference ${nearestOtherReferenceWer.toFixed(3)} `
                + `(separation ${referenceSeparation.toFixed(3)} < ${PRIVATE_WORKER_MIN_REFERENCE_SEPARATION.toFixed(3)})`);
        }

        results.push({
            fixtureId: id,
            fixtureSha256: fixture.fixtureSha256,
            referenceTextSha256: fixture.referenceTextSha256,
            transcriptSha256: transcriptHash,
            qualityDimensions: [...fixture.qualityDimensions],
            appliedWerBound: bound,
            punctuationErrorRate: diagnostic.punctuationErrorRate ?? null,
            fillerRecall: diagnostic.fillerRecall ?? null,
            provenQualityDimensions: fixture.qualityDimensions.filter(d => dimensionIsProven(d)),
            dimensionAcceptance: fixture.qualityDimensions.map(dimensionAcceptance),
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
        fail(null, 'observation_coverage', `observed ${observations.length} worker journeys for ${fixtures.length} fixtures`);
    }

    if (problems.length > 0) {
        const byFixture = new Map(diagnostics.map(diagnostic => [diagnostic.fixtureId, diagnostic]));
        for (const problem of problems) {
            const diagnostic = problem.fixtureId ? byFixture.get(problem.fixtureId) : undefined;
            if (diagnostic && !diagnostic.categories.includes(problem.category)) {
                diagnostic.categories.push(problem.category);
            }
        }
        throw new PrivateWorkerNaturalLanguageJourneyError(problems, diagnostics);
    }

    const wers = results.map(result => result.wer);
    return {
        fixtureCount: results.length,
        track: PRIVATE_WORKER_NATURAL_LANGUAGE_TRACK,
        /*
         * #1429 P1 — COUNTED BY WHAT WAS PROVEN, NOT BY WHAT WAS GATED.
         *
         * These counted `appliedWerBound !== null`, so a fixture whose sole dimension is measured-only
         * landed in `boundedFixtureCount` on the strength of a WER gate that could not observe that
         * dimension — while the same row published `provenQualityDimensions: []`. One artifact, two
         * contradictory answers, and the flattering one is the summary statistic a reader reaches for
         * first. Both counts now read the same proof contract the per-row labels do.
         */
        boundedFixtureCount: results.filter(result => result.provenQualityDimensions.length > 0).length,
        measuredOnlyFixtureCount: results.filter(result => result.provenQualityDimensions.length === 0).length,
        minimumReferenceSeparation: PRIVATE_WORKER_MIN_REFERENCE_SEPARATION,
        observedMinimumReferenceSeparation: Math.min(...results.map(result => result.referenceSeparation)),
        averageWer: wers.reduce((total, wer) => total + wer, 0) / wers.length,
        maximumWer: Math.max(...wers),
        results,
    };
}
