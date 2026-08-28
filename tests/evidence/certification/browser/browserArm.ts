/**
 * #1304 Task 3C — a browser page, presented as a `DecodeArm`.
 *
 * WHY THIS EXISTS. The browser lane used to run its own decode-and-score loop: load a model, transcribe
 * every clip inside one `page.evaluate`, then score the results itself. That is a SECOND execution
 * path, and a second path is a second set of rules — it derived its own expected-id list from the
 * clips it happened to receive, so a missing clip could never be detected.
 *
 * Wrapping the page as an ordinary arm puts both lanes on `runArm`: the same certification, the same
 * frozen-manifest completeness check, the same refusal to emit a row without complete provenance. The
 * page keeps the loaded model between calls, so per-clip round trips cost a message, not a reload.
 */
import type { Page } from '@playwright/test';
import { candidateRouteHash, type CandidateRoute } from '../candidateRoute';
import type { ArmProvenance, DecodeArm, RouteHonorReport } from '../engineArm';
import type { AssetRecord } from './server';

export interface BrowserBackendEvidence {
    wasmInstantiations: number;
    wasmBytes: number;
    gpuAdapterRequests: number;
    gpuDevicesCreated: number;
    gpuComputePipelines: number;
    gpuQueueSubmits: number;
    gpuAdapterInfo: Record<string, string | null> | null;
    gpuAvailable: boolean;
}

/** Software rasterizers implement WebGPU faithfully and run on the CPU. Proven ≠ representative. */
const SOFTWARE_ADAPTERS = ['swiftshader', 'llvmpipe', 'software', 'microsoft basic'];
export const isSoftwareAdapter = (info: Record<string, string | null> | null): boolean => {
    const text = Object.values(info ?? {}).filter(Boolean).join(' ').toLowerCase();
    return SOFTWARE_ADAPTERS.some((name) => text.includes(name));
};

/**
 * Decide what backend actually ran, from COUNTED WORK.
 *
 * Never from the requested device: `device: 'webgpu'` is accepted in Node where `navigator.gpu` does
 * not exist, and a transcript comes out anyway.
 */
export function resolveBrowserBackend(
    evidence: BrowserBackendEvidence,
): { resolved: string | null; proves: 'wasm' | 'webgpu' | null } {
    const gpuRan = evidence.gpuDevicesCreated > 0
        && evidence.gpuComputePipelines > 0
        && evidence.gpuQueueSubmits > 0;
    if (gpuRan) {
        const info = evidence.gpuAdapterInfo;
        const label = info
            ? `webgpu:${info.vendor ?? '?'}/${info.architecture ?? info.device ?? '?'}`
            : 'webgpu';
        return { resolved: label, proves: 'webgpu' };
    }
    if (evidence.wasmInstantiations > 0 && evidence.gpuDevicesCreated === 0) {
        return { resolved: `wasm:${evidence.wasmInstantiations} module(s)`, proves: 'wasm' };
    }
    return { resolved: null, proves: null };
}

export interface BrowserArmOptions {
    id: string;
    page: Page;
    route: (audioSeconds: number) => CandidateRoute;
    /** 'wasm' or 'webgpu' — the browser has no other backends. */
    deviceClaim: 'wasm' | 'webgpu';
    modelId: string;
    modelRevision: string;
    /** Digests of every asset the mirror served, so provenance names the bytes that ran. */
    assets: Record<string, AssetRecord>;
    assetsSource: string;
    assetsVerdict: ArmProvenance['assets']['verdict'];
    runtimeLibrary: string;
    runtimeVersion: string;
    device: ArmProvenance['device'];
    corpus: ArmProvenance['corpus'];
}

