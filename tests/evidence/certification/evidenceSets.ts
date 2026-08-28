/**
 * #1304 — the three clip sets, built from ONE place so a runner cannot invent its own.
 *
 * The preflight set is drawn from the frozen corpus but is DISJOINT from nothing yet measured — it is
 * simply unseen, because no arm has been run over the corpus at all. What matters is that it is drawn
 * deterministically and that its ids come from the frozen manifest, so the same clips are scored by
 * every arm and by every re-run.
 */
import { readFileSync } from 'node:fs';
import { normalizeOfficialTrackA } from '../normalization/officialNormalizer';
import { loadFrozenCorpus, type ManifestShape } from './corpusSet';
import { HARVARD_SENTENCES } from '../../fixtures/stt-isomorphic/harvard-sentences';

export interface EvidenceClip {
    id: string;
    reference: string;
    /** Path relative to the repo root (Node) — the browser lane maps it to a URL. */
    path: string;
    /** Corpus-relative audio path and digest, present only for frozen-corpus clips. */
    frozen?: { audioPath: string; audioSha256: string; audioBytes: number };
}

export interface BuiltEvidenceSet {
    id: string;
    /** Digest of the frozen selection this set was drawn from; empty for sets with no frozen audio. */
    corpusDigest: string;
    clips: EvidenceClip[];
    /** The ids an arm must account for — from the SET's definition, never from what it decoded. */
    expectedIds: string[];
    referenceWords: number;
}

const words = (text: string) => normalizeOfficialTrackA(text).length;

export function buildHarvardSet(): BuiltEvidenceSet {
    const clips = HARVARD_SENTENCES
        .filter((s) => /^h1_\d+$/.test(s.id))
        .map((s) => ({
            id: s.id,
            reference: s.transcript,
            path: `tests/fixtures/stt-isomorphic/audio/${s.id}.wav`,
        }));
    return {
        id: 'harvard',
        // Harvard clips are committed fixtures, not frozen-corpus selections.
        corpusDigest: '',
        clips,
        expectedIds: clips.map((c) => c.id),
        referenceWords: clips.reduce((n, c) => n + words(c.reference), 0),
    };
}

/** The whole frozen 600 — the only selection-grade set. */
export function buildCorpusSet(manifest: ManifestShape): BuiltEvidenceSet {
    const loaded = loadFrozenCorpus(manifest);
    if (!loaded.ok) throw new Error(`frozen corpus unusable: ${loaded.reason} (${loaded.detail})`);
    const clips = loaded.corpus.utterances.map((u) => ({
        id: u.id,
        reference: u.reference,
        path: `bench-corpus/${u.audioPath}`,
        frozen: { audioPath: u.audioPath, audioSha256: u.audioSha256, audioBytes: u.audioBytes },
    }));
    return {
        id: 'corpus',
        corpusDigest: loaded.corpus.digest,
        clips,
        // From the manifest's own declared counts, via loadFrozenCorpus — not from `clips`.
        expectedIds: loaded.corpus.expectedIds,
        referenceWords: clips.reduce((n, c) => n + words(c.reference), 0),
    };
}

/**
 * PREFLIGHT — unseen frozen-corpus clips to a target normalized word count, split evenly between the
 * two LibriSpeech test sets.
 *
 * Deterministic and reproducible: clips are taken in the manifest's own frozen order, alternating sets,
 * until the target is reached. No sampling, no seed, nothing that could differ between arms — every
 * arm must be scored on exactly the same audio or the comparison means nothing.
 */
export function buildPreflightSet(manifest: ManifestShape, targetWords = 425): BuiltEvidenceSet {
    const loaded = loadFrozenCorpus(manifest);
    if (!loaded.ok) throw new Error(`frozen corpus unusable: ${loaded.reason} (${loaded.detail})`);

    const bySet = new Map<string, typeof loaded.corpus.utterances>();
    for (const u of loaded.corpus.utterances) {
        // `LibriSpeech/<set>/...` — the set name is the manifest's own second path segment.
        const setName = u.audioPath.split('/')[1] ?? 'unknown';
        bySet.set(setName, [...(bySet.get(setName) ?? []), u]);
    }
    const setNames = [...bySet.keys()].sort();

    const chosen: typeof loaded.corpus.utterances = [];
    let total = 0;
    let index = 0;
    // Round-robin across the sets so the split stays roughly even however long the clips are.
    while (total < targetWords) {
        let addedThisPass = false;
        for (const name of setNames) {
            if (total >= targetWords) break;
            const candidate = bySet.get(name)?.[index];
            if (!candidate) continue;
            chosen.push(candidate);
            total += words(candidate.reference);
            addedThisPass = true;
        }
        if (!addedThisPass) break; // exhausted every set before reaching the target
        index += 1;
    }

    const clips = chosen.map((u) => ({
        id: u.id,
        reference: u.reference,
        path: `bench-corpus/${u.audioPath}`,
        frozen: { audioPath: u.audioPath, audioSha256: u.audioSha256, audioBytes: u.audioBytes },
    }));
    return {
        id: 'preflight',
        corpusDigest: loaded.corpus.digest,
        clips,
        expectedIds: clips.map((c) => c.id),
        referenceWords: total,
    };
}

/**
 * The >30s control as a one-clip set, so long-form behaviour goes through the SAME certified path as
 * everything else — truncation, a lost tail and a looping decode are the failures a pooled WER over
 * short clips averages away.
 */
export function buildLongformSet(): BuiltEvidenceSet {
    const clip = longformClip();
    return { id: 'longform', corpusDigest: '', clips: [clip], expectedIds: [clip.id], referenceWords: words(clip.reference) };
}

export function buildEvidenceSet(setId: string, manifest: ManifestShape, targetWords?: number): BuiltEvidenceSet {
    if (setId === 'harvard') return buildHarvardSet();
    if (setId === 'longform') return buildLongformSet();
    if (setId === 'preflight') return buildPreflightSet(manifest, targetWords);
    if (setId === 'corpus') return buildCorpusSet(manifest);
    throw new Error(`unknown evidence set: ${setId}`);
}

/** The long-form control, read from its committed reference. */
export function longformClip(): EvidenceClip {
    return {
        id: 'long-01',
        reference: readFileSync('tests/fixtures/corpus-longform/long-01.reference.txt', 'utf8')
            .split('\n').filter(Boolean).join(' '),
        path: 'tests/fixtures/corpus-longform/long-01.wav',
    };
}
