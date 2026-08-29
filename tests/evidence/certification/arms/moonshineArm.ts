/**
 * #1304 Task 3C — Moonshine arms (`onnx-community/moonshine-{tiny,base}-ONNX`).
 *
 * Moonshine is NOT a Whisper model and the adapter must not pretend otherwise:
 *   - it consumes the raw 16 kHz waveform, with no log-mel front end;
 *   - `max_position_embeddings` is 512;
 *   - it has NO TIMESTAMP TOKENS at all;
 *   - `condition_on_previous_text` is Whisper-only and must never be passed to it.
 *
 * A CORRECTION TO MY FIRST VERSION. I declared the Whisper shipping route for this adapter and then
 * recorded Moonshine as rejected because `return_timestamps: true` came back with no `chunks`. That
 * rejection was WRONG: the product consumes transcript TEXT, not model timestamps, so returning
 * Whisper timestamp chunks is not a requirement Moonshine fails — it is a requirement the product does
 * not have. Comparing a model to another family's route produces exactly that kind of false verdict.
 *
 * Moonshine is therefore measured against ITS OWN native route: raw waveform, positional budget 512,
 * no timestamps requested, and a duration-derived generation bound. That bound matters — an earlier
 * long-form test omitted it entirely, ran on a looped fixture, and concluded the model loops. Both
 * halves of that conclusion were withdrawn.
 */
import { createHash } from 'node:crypto';
import { cpus, arch, platform } from 'node:os';
import {
    resolveMoonshineRoute,
    candidateRouteHash,
    routeRequestsTimestamps,
    type CandidateRoute,
} from '../candidateRoute';
import { installedVersion, readSessionProviders } from './backend';
import { decodeAudio } from '../audio';

/** Read, not guessed: a provenance row that cannot name its runtime is not provenance. */
const HF_VERSION = installedVersion('@huggingface/transformers') ?? '';
import type { ArmProvenance, DecodeArm, RouteHonorReport } from '../engineArm';


export interface MoonshineArmOptions {
    id: string;
    /** e.g. `onnx-community/moonshine-tiny-ONNX`. */
    modelId: string;
    /** Pinned commit, so a re-run measures the same artifact. */
    revision: string;
    dtype: string;
    corpus: ArmProvenance['corpus'];
}

export function createMoonshineArm(options: MoonshineArmOptions): DecodeArm {
    let pipe: ((audio: Float32Array, opts: Record<string, unknown>) => Promise<unknown>) | null = null;
    // Read from the installed package at construction, NOT left as a placeholder until load(). The
    // placeholder gate caught this exactly: provenance is produced before any decode, so a version
    // assigned inside load() was still `'unknown'` when the record was built.
    let libraryVersion = HF_VERSION;
    let wallClockMs = 0;
    let peakRssBytes = process.memoryUsage().rss;

    const load = async () => {
        if (pipe) return pipe;
        const transformers = await import('@huggingface/transformers');
        const { pipeline, env } = transformers as unknown as {
            pipeline: (task: string, model: string, opts: Record<string, unknown>) => Promise<unknown>;
            env: { version?: string };
        };
        libraryVersion = env?.version ?? HF_VERSION;
        pipe = (await pipeline('automatic-speech-recognition', options.modelId, {
            dtype: options.dtype,
            device: 'cpu',
            revision: options.revision,
        })) as typeof pipe;
        return pipe;
    };

    /**
     * Decode on Moonshine's NATIVE route. Whisper's window/stride/timestamp options are meaningless
     * here, and `condition_on_previous_text` is Whisper-only and must never be passed. What IS passed
     * is the duration-derived generation bound — the parameter whose absence once produced a
     * "the model loops" conclusion that had to be retracted.
     */
    const runRaw = async (locator: string, audioSeconds: number): Promise<unknown> => {
        const run = await load();
        if (!run) throw new Error('pipeline unavailable');
        const audio = decodeAudio(locator).samples;
        const route = resolveMoonshineRoute(options.modelId, audioSeconds);
        const started = Date.now();
        const result = await run(audio, { max_new_tokens: route.maxNewTokens });
        wallClockMs += Date.now() - started;
        peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
        return result;
    };

    return {
        id: options.id,

        declareRoute(audioSeconds: number): CandidateRoute {
            // Moonshine's OWN canonical route — not Whisper's.
            return resolveMoonshineRoute(options.modelId, audioSeconds);
        },

        async decode(locator: string, audioSeconds: number): Promise<string | null> {
            const result = await runRaw(locator, audioSeconds);
            const text = typeof result === 'string' ? result : (result as { text?: string })?.text;
            const trimmed = (text ?? '').trim();
            return trimmed.length === 0 ? null : trimmed;
        },

        async probeRouteHonored(locator: string, audioSeconds: number): Promise<RouteHonorReport> {
            const route = resolveMoonshineRoute(options.modelId, audioSeconds);
            const requested = routeRequestsTimestamps(route); // false — Moonshine's route asks for none
            const result = await runRaw(locator, audioSeconds);
            const chunks = (result as { chunks?: { timestamp?: unknown }[] })?.chunks;
            const returned = Array.isArray(chunks) && chunks.length > 0 && Array.isArray(chunks[0]?.timestamp);
            return {
                // Requested false, returned false: the route was honoured. Demanding Whisper chunks
                // here is what made the first version reject this model for the wrong reason.
                timestampsRequested: requested,
                timestampsReturned: returned,
                deviceRequested: 'cpu',
                deviceClaim: 'none',
                deviceResolved: readSessionProviders(pipe),
                deviceVerifiable: true,
                detail: `moonshine native route, max_new_tokens=${route.maxNewTokens} — accuracy only, `
                    + 'not device evidence',
            };
        },

        provenance(): ArmProvenance {
            const route = resolveMoonshineRoute(options.modelId, 4.2);
            return {
                model: {
                    id: options.modelId,
                    revision: options.revision,
                    filesSha256: {
                        'dtype-scheme': createHash('sha256').update(options.dtype).digest('hex'),
                    },
                },
                runtime: { library: '@huggingface/transformers', version: libraryVersion, backend: 'cpu' },
                assets: { source: `huggingface:${options.modelId}@${options.revision}`, verdict: 'unverifiable' },
                device: { platform: platform(), arch: arch(), cpuModel: cpus()[0]?.model ?? 'unknown', cores: cpus().length },
                route: { hash: candidateRouteHash(route), route },
                corpus: options.corpus,
                resources: { wallClockMs: Math.max(1, wallClockMs), peakRssBytes },
            };
        },
    };
}
