/**
 * @vitest-environment node
 *
 * NODE ENVIRONMENT, DELIBERATELY. The suite's default jsdom environment supplies its own `Float32Array`
 * from a different realm, and onnxruntime's tensor constructor checks the constructor identity — so a
 * real decode fails with "a float32 tensor's data must be type of Float32Array" before any inference
 * happens. Nothing about the product is jsdom-specific here; the arm is Node code loading Node weights.
 */
/**
 * #1304 Task 3C — the REAL shipping-v2 controls, and the Harvard-10 characterization.
 *
 * The injected-engine suite proves the arithmetic. This proves the arithmetic is applied to the
 * PRODUCT'S ACTUAL DECODE: the product's own self-hosted weights, loaded with remote models disabled,
 * decoded through the shared shipping options, scored by the certified path.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED: a WER threshold. Harvard-10 is a CHARACTERIZATION, not a target.
 * The retired `0.0936` was a mean of per-utterance WERs over surviving rows, from the scorer #1356
 * disqualified, on the browser product path, from an artifact that no longer exists — tuning anything
 * to reproduce it would certify this work against that defect. What is asserted here are properties
 * that cannot be tuned: which decode branches ran, that every utterance scored, that the pooled figure
 * is pooled, and that the pipeline can produce an exact match at all.
 *
 * These load a real model and run real inference, so this file is slower than the rest of the suite.
 * The weights are committed under `frontend/public/models/`, so it needs no network.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import goldens from '../../normalization/goldens.json';
import manifest from '../../../fixtures/corpus-manifest.json';
import { HARVARD_SENTENCES } from '../../../fixtures/stt-isomorphic/harvard-sentences';
import { createTransformersV2Arm } from '../arms/transformersV2Arm';
import { decodeWav } from '../audio';
import { certifyArm } from '../certify';
import { scoreUtterance, aggregateArm, type CorpusScore } from '../scoringAdapter';
import type { CertificationResult } from '../certify';
import type { CandidateRoute } from '../candidateRoute';

const MODEL = 'whisper-base.en';
const ORACLE = (goldens as unknown as { cases: { category: string; input: string; expected: string }[] }).cases;
const HARVARD = HARVARD_SENTENCES.filter((s) => /^h1_\d+$/.test(s.id));

const arm = createTransformersV2Arm({
    localModelId: MODEL,
    modelsRoot: resolve('frontend/public/models'),
    corpus: {
        version: manifest.corpusVersion,
        archives: Object.fromEntries(Object.entries(manifest.archives).map(([n, a]) => [n, a.sha256])),
    },
});

/** Every arm in this file is a Whisper arm; a Moonshine route has no stride to read. */
const whisperStride = (route: CandidateRoute): number =>
    route.family === 'whisper' ? route.decode.stride_length_s : -1;

interface Control { seconds: number; stride: number; score: CorpusScore }
let certification: CertificationResult;
let shortControl: Control;
let longControl: Control;
let harvardScores: CorpusScore[];

beforeAll(async () => {
    certification = certifyArm(arm, { family: 'whisper', engine: 'v2', modelId: MODEL }, ORACLE);

    const run = async (id: string, wav: string, reference: string): Promise<Control> => {
        const audio = decodeWav(wav);
        const hypothesis = await arm.decode(audio.samples, audio.seconds);
        return {
            seconds: audio.seconds,
            stride: whisperStride(arm.declareRoute(audio.seconds)),
            score: scoreUtterance(id, reference, hypothesis),
        };
    };

    shortControl = await run('short:h1_1', 'tests/fixtures/stt-isomorphic/audio/h1_1.wav', HARVARD[0].transcript);
    longControl = await run(
        'long:long-01',
        'tests/fixtures/corpus-longform/long-01.wav',
        readFileSync('tests/fixtures/corpus-longform/long-01.reference.txt', 'utf8').split('\n').filter(Boolean).join(' '),
    );

    harvardScores = [];
    for (const sentence of HARVARD) {
        const audio = decodeWav(`tests/fixtures/stt-isomorphic/audio/${sentence.id}.wav`);
        const hypothesis = await arm.decode(audio.samples, audio.seconds);
        harvardScores.push(scoreUtterance(sentence.id, sentence.transcript, hypothesis));
    }
}, 600_000);

