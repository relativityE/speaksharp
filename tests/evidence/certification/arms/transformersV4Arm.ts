/**
 * #1304 Task 3C — v4 arms (`@huggingface/transformers`), across the dtype and device matrix.
 *
 * TWO THINGS THIS RUNTIME DOES SILENTLY, both found by running it rather than by reading the docs:
 *
 *   1. In Node it does NOT support `device: 'wasm'` — the supported set is `coreml`, `webgpu`, `cpu`.
 *      The browser ships WASM. So a Node harness cannot reproduce the product's WASM backend at all,
 *      and an arm that claims to has substituted a different execution provider.
 *   2. It ACCEPTS `device: 'webgpu'` in Node, where `navigator.gpu` does not exist, and returns a
 *      transcript anyway. The device claim is therefore unverifiable, not merely unusual.
 *
 * Neither of those is reported by the library. Both are surfaced here instead of being inherited.
 */
import { createHash } from 'node:crypto';
import { cpus, arch, platform } from 'node:os';
import { resolveWhisperRoute, candidateRouteHash, type CandidateRoute } from '../candidateRoute';
import { installedVersion, readSessionProviders } from './backend';

/** Read, not guessed: a provenance row that cannot name its runtime is not provenance. */
const HF_VERSION = installedVersion('@huggingface/transformers') ?? '';
import { buildShippingDecodeOptions } from '../../../../frontend/src/services/transcription/decodeOptions';
import type { PRIV_STT_V4_VARIANTS } from '../../../../frontend/src/services/transcription/sttConstants';
import type { ArmProvenance, DecodeArm, RouteHonorReport } from '../engineArm';


export type V4Device = 'cpu' | 'wasm' | 'webgpu' | 'coreml';

export interface TransformersV4ArmOptions {
    id: string;
    modelId: string;
    dtype: Record<string, string>;
    device: V4Device;
    /** Only for a dtype combination the PRODUCT registry actually ships, so parity includes it. */
    variantId?: keyof typeof PRIV_STT_V4_VARIANTS;
    corpus: ArmProvenance['corpus'];
}

/** WebGPU is a browser API. Its absence is what makes a `device: 'webgpu'` claim unverifiable here. */
const webgpuPresent = (): boolean =>
    typeof (globalThis as { navigator?: { gpu?: unknown } }).navigator?.gpu !== 'undefined'
    && (globalThis as { navigator?: { gpu?: unknown } }).navigator?.gpu !== undefined;

export function createTransformersV4Arm(options: TransformersV4ArmOptions): DecodeArm {
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
            device: options.device,
        })) as typeof pipe;
        return pipe;
    };

    const runRaw = async (audio: Float32Array, audioSeconds: number): Promise<unknown> => {
        const run = await load();
        if (!run) throw new Error('pipeline unavailable');
        const started = Date.now();
        // The shipping builder, unmodified — the same source the v2 worker and v4 engine both use.
        const result = await run(audio, { ...buildShippingDecodeOptions(audioSeconds) });
        wallClockMs += Date.now() - started;
        peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
        return result;
    };

    return {
        id: options.id,

        declareRoute(audioSeconds: number): CandidateRoute {
            // `variantId` is passed ONLY for a combination the product registry ships. For an
            // exploratory dtype there is no shipping counterpart, so claiming parity with one would be
            // claiming parity with something that does not exist; the dtype travels in provenance.
            return resolveWhisperRoute('v4', options.modelId, audioSeconds, options.variantId);
        },

        async decode(audio: Float32Array, audioSeconds: number): Promise<string | null> {
            const result = await runRaw(audio, audioSeconds);
            const text = typeof result === 'string' ? result : (result as { text?: string })?.text;
            const trimmed = (text ?? '').trim();
            return trimmed.length === 0 ? null : trimmed;
        },

        async probeRouteHonored(audio: Float32Array, audioSeconds: number): Promise<RouteHonorReport> {
            const requested = buildShippingDecodeOptions(audioSeconds).return_timestamps;
            const result = await runRaw(audio, audioSeconds);
            const chunks = (result as { chunks?: { timestamp?: unknown }[] })?.chunks;
            // `cpu` in Node is an ACCURACY stand-in and claims no device. `webgpu`/`wasm` are device
            // claims, and in Node they cannot be substantiated: navigator.gpu does not exist, and the
            // loaded session exposes no execution providers to read.
            const deviceClaim: 'none' | 'wasm' | 'webgpu' =
                options.device === 'webgpu' ? 'webgpu' : options.device === 'wasm' ? 'wasm' : 'none';
            const resolved = readSessionProviders(pipe);
            return {
                timestampsRequested: requested,
                timestampsReturned: Array.isArray(chunks) && chunks.length > 0 && Array.isArray(chunks[0]?.timestamp),
                deviceRequested: options.device,
                deviceClaim,
                deviceResolved: resolved,
                deviceVerifiable: deviceClaim === 'none' ? true : webgpuPresent() && resolved !== null,
                detail: deviceClaim === 'none'
                    ? `@huggingface/transformers device=${options.device} — accuracy only, not device evidence`
                    : `device=${options.device} requested; navigator.gpu ${webgpuPresent() ? 'present' : 'ABSENT'}; `
                      + `session providers ${resolved ?? 'unreadable'} — a request the runtime will not confirm`,
            };
        },

        provenance(): ArmProvenance {
            const route = resolveWhisperRoute('v4', options.modelId, 4.2, options.variantId);
            return {
                model: {
                    id: options.modelId,
                    // The dtype is part of WHICH MODEL ran: a q4 decoder and an fp32 decoder are
                    // different artifacts under one repository name.
                    revision: `hf:${options.modelId}#${createHash('sha256').update(JSON.stringify(options.dtype)).digest('hex').slice(0, 12)}`,
                    filesSha256: { 'dtype-scheme': createHash('sha256').update(JSON.stringify(options.dtype)).digest('hex') },
                },
                runtime: { library: '@huggingface/transformers', version: libraryVersion, backend: options.device },
                assets: {
                    source: `huggingface:${options.modelId}`,
                    // Downloaded from HuggingFace, NOT the product's self-hosted copies. Whether they
                    // are byte-identical to what the app would serve is not established here, and
                    // saying `identical` would be asserting something unmeasured.
                    verdict: 'unverifiable',
                },
                device: { platform: platform(), arch: arch(), cpuModel: cpus()[0]?.model ?? 'unknown', cores: cpus().length },
                route: { hash: candidateRouteHash(route), route },
                corpus: options.corpus,
                resources: { wallClockMs: Math.max(1, wallClockMs), peakRssBytes },
            };
        },
    };
}
