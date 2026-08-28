/**
 * #1304 — types for the manifest generator, so `typecheck:evidence` can see the functions its tests
 * import. The generator is `.mjs` because it runs directly under node with no build step; without
 * this declaration the gate reports an implicit `any` rather than checking the contract.
 */

/** One frozen selection: the reference text AND the identity of the audio it must be scored against. */
export interface ManifestUtterance {
    id: string;
    reference: string;
    /** Bound at generation time. A manifest cannot be produced without reading these bytes. */
    audio: { path: string; bytes: number; sha256: string };
}

export type BuildFailureReason =
    | 'set_missing'
    | 'malformed_utterance_id'
    | 'audio_missing'
    | 'audio_not_a_file'
    | 'audio_empty'
    | 'audio_unreadable'
    | 'missing_reference'
    | 'duplicate_audio_path'
    | 'duplicate_audio_bytes';

export interface CorpusManifest {
    corpusVersion: string;
    source: string;
    licence: string;
    attribution: string;
    seed: string;
    subsetSize: number;
    archives: Record<string, { bytes: number; officialMd5: string; sha256: string }>;
    counts: Record<string, { available: number; selected: number }>;
    /** SHA-256 of the generator source, so an edit without a re-freeze is detectable. */
    generatorSha256: string;
    subsets: Record<string, ManifestUtterance[]>;
}

/**
 * Deterministically choose `size` ids from `ids` using `seed`.
 *
 * Sorts first, so filesystem traversal order cannot change the result, and returns a sorted array so
 * a manifest diff is readable. A pool smaller than `size` returns the whole pool.
 */
export function seededSample(ids: readonly string[], size: number, seed: string): string[];

/**
 * Where a LibriSpeech utterance's audio lives, RELATIVE to the corpus root. Returns `null` for an id
 * that is not three numeric components — a malformed id must be rejected, not turned into a
 * path-shaped string for a file that cannot exist.
 */
export function flacPathForId(set: string, id: string): string | null;

/** Bind ids to their real audio: existence, byte count and SHA-256. Missing audio is a failure. */
export function collectSelection(
    root: string,
    set: string,
    ids: readonly string[],
    references: ReadonlyMap<string, string>,
):
    | { ok: true; utterances: ManifestUtterance[] }
    | { ok: false; reason: BuildFailureReason; detail: string };

/**
 * Build the manifest object. `archives` must come from REAL pinned verification — the CLI obtains it
 * by running the verifier and has no other way to obtain it.
 */
export function buildManifest(args: {
    root: string;
    archives: CorpusManifest['archives'];
    sets?: readonly string[];
    subsetSize?: number;
    seed?: string;
}): { ok: true; manifest: CorpusManifest } | { ok: false; reason: BuildFailureReason; detail: string };