export function createBrowserArm(options: BrowserArmOptions): DecodeArm {
    let wallClockMs = 0;
    // The BROWSER's peak RSS is not observable from here. Reported as 0 and never dressed up as a
    // measurement — a fabricated resource figure is the same class of claim as a fabricated WER.
    const peakRssBytes = 0;

    const transcribe = async (locator: string, audioSeconds: number) => {
        const result = await options.page.evaluate(
            async (input) => {
                const w = window as unknown as {
                    __asr: (audio: Float32Array, opts: Record<string, unknown>) => Promise<unknown>;
                    __decodeAudio: (url: string) => Promise<{ samples: Float32Array; seconds: number }>;
                    __BACKEND_EVIDENCE__: Record<string, unknown>;
                };
                const audio = await w.__decodeAudio(input.locator);
                const started = performance.now();
                const result = await w.__asr(audio.samples, input.generation);
                const text = typeof result === 'string' ? result : (result as { text?: string })?.text ?? null;
                const chunks = (result as { chunks?: { timestamp?: unknown }[] })?.chunks;
                return {
                    text,
                    samples: audio.samples.length,
                    elapsedMs: performance.now() - started,
                    hasTimestampChunks: Array.isArray(chunks) && chunks.length > 0 && Array.isArray(chunks[0]?.timestamp),
                    evidence: w.__BACKEND_EVIDENCE__ as unknown as BrowserBackendEvidence,
                };
            },
            { locator, generation: generationFor(options.route(audioSeconds)) },
        );
        // CROSS-CHECK the page's decode against the count Node computed from the same file. The page
        // decodes FLAC through `decodeAudioData`, which RESAMPLES to the context rate — so a wrong-rate
        // source would be converted silently and the browser arm would score different audio than the
        // Node arm while both looked healthy.
        const expectedSamples = Math.round(audioSeconds * 16000);
        if (Math.abs(result.samples - expectedSamples) > 1) {
            throw new Error(
                `audio_decode_divergence: browser produced ${result.samples} samples, Node ${expectedSamples}`,
            );
        }
        return result;
    };

    return {
        id: options.id,

        declareRoute: options.route,

        async decode(locator: string, audioSeconds: number): Promise<string | null> {
            const result = await transcribe(locator, audioSeconds);
            wallClockMs += Math.round(result.elapsedMs);
            const trimmed = (result.text ?? '').trim();
            return trimmed.length === 0 ? null : trimmed;
        },

        async probeRouteHonored(locator: string, audioSeconds: number): Promise<RouteHonorReport> {
            const route = options.route(audioSeconds);
            const requested = route.family === 'whisper' ? route.decode.return_timestamps : false;
            const result = await transcribe(locator, audioSeconds);
            const { resolved, proves } = resolveBrowserBackend(result.evidence);
            return {
                timestampsRequested: requested,
                timestampsReturned: result.hasTimestampChunks,
                deviceRequested: options.deviceClaim,
                deviceClaim: options.deviceClaim,
                deviceResolved: resolved,
                // The claim holds only if the counted work proves THIS backend.
                deviceVerifiable: proves === options.deviceClaim,
                detail: resolved
                    ? `${resolved}${proves === 'webgpu' && isSoftwareAdapter(result.evidence.gpuAdapterInfo)
                        ? ' — SOFTWARE rasterizer: compatibility proven, performance NOT'
                        : ''}`
                    : 'no counted work proves any backend',
            };
        },

        provenance(): ArmProvenance {
            const route = options.route(4.2);
            return {
                model: {
                    id: options.modelId,
                    revision: options.modelRevision,
                    // Every asset the mirror served, by digest, pin-checked before it was served.
                    filesSha256: Object.fromEntries(
                        Object.entries(options.assets).map(([path, record]) => [path, record.sha256]),
                    ),
                },
                runtime: { library: options.runtimeLibrary, version: options.runtimeVersion, backend: options.deviceClaim },
                assets: { source: options.assetsSource, verdict: options.assetsVerdict },
                device: options.device,
                route: { hash: candidateRouteHash(route), route },
                corpus: options.corpus,
                resources: { wallClockMs: Math.max(1, wallClockMs), peakRssBytes: Math.max(1, peakRssBytes) },
            };
        },
    };
}

/** Generation options for a route — each family's own, never one family's options on the other. */
export function generationFor(route: CandidateRoute): Record<string, unknown> {
    return route.family === 'moonshine'
        ? { max_new_tokens: route.maxNewTokens }
        : {
              chunk_length_s: route.decode.chunk_length_s,
              stride_length_s: route.decode.stride_length_s,
              return_timestamps: route.decode.return_timestamps,
          };
}