describe('the real shipping-v2 arm certifies', () => {
    it('matches the shipping route at all three probes', () => {
        expect(certification.gates.routeParity.probes.filter((p) => !p.matched)).toEqual([]);
    });

    it('passes all 68 oracle vectors and reports complete provenance', () => {
        expect(certification.gates.oracleVectors.ok).toBe(true);
        expect(certification.gates.provenance).toMatchObject({ ok: true, missing: [], empty: [] });
        expect(certification.certified).toBe(true);
    });

    it('names the product\'s own weights, by digest', () => {
        // Not "a whisper-base.en" — THE files the app serves. A benchmark that quietly fetched
        // different weights from HuggingFace would measure a model no user runs.
        const provenance = arm.provenance();
        expect(provenance.assets.verdict).toBe('identical');
        expect(provenance.assets.source).toContain('frontend/public/models');
        expect(Object.keys(provenance.model.filesSha256).length).toBeGreaterThan(3);
        for (const digest of Object.values(provenance.model.filesSha256)) {
            expect(digest).toMatch(/^[0-9a-f]{64}$/);
        }
    });
});

describe('CONTROLS — both decode branches are exercised by real audio', () => {
    it('the short fixture takes the zero-stride branch and scores', () => {
        expect(shortControl.seconds).toBeLessThan(30);
        expect(shortControl.stride).toBe(0);
        expect(shortControl.score.ok && shortControl.score.row.wer).not.toBeNull();
    });

    it('the long fixture crosses the window and takes the long-form stride', () => {
        // Without a >30s fixture the long-form branch is unmeasured while appearing covered — ordinary
        // LibriSpeech utterances are all seconds long.
        expect(longControl.seconds).toBeGreaterThan(30);
        expect(longControl.stride).toBe(5);
        expect(longControl.score.ok && longControl.score.row.wer).not.toBeNull();
    });

    it('the two controls land on DIFFERENT branches', () => {
        // If both landed on the same one, the pair would prove a single configuration twice.
        expect(shortControl.stride).not.toBe(longControl.stride);
    });

    it('both controls produce measurable rows, not silent blanks', () => {
        const rows = [['short', shortControl], ['long', longControl]] as const;
        expect(rows.filter(([, c]) => !c.score.ok).map(([name]) => name)).toEqual([]);
        expect(rows.map(([name, c]) => [name, c.score.ok ? c.score.row.referenceWords > 0 : false]))
            .toEqual([['short', true], ['long', true]]);
    });
});

describe('HARVARD-10 — a strict pooled Track-A characterization, not a target', () => {
    it('every utterance scores; the arm is complete', () => {
        expect(harvardScores).toHaveLength(HARVARD.length);
        expect(harvardScores.filter((s) => !s.ok)).toEqual([]);
    });

    it('the pooled figure is scoreable and reports the edits that produced it', () => {
        const aggregate = aggregateArm(harvardScores, HARVARD.map((s) => s.id));
        expect(aggregate.wer).not.toBeNull();
        expect(aggregate.referenceWords).toBeGreaterThan(50);
        expect(aggregate.scoredCount).toBe(HARVARD.length);
        // Pooled, by construction: Σ(S+D+I)/Σ(refWords). Recomputed here from the parts so the field
        // cannot report one statistic while the parts describe another.
        const edits = aggregate.substitutions + aggregate.deletions + aggregate.insertions;
        expect(aggregate.wer).toBeCloseTo(edits / aggregate.referenceWords, 12);
    });

    it('the pipeline can produce an EXACT match — the audio path is not systematically broken', () => {
        // The check that catches a mis-parsed header or a wrong sample rate. Such a run still yields
        // plausible transcripts and a plausible pooled figure; what it cannot do is score any clip
        // perfectly. No threshold is implied — this is a floor on the pipeline, not on the model.
        expect(harvardScores.some((s) => s.ok && s.row.wer === 0)).toBe(true);
    });

    it('no per-utterance score is used as the headline figure', () => {
        // Guards the statistic itself: the mean and the pooled value differ on this data, and the
        // retired baseline was the mean.
        const aggregate = aggregateArm(harvardScores, HARVARD.map((s) => s.id));
        const wers = harvardScores.map((s) => (s.ok ? s.row.wer ?? 0 : 0));
        const mean = wers.reduce((a, b) => a + b, 0) / wers.length;
        expect(aggregate.wer).not.toBe(mean);
    });
});
