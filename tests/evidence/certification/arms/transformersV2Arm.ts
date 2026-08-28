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
import {
    resolveDecodeRoute,
    routeHash,
    type DecodeRoute,
} from '../../../../frontend/src/services/transcription/decodeRoute';
import { buildShippingDecodeOptions } from '../../../../frontend/src/services/transcription/decodeOptions';
import type { ArmProvenance, DecodeArm } from '../engineArm';

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
    /** `whisper-base.en` / `whisper-tiny.en` — the directory name under the product's models root. */
    localModelId: string;
    /** The product's self-hosted models directory. Remote loading stays OFF. */
    modelsRoot: string;
    corpus: ArmProvenance['corpus'];
}

/**
 * Build the arm. The pipeline is created lazily on first decode so constructing an arm — which
 * certification does before any audio exists — costs nothing.
 */
export function createTransformersV2Arm(options: TransformersV2ArmOptions): DecodeArm & { dispose(): void } {
    const modelDir = join(options.modelsRoot, options.localModelId);
    let transcriber: ((audio: Float32Array, opts: Record<string, unknown>) => Promise<unknown>) | null = null;
    let libraryVersion = 'unknown';
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
        env.allowLocalModels = true;
        env.allowRemoteModels = false;
        env.localModelPath = options.modelsRoot;
        libraryVersion =
            (transformers as unknown as { env?: { version?: string } }).env?.version ?? 'unpinned';
        transcriber = (await pipeline('automatic-speech-recognition', options.localModelId, {
            quantized: true,
        })) as typeof transcriber;
        return transcriber;
    };

    return {
        id: `transformers-v2:${options.localModelId}`,

        declareRoute(audioSeconds: number): DecodeRoute {
            // From the shipping module. Not re-derived here — that is the whole point of the gate.
            return resolveDecodeRoute('v2', options.localModelId, audioSeconds);
        },

        async decode(audio: Float32Array, audioSeconds: number): Promise<string | null> {
            const run = await load();
            if (!run) return null;
            const started = Date.now();
            // The SAME builder the v2 worker uses. Any divergence would show up in the route hash.
            const result = await run(audio, { ...buildShippingDecodeOptions(audioSeconds) });
            wallClockMs += Date.now() - started;
            peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
            const text = typeof result === 'string' ? result : (result as { text?: string })?.text;
            const trimmed = (text ?? '').trim();
            // An empty decode is a RESULT. Returning null lets the seam name it rather than scoring a
            // silent blank as a total miss.
            return trimmed.length === 0 ? null : trimmed;
        },

        provenance(): ArmProvenance {
            const probeSeconds = 4.2;
            const route = resolveDecodeRoute('v2', options.localModelId, probeSeconds);
            return {
                model: {
                    id: options.localModelId,
                    // The product serves these files itself; the directory contents ARE the revision.
                    revision: `self-hosted:${options.localModelId}`,
                    filesSha256: hashModelDirectory(modelDir),
                },
                runtime: { library: '@xenova/transformers', version: libraryVersion, backend: 'onnxruntime-node' },
                assets: {
                    source: modelDir,
                    // These are literally the product's own asset files, read from the app's models
                    // directory with remote loading disabled — not a copy that resembles them.
                    verdict: 'identical',
                },
                device: {
                    platform: platform(),
                    arch: arch(),
                    cpuModel: cpus()[0]?.model ?? 'unknown',
                    cores: cpus().length,
                },
                route: { hash: routeHash(route), route },
                corpus: options.corpus,
                resources: { wallClockMs: Math.max(1, wallClockMs), peakRssBytes },
            };
        },

        dispose() { transcriber = null; },
    };
}
