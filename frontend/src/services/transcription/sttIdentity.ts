/**
 * STT-IDENTITY-DIAG — consolidated, dev/test-only STT run identity.
 *
 * A human (or proof harness) watching a live session cannot otherwise tell WHICH engine/model is
 * running (v2 tiny vs v2 base vs experimental v4), how it was selected (default vs `?privateModel=` /
 * `?privateEngine=` override), its size, where it loaded from, device/backend, or release status.
 * This module assembles those already-published signals into ONE object so the dev/test badge and the
 * proof artifacts speak the same vocabulary (the reviewer's required field set).
 *
 * PURE + READ-ONLY: `buildSttIdentity` is a pure function of its inputs; `collectSttIdentityFromWindow`
 * reads existing globals/flags and never mutates state, transcripts, or behavior. It NEVER shows raw
 * model names to normal users — the consuming badge is gated behind an explicit debug flag, and
 * `userHidden` is true for Private.
 */
import { NOT_AVAILABLE, type Maybe } from './sttEvidence';
import { PRIV_STT_MODELS, PRIVATE_ENGINE_OVERRIDE_KEY } from './sttConstants';
import {
    resolvePrivateModel,
    resolvePrivateModelSource,
    isPrivateModelOverridden,
    type PrivateModelSelectionSource,
} from './utils/privateModelFlag';

export type SttMode = 'private' | 'cloud' | 'native';

/** Release disposition of the running engine/model (reviewer schema). */
export type SttReleaseStatus =
    | 'default'      // v2 base.en — the shipping default
    | 'fallback'     // v2 tiny.en — internal/emergency/faster fallback
    | 'override'     // explicitly selected non-default model/engine (test/dev)
    | 'experimental'; // v4 — off-flag, never user-facing

/** The fallback (non-default) Private model: kept internal/emergency only, never the user default. */
export const PRIVATE_FALLBACK_MODEL = 'whisper-tiny.en';
/** Models self-hosted under `public/models/` (load LOCAL, no Hugging Face at runtime). */
const SELF_HOSTED_MODELS = new Set(['whisper-base.en', 'whisper-tiny.en']);

/** A v4 runtime snapshot (subset of `__PRIVATE_V4_RUNTIME__`). Present only on a v4 run. */
export interface SttIdentityV4Input {
    resolvedDevice?: string;
    backend?: string;
    dtype?: Record<string, string>;
    modelId?: string;
    modelSource?: 'hf' | 'local';
    fallbackOccurred?: boolean;
    transformersVersion?: string;
    onnxRuntimeVersion?: string;
}

export interface SttIdentityInput {
    /** Active STT mode (from the runtime debug `serviceMode`). */
    mode?: string | null;
    /** Resolved Private v2 model key (from privateModelFlag). */
    privateModelKey?: string | null;
    /** How the model was selected this session. */
    modelSelectionSource?: PrivateModelSelectionSource | null;
    /** True when a non-default model was explicitly selected. */
    modelOverridden?: boolean | null;
    /** Approx download size (MB) for the resolved model. */
    approxMB?: number | null;
    /** Raw `?privateEngine=` / localStorage engine override value, if any. */
    engineOverride?: string | null;
    /** v4 runtime identity, present only when a v4 run published `__PRIVATE_V4_RUNTIME__`. */
    v4?: SttIdentityV4Input | null;
}

export interface SttIdentity {
    mode: Maybe<SttMode | string>;
    /** Provider/vendor family (e.g. 'transformers.js', 'assemblyai', 'web-speech-api'). */
    provider: Maybe<string>;
    /** Specific engine id: 'transformers-js' (v2) / 'transformers-js-v4' / 'assemblyai' / 'web-speech-api'. */
    engine: Maybe<string>;
    /** Whether the engine came from default routing or an explicit override. */
    engineSelection: 'default' | 'override';
    /** Model id/key actually running. */
    modelId: Maybe<string>;
    /** How the model was selected (default vs window flag vs URL). */
    selectionSource: Maybe<PrivateModelSelectionSource>;
    modelOverridden: Maybe<boolean>;
    approxMB: Maybe<number>;
    /** Where the model loaded from: bundled/self-hosted (local) vs downloaded (remote). */
    modelSource: Maybe<'local' | 'remote'>;
    resolvedDevice: Maybe<string>;
    backend: Maybe<string>;
    dtype: Maybe<string>;
    /** Whether the engine fell back from the requested device/engine (always surfaced). */
    fallbackOccurred: Maybe<boolean>;
    runtimeVersion: Maybe<string>;
    releaseStatus: Maybe<SttReleaseStatus>;
    /** True when this engine/model must never be shown to normal users (raw model names / v4). */
    userHidden: boolean;
}

function val<T>(v: T | null | undefined): Maybe<T> {
    return v === null || v === undefined ? NOT_AVAILABLE : v;
}

