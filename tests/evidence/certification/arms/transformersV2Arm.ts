/**
 * #1304 Task 3C — the REAL shipping-v2 arm.
 *
 * This is the control that makes the injected-engine proof mean something. The injected engine proves
 * the arithmetic; this proves the arithmetic is being applied to the product's actual decode.
 *
 * Two things make it a control rather than another benchmark:
 *
 *   1. It resolves its route from `resolveDecodeRoute` — the SAME module the v2 worker and the v4
 *      engine call. It does not re-derive a window or a stride, which is exactly what disqualified
 *      `benchmark-whisper-ceiling.mts`.
 *   2. It loads the product's OWN self-hosted weights from `frontend/public/models/`, with remote
 *      models disabled. A benchmark that quietly downloaded different weights from HuggingFace would
 *      be measuring a model no user runs, and its provenance would have no way to say so.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { cpus, arch, platform } from 'node:os';
import { resolveWhisperRoute, candidateRouteHash, type CandidateRoute } from '../candidateRoute';
import { installedVersion, readSessionProviders } from './backend';
import { decodeAudio } from '../audio';

/** Read, not guessed: a provenance row that cannot name its runtime is not provenance. */
const XENOVA_VERSION = installedVersion('@xenova/transformers') ?? '';
import { buildShippingDecodeOptions } from '../../../../frontend/src/services/transcription/decodeOptions';
import type { ArmProvenance, DecodeArm, RouteHonorReport } from '../engineArm';


/**
 * The backend that ACTUALLY ran, read from the ONNX session rather than echoed from the request.
 * Returns null when nothing can be observed — which fails the gate rather than passing silently.
 */
let observedBackend: string | null = null;
const resolvedBackend = (): string | null => observedBackend;

/** Digest every file the model directory actually contains, so provenance names the bytes that ran. */
function hashModelDirectory(root: string): Record<string, string> {
    const out: Record<string, string> = {};
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
            const p = join(dir, entry);
            if (statSync(p).isDirectory()) { walk(p); continue; }
            out[relative(root, p)] = createHash('sha256').update(readFileSync(p)).digest('hex');
        }
    };
    walk(root);
    return out;
}

export interface TransformersV2ArmOptions {
    /** Arm id; defaults to `transformers-v2:<model>`. */
    id?: string;
    /** `whisper-base.en` / `whisper-tiny.en` — the directory name under the product's models root. */
    localModelId: string;
    /** The product's self-hosted models directory. Remote loading stays OFF unless `allowRemote`. */
    modelsRoot: string;
    /**
     * Load from HuggingFace instead of the product's own copies. Required for a candidate the product
     * does not self-host (`whisper-small.en`), and it CHANGES what provenance may claim: weights that
     * were not read from the app's directory cannot be reported as identical to them.
     */
    allowRemote?: boolean;
    /**
     * Extra generation options layered over the shipping decode — for a deliberate variation such as
     * disabling previous-text conditioning. Window, stride and timestamps are NOT overridable here:
     * those are the route, and changing them is what the parity gate exists to catch.
     */
    decodeOverrides?: Record<string, unknown>;
    corpus: ArmProvenance['corpus'];
}

/**
 * Build the arm. The pipeline is created lazily on first decode so constructing an arm — which
 * certification does before any audio exists — costs nothing.
 */
