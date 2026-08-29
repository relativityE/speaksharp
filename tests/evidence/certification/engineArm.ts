/**
 * #1304 Task 3C — what a MODEL ARM must provide to be measurable.
 *
 * Deliberately narrow. An arm supplies three things: the route it will decode on, a decode, and its
 * provenance. It does NOT supply a score, an aggregate, or a WER — those come from the certified path
 * alone, so an arm cannot report a number about itself. Both retired harnesses computed their own
 * averages, which is how a mean over surviving rows came to be published as a benchmark.
 */
import type { CandidateRoute } from './candidateRoute';

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
    route: { hash: string; route: CandidateRoute };
    /**
     * Corpus: which frozen corpus — by version, archive digests, AND a digest of the exact selection.
     *
     * The version alone cannot distinguish a coherently shrunken manifest from the real one.
     */
    corpus: { version: string; digest: string; archives: Record<string, string> };
    /**
     * Resources: what the run cost, so a cheap-and-fast arm is distinguishable from a slow one.
     *
     * `peakRssBytes` is NULLABLE on purpose. A browser page cannot report it, and coercing that to 0 or
     * 1 would present an absence as a measurement — the same class of claim as a fabricated WER.
     */
    resources: { wallClockMs: number; peakRssBytes: number | null };
}

/**
 * Was the declared route actually HONOURED by the runtime?
 *
 * WHY THIS EXISTS, discovered by running it. `@huggingface/transformers` accepts
 * `return_timestamps: true` for Moonshine and returns a perfectly ordinary transcript — with no
 * `chunks` key at all, because Moonshine has no timestamp tokens. It does not throw, warn, or
 * indicate in any way that the option was dropped. It likewise accepts `device: 'webgpu'` in Node,
 * where `navigator.gpu` does not exist, and produces output anyway.
 *
 * A route gate that compares DECLARED options would pass both. Declaring a setting and having it
 * applied are different facts, and only the second one is evidence.
 */
export interface RouteHonorReport {
    timestampsRequested: boolean;
    /** Proven by the decode itself carrying timestamped chunks — not by the option being accepted. */
    timestampsReturned: boolean;
    deviceRequested: string;
    /**
     * WHAT THIS ARM CLAIMS ABOUT ITS BACKEND.
     *
     *   'none'   — an ACCURACY arm. It measures what a model transcribes and asserts nothing about
     *              which execution provider ran. Its row is not device evidence and says so.
     *   'wasm' / 'webgpu' — a DEVICE arm. It claims a specific backend, and must prove it.
     *
     * Separating the two is what stops a Node run from being read as a browser result. It is also why
     * "Node cannot run WASM" is not a rejection of the WASM cell: the cell is PENDING a browser arm,
     * and the accuracy question is answered separately.
     */
    deviceClaim: 'none' | 'wasm' | 'webgpu';
    /**
     * The backend the runtime REPORTS having used — not the one that was asked for.
     *
     * Echoing the request back is not evidence: `device: 'webgpu'` is accepted in Node, where
     * `navigator.gpu` does not exist, and a transcript comes out anyway. Worse, neither
     * `@xenova/transformers` nor `@huggingface/transformers` exposes execution providers on a loaded
     * session in Node — inspected directly, the handler carries only input/output names and metadata.
     * So in Node this is ALWAYS null, which is exactly why no Node arm may claim a device.
     */
    deviceResolved: string | null;
    /** False when the runtime cannot demonstrate the requested device is the one that ran. */
    deviceVerifiable: boolean;
    detail: string;
}

export interface DecodeArm {
    /** Stable identifier for the arm. Appears on every row it produces. */
    id: string;
    /**
     * The route this arm WILL take for audio of the given length — declared BEFORE decoding, so parity
     * can be checked without running the model. An arm that reported its route afterwards could report
     * whatever made it comparable.
     */
    declareRoute(audioSeconds: number): CandidateRoute;
    /**
     * Decode ONE clip, addressed by a LOCATOR the arm knows how to resolve — a file path in Node, a URL
     * in the browser.
     *
     * It used to take a `Float32Array`, which forced the caller to load the audio and made the browser
     * lane unable to use the certified path at all: samples cannot be shipped into a page per clip
     * without absurd cost, so that lane grew its own decode-and-score loop and drifted. One contract
     * both lanes can satisfy is what keeps them on one path.
     *
     * Returns the transcript, or null when the arm produced nothing — a result, not an error.
     */
    decode(locator: string, audioSeconds: number): Promise<string | null>;
    /**
     * Run ONE short decode and report whether the runtime honoured the declared route. REQUIRED, not
     * optional: an optional method is one an arm can skip, and skipping is how a divergence gets past
     * a gate without anybody choosing to let it.
     */
    probeRouteHonored(locator: string, audioSeconds: number): Promise<RouteHonorReport>;

    /** Everything needed to know what produced the numbers. */
    provenance(): ArmProvenance;
}