/** Pure: assemble the identity from fully-specified inputs (no globals). */
export function buildSttIdentity(input: SttIdentityInput): SttIdentity {
    const mode = input.mode ?? null;
    const isV4 = Boolean(input.v4);
    const engineOverridden = Boolean(input.engineOverride && input.engineOverride.trim().length > 0);

    let provider: string | null = null;
    let engine: string | null = null;
    let modelId: string | null = null;
    let modelSource: 'local' | 'remote' | null = null;
    let resolvedDevice: string | null = null;
    let backend: string | null = null;
    let dtype: string | null = null;
    let fallbackOccurred: boolean | null = null;
    let runtimeVersion: string | null = null;
    let releaseStatus: SttReleaseStatus | null = null;

    if (mode === 'private') {
        if (isV4) {
            const v4 = input.v4 as SttIdentityV4Input;
            provider = 'transformers.js (webgpu)';
            engine = 'transformers-js-v4';
            modelId = v4.modelId ?? null;
            modelSource = v4.modelSource === 'local' ? 'local' : v4.modelSource === 'hf' ? 'remote' : null;
            resolvedDevice = v4.resolvedDevice ?? null;
            backend = v4.backend ?? (v4.resolvedDevice === 'webgpu' ? 'webgpu' : null);
            dtype = v4.dtype && typeof v4.dtype === 'object'
                ? Object.entries(v4.dtype).map(([k, v]) => `${k}=${v}`).join(',')
                : null;
            fallbackOccurred = typeof v4.fallbackOccurred === 'boolean' ? v4.fallbackOccurred : false;
            runtimeVersion = [v4.transformersVersion, v4.onnxRuntimeVersion].filter(Boolean).join(' / ') || null;
            releaseStatus = 'experimental';
        } else {
            provider = 'transformers.js';
            engine = 'transformers-js';
            modelId = input.privateModelKey ?? null;
            modelSource = modelId && SELF_HOSTED_MODELS.has(modelId) ? 'local' : modelId ? 'remote' : null;
            resolvedDevice = 'cpu';
            backend = 'wasm';
            fallbackOccurred = false; // Private NEVER falls back to Cloud; no device fallback for v2.
            releaseStatus = input.modelOverridden
                ? 'override'
                : modelId === PRIV_STT_MODELS.DEFAULT
                    ? 'default'
                    : modelId === PRIVATE_FALLBACK_MODEL
                        ? 'fallback'
                        : 'override';
        }
    } else if (mode === 'cloud') {
        provider = 'assemblyai';
        engine = 'assemblyai';
        modelId = 'universal-streaming';
        modelSource = 'remote';
        resolvedDevice = 'cloud';
        fallbackOccurred = false;
        releaseStatus = 'default';
    } else if (mode === 'native') {
        provider = 'web-speech-api';
        engine = 'web-speech-api';
        modelId = 'browser-native';
        modelSource = 'remote'; // Chrome Web Speech sends audio to Google.
        resolvedDevice = 'browser';
        fallbackOccurred = false;
        releaseStatus = 'default';
    }

    return {
        mode: val(mode),
        provider: val(provider),
        engine: val(engine),
        engineSelection: engineOverridden ? 'override' : 'default',
        modelId: val(modelId),
        selectionSource: val(input.modelSelectionSource),
        modelOverridden: val(input.modelOverridden),
        approxMB: val(input.approxMB),
        modelSource: val(modelSource),
        resolvedDevice: val(resolvedDevice),
        backend: val(backend),
        dtype: val(dtype),
        fallbackOccurred: val(fallbackOccurred),
        runtimeVersion: val(runtimeVersion),
        releaseStatus: val(releaseStatus),
        // Private model names + v4 are never surfaced to normal users (no model picker exists).
        userHidden: mode === 'private',
    };
}

interface V4RuntimeGlobal {
    resolvedDevice?: string;
    backend?: string;
    dtype?: Record<string, string>;
    modelId?: string;
    modelSource?: 'hf' | 'local';
    fallbackOccurred?: boolean;
    transformersVersion?: string;
    onnxRuntimeVersion?: string;
}

/** Read the raw `?privateEngine=` / localStorage engine override. Uses the SAME shared
 *  `PRIVATE_ENGINE_OVERRIDE_KEY` as PrivateSTT so this debug mirror cannot drift from the
 *  real override key. (Diagnostic display only — the badge is debug-gated; gating of the
 *  override BEHAVIOR lives in PrivateSTT.) */
function readEngineOverride(win: Window): string | null {
    try {
        const fromQuery = new URLSearchParams(win.location.search).get('privateEngine');
        if (fromQuery && fromQuery.length > 0) return fromQuery;
        const stored = win.localStorage?.getItem(PRIVATE_ENGINE_OVERRIDE_KEY);
        if (stored && stored.length > 0) return stored;
    } catch {
        /* ignore */
    }
    return null;
}

/** Assemble identity from the live window globals + selection flags. Safe when window is absent. */
export function collectSttIdentityFromWindow(
    win: Window | undefined = typeof window !== 'undefined' ? window : undefined,
): SttIdentity {
    if (!win) return buildSttIdentity({});

    // Mode from the runtime debug accessor (already published by the controller).
    let mode: string | null = null;
    try {
        const dbg = typeof win.__SPEECH_RUNTIME_DEBUG__ === 'function'
            ? (win.__SPEECH_RUNTIME_DEBUG__() as { serviceMode?: string | null })
            : null;
        mode = dbg?.serviceMode ?? null;
    } catch {
        mode = null;
    }

    const privateModelKey = resolvePrivateModel();
    const approxMB = PRIV_STT_MODELS.CANDIDATES[privateModelKey]?.approxMB ?? null;
    const v4 = (win as unknown as { __PRIVATE_V4_RUNTIME__?: V4RuntimeGlobal }).__PRIVATE_V4_RUNTIME__ ?? null;

    return buildSttIdentity({
        mode,
        privateModelKey,
        modelSelectionSource: resolvePrivateModelSource(),
        modelOverridden: isPrivateModelOverridden(),
        approxMB,
        engineOverride: readEngineOverride(win),
        v4,
    });
}

declare global {
    interface Window {
        /** Read-only consolidated STT identity for the dev/test badge + proof harnesses. */
        __STT_IDENTITY__?: () => SttIdentity;
    }
}

/** Install the read-only `window.__STT_IDENTITY__()` accessor (alongside `__STT_EVIDENCE__`). */
export function installSttIdentityAccessor(
    win: Window | undefined = typeof window !== 'undefined' ? window : undefined,
): void {
    if (!win) return;
    win.__STT_IDENTITY__ = () => collectSttIdentityFromWindow(win);
}
