/**
 * #1304 Task 3C — what a MODEL ARM must provide to be measurable.
 *
 * Deliberately narrow. An arm supplies three things: the route it will decode on, a decode, and its
 * provenance. It does NOT supply a score, an aggregate, or a WER — those come from the certified path
 * alone, so an arm cannot report a number about itself. Both retired harnesses computed their own
 * averages, which is how a mean over surviving rows came to be published as a benchmark.
 */
import type { DecodeRoute } from '../../../frontend/src/services/transcription/decodeRoute';

/** Complete provenance for one arm. Every field is required; an absent one produces no selection row. */
export interface ArmProvenance {
    /** Model identity: what was loaded, at which revision, and the digest of the weights actually read. */
    model: { id: string; revision: string; filesSha256: Record<string, string> };
    /** Runtime: the inference stack and version that executed the decode. */
    runtime: { library: string; version: string; backend: string };
    /** Assets: where the weights came from, and whether they matched the product's own copies. */
    assets: { source: string; verdict: 'identical' | 'differs' | 'unverifiable' };
    /** Device: the machine the numbers were produced on. Two arms on different hardware are comparable
     *  for WER but not for latency, and a row that cannot say which is not evidence. */
    device: { platform: string; arch: string; cpuModel: string; cores: number };
    /** Route: the resolved decode configuration and its identity hash. */
    route: { hash: string; route: DecodeRoute };
    /** Corpus: which frozen corpus, by version and archive digest. */
    corpus: { version: string; archives: Record<string, string> };
    /** Resources: what the run cost, so a cheap-and-fast arm is distinguishable from a slow one. */
    resources: { wallClockMs: number; peakRssBytes: number };
}

export interface DecodeArm {
    /** Stable identifier for the arm. Appears on every row it produces. */
    id: string;
    /**
     * The route this arm WILL take for audio of the given length — declared BEFORE decoding, so parity
     * can be checked without running the model. An arm that reported its route afterwards could report
     * whatever made it comparable.
     */
    declareRoute(audioSeconds: number): DecodeRoute;
    /** Decode. Returns the transcript, or null when the arm produced nothing — a result, not an error. */
    decode(audio: Float32Array, audioSeconds: number): Promise<string | null>;
    /** Everything needed to know what produced the numbers. */
    provenance(): ArmProvenance;
}
