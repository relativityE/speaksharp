/**
 * #1304 Task 3C — the frozen corpus, loaded so that INCOMPLETE cannot look COMPLETE.
 *
 * THE BYPASS THIS CLOSES. The expected-id list and the scored list were built from the same loop over
 * the manifest. If a subset were short, BOTH were short — 599 expected, 599 scored, and
 * `aggregateCorpusArm` reported a complete arm. The completeness check compared a list against itself.
 *
 * The manifest states its own size (`subsetSize`, and `counts[set].selected` per set). Those are the
 * authority, and they are checked BEFORE any expected-id list is derived from the entries. A manifest
 * that disagrees with itself is refused rather than measured.
 */
export interface FrozenUtterance {
    id: string;
    reference: string;
    /** Corpus-root-relative path, exactly as the manifest froze it. */
    audioPath: string;
    audioSha256: string;
    audioBytes: number;
}

export interface FrozenCorpus {
    version: string;
    utterances: FrozenUtterance[];
    /** Every id the arm MUST score, from the manifest's declared counts. */
    expectedIds: string[];
}

export type CorpusLoadFailure =
    | { reason: 'subset_count_mismatch'; detail: string }
    | { reason: 'declared_total_mismatch'; detail: string }
    | { reason: 'duplicate_utterance_id'; detail: string }
    | { reason: 'missing_audio_binding'; detail: string };

export interface ManifestShape {
    corpusVersion: string;
    subsetSize: number;
    counts: Record<string, { available: number; selected: number }>;
    subsets: Record<string, { id: string; reference: string; audio?: { path: string; sha256: string; bytes: number } }[]>;
}

export function loadFrozenCorpus(
    manifest: ManifestShape,
): { ok: true; corpus: FrozenCorpus } | ({ ok: false } & CorpusLoadFailure) {
    const setNames = Object.keys(manifest.subsets).sort();
    const utterances: FrozenUtterance[] = [];

    for (const set of setNames) {
        const entries = manifest.subsets[set] ?? [];
        const declared = manifest.counts[set]?.selected;

        // The set's own declared count, checked against what it actually contains. This is the
        // comparison the previous version never made — it derived both numbers from the entries.
        if (declared !== entries.length) {
            return {
                ok: false,
                reason: 'subset_count_mismatch',
                detail: `${set}: declares ${declared} selected, holds ${entries.length}`,
            };
        }
        // And against the size the freeze was performed at, so a set cannot be short in both places.
        if (declared !== manifest.subsetSize) {
            return {
                ok: false,
                reason: 'subset_count_mismatch',
                detail: `${set}: declares ${declared}, manifest subsetSize is ${manifest.subsetSize}`,
            };
        }

        for (const entry of entries) {
            if (!entry.audio?.path || !entry.audio?.sha256) {
                return { ok: false, reason: 'missing_audio_binding', detail: `${set}/${entry.id}` };
            }
            utterances.push({
                id: entry.id,
                reference: entry.reference,
                audioPath: entry.audio.path,
                audioSha256: entry.audio.sha256,
                audioBytes: entry.audio.bytes,
            });
        }
    }

    const expectedTotal = manifest.subsetSize * setNames.length;
    if (utterances.length !== expectedTotal) {
        return {
            ok: false,
            reason: 'declared_total_mismatch',
            detail: `${utterances.length} utterances for ${setNames.length} sets of ${manifest.subsetSize}`,
        };
    }

    const ids = utterances.map((u) => u.id);
    if (new Set(ids).size !== ids.length) {
        // A duplicate would satisfy the count while scoring one clip twice.
        return { ok: false, reason: 'duplicate_utterance_id', detail: 'duplicate ids in the frozen set' };
    }

    return { ok: true, corpus: { version: manifest.corpusVersion, utterances, expectedIds: ids } };
}