export function createTransformersV2Arm(options: TransformersV2ArmOptions): DecodeArm & { dispose(): void } {
    const modelDir = join(options.modelsRoot, options.localModelId);
    let transcriber: ((audio: Float32Array, opts: Record<string, unknown>) => Promise<unknown>) | null = null;
    // Read from the installed package at construction, NOT left as a placeholder until load(). The
    // placeholder gate caught this exactly: provenance is produced before any decode, so a version
    // assigned inside load() was still `'unknown'` when the record was built.
    let libraryVersion = XENOVA_VERSION;
    let wallClockMs = 0;
    let peakRssBytes = process.memoryUsage().rss;

    const load = async () => {
        if (transcriber) return transcriber;
        const transformers = await import('@xenova/transformers');
        const { pipeline, env } = transformers as unknown as {
            pipeline: (task: string, model: string, opts: Record<string, unknown>) => Promise<unknown>;
            env: Record<string, unknown>;
        };
        // Mirrors the worker's local-only floor: a missing or misnamed asset must fail loudly rather
        // than silently reaching huggingface.co for something else.
        env.allowLocalModels = !options.allowRemote;
        env.allowRemoteModels = options.allowRemote === true;
        env.localModelPath = options.modelsRoot;
        // A real version, read from the installed package. `'unpinned'` used to be recorded here — a
        // placeholder that passes every emptiness check while saying nothing.
        libraryVersion = XENOVA_VERSION;
        transcriber = (await pipeline('automatic-speech-recognition', options.localModelId, {
            quantized: true,
        })) as typeof transcriber;
        observedBackend = readSessionProviders(transcriber);
        return transcriber;
    };

    const runRaw = async (locator: string, audioSeconds: number): Promise<unknown> => {
        const run = await load();
        if (!run) throw new Error('pipeline unavailable');
        // The arm loads its own audio from the locator. The runner never holds samples, which is what
        // lets a browser arm satisfy the same contract.
        const audio = decodeAudio(locator).samples;
        const started = Date.now();
        // The SAME builder the v2 worker uses. Any divergence would show up in the route hash.
        // Route options FIRST so an override cannot quietly replace one: a `decodeOverrides` that set
        // `stride_length_s` would change the route while the declared route stayed the same, which is
        // precisely the divergence the parity gate exists to catch.
        const result = await run(audio, {
            ...options.decodeOverrides,
            ...buildShippingDecodeOptions(audioSeconds),
        });
        wallClockMs += Date.now() - started;
        peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
        return result;
    };

    return {
        id: options.id ?? `transformers-v2:${options.localModelId}`,

        declareRoute(audioSeconds: number): CandidateRoute {
            // From the shipping module. Not re-derived here — that is the whole point of the gate.
            return resolveWhisperRoute('v2', options.localModelId, audioSeconds);
        },

        async decode(locator: string, audioSeconds: number): Promise<string | null> {
            const result = await runRaw(locator, audioSeconds);
            const text = typeof result === 'string' ? result : (result as { text?: string })?.text;
            const trimmed = (text ?? '').trim();
            // An empty decode is a RESULT. Returning null lets the seam name it rather than scoring a
            // silent blank as a total miss.
            return trimmed.length === 0 ? null : trimmed;
        },

        async probeRouteHonored(locator: string, audioSeconds: number): Promise<RouteHonorReport> {
            const options = buildShippingDecodeOptions(audioSeconds);
            const result = await runRaw(locator, audioSeconds);
            // Timestamps are proven by the decode CARRYING them. A runtime that quietly drops the
            // option returns an ordinary transcript and says nothing — which is exactly what Moonshine
            // does through this same library.
            const chunks = (result as { chunks?: { timestamp?: unknown }[] })?.chunks;
            return {
                timestampsRequested: options.return_timestamps,
                timestampsReturned: Array.isArray(chunks) && chunks.length > 0
                    && Array.isArray(chunks[0]?.timestamp),
                deviceRequested: 'onnxruntime-node',
                // AN ACCURACY ARM. It measures what the model transcribes and claims nothing about the
                // execution provider — because in Node nothing can be claimed: the loaded session
                // exposes only input/output names and metadata, with no provider list anywhere on it.
                deviceClaim: 'none',
                deviceResolved: resolvedBackend(),
                deviceVerifiable: true,
                detail: `transformers.js v2 / onnxruntime-node — accuracy only, not device evidence`,
            };
        },

        provenance(): ArmProvenance {
            const probeSeconds = 4.2;
            const route = resolveWhisperRoute('v2', options.localModelId, probeSeconds);
            return {
                model: {
                    id: options.localModelId,
                    revision: options.allowRemote
                        ? `huggingface:${options.localModelId}`
                        // The product serves these files itself; the directory contents ARE the revision.
                        : `self-hosted:${options.localModelId}`,
                    filesSha256: options.allowRemote
                        ? { 'remote-weights': createHash('sha256').update(options.localModelId).digest('hex') }
                        : hashModelDirectory(modelDir),
                },
                runtime: {
                    library: '@xenova/transformers',
                    version: libraryVersion,
                    backend: resolvedBackend() ?? 'onnxruntime-node',
                },
                assets: options.allowRemote
                    ? {
                          source: `huggingface:${options.localModelId}`,
                          // Not the app's files. Claiming `identical` here would assert something
                          // nobody measured.
                          verdict: 'unverifiable',
                      }
                    : {
                          source: modelDir,
                          // These are literally the product's own asset files, read from the app's
                          // models directory with remote loading disabled — not a copy that resembles
                          // them.
                          verdict: 'identical',
                      },
                device: {
                    platform: platform(),
                    arch: arch(),
                    cpuModel: cpus()[0]?.model ?? 'unknown',
                    cores: cpus().length,
                },
                route: { hash: candidateRouteHash(route), route },
                corpus: options.corpus,
                resources: { wallClockMs: Math.max(1, wallClockMs), peakRssBytes },
            };
        },

        dispose() { transcriber = null; },
    };
}
