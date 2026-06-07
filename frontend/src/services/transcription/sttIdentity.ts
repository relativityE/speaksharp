/**
 * STT-IDENTITY-DIAG — consolidated, dev/test-only STT run identity.
 *
 * A human (or proof harness) watching a live session cannot otherwise tell WHICH engine/model is
 * running (v2 tiny vs v2 base vs experimental v4), how it was selected (default vs `?privateModel=` /
 * `?privateEngine=` override), its size, device/backend, dtype, or release status. This module
 * assembles those already-published signals into ONE object so the dev/test badge and the proof
 * artifacts speak the same vocabulary.
 *
 * PURE + READ-ONLY: `buildSttIdentity` is a pure function of its inputs; `collectSttIdentityFromWindow`
 * reads existing globals/flags and never mutates state, transcripts, or behavior. It NEVER shows raw
 * model names to normal users — the consuming badge is gated behind an explicit debug flag, and the
 * `releaseStatus` field marks v4 as hidden/experimental.
 */
import { NOT_AVAILABLE, type Maybe } from './sttEvidence';
import { PRIV_STT_MODELS } from './sttConstants';
import {
    resolvePrivateModel,
    resolvePrivateModelSource,
    isPrivateModelOverridden,
    type PrivateModelSelectionSource,
} from './utils/privateModelFlag';

export type SttMode = 'private' | 'cloud' | 'native';
export type SttReleaseStatus =
    | 'release-default'      // v2 base.en — the shipping default
    | 'internal-fallback'   // v2 tiny.en — emergency/internal fallback, not user-facing
    | 'override'            // explicitly selected non-default model/engine (test/dev)
    | 'hidden-experimental'; // v4 — off-flag, never user-facing

/** The fallback (non-default) Private model: kept internal/emergency only, never the user default. */
export const PRIVATE_FALLBACK_MODEL = 'whisper-tiny.en';

/** A v4 runtime snapshot (subset of `__PRIVATE_V4_RUNTIME__`). Present only on a v4 run. */
export interface SttIdentityV4Input {
    resolvedDevice?: string;
    backend?: string;
    dtype?: Record<string, string>;
    modelId?: string;
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
    /** Engine/runtime: 'transformers-js' (v2), 'transformers-js-v4', 'assemblyai', 'web-speech-api'. */
    engine: Maybe<string>;
    /** Whether the engine came from the default routing or an explicit override. */
    engineSelection: 'default' | 'override';
    /** Model id/key actually running. */
    model: Maybe<string>;
    /** How the model was selected (default vs window flag vs URL). */
    modelSelectionSource: Maybe<PrivateModelSelectionSource>;
    modelOverridden: Maybe<boolean>;
    approxMB: Maybe<number>;
    device: Maybe<string>;
    backend: Maybe<string>;
    dtype: Maybe<string>;
    runtimeVersion: Maybe<string>;
    releaseStatus: Maybe<SttReleaseStatus>;
    /** True when this engine/model must never be shown to normal users (v4, or any raw model name). */
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

    let engine: string | null = null;
    let model: string | null = null;
    let device: string | null = null;
    let backend: string | null = null;
    let dtype: string | null = null;
    let runtimeVersion: string | null = null;
    let releaseStatus: SttReleaseStatus | null = null;

    if (mode === 'private') {
        if (isV4) {
            const v4 = input.v4 as SttIdentityV4Input;
            engine = 'transformers-js-v4';
            model = v4.modelId ?? null;
            device = v4.resolvedDevice ?? null;
            backend = v4.backend ?? (v4.resolvedDevice === 'webgpu' ? 'webgpu' : null);
            dtype = v4.dtype && typeof v4.dtype === 'object'
                ? Object.entries(v4.dtype).map(([k, v]) => `${k}=${v}`).join(',')
                : null;
            runtimeVersion = [v4.transformersVersion, v4.onnxRuntimeVersion].filter(Boolean).join(' / ') || null;
            releaseStatus = 'hidden-experimental';
        } else {
            engine = 'transformers-js';
            model = input.privateModelKey ?? null;
            device = 'cpu';
            backend = 'wasm';
            releaseStatus = input.modelOverridden
                ? 'override'
                : model === PRIV_STT_MODELS.DEFAULT
                    ? 'release-default'
                    : model === PRIVATE_FALLBACK_MODEL
                        ? 'internal-fallback'
                        : 'override';
        }
    } else if (mode === 'cloud') {
        engine = 'assemblyai';
        model = 'universal-streaming';
        device = 'cloud';
        releaseStatus = 'release-default';
    } else if (mode === 'native') {
        engine = 'web-speech-api';
        model = 'browser-native';
        device = 'browser';
        releaseStatus = 'release-default';
    }

    return {
        mode: val(mode),
        engine: val(engine),
        engineSelection: engineOverridden ? 'override' : 'default',
        model: val(model),
        modelSelectionSource: val(input.modelSelectionSource),
        modelOverridden: val(input.modelOverridden),
        approxMB: val(input.approxMB),
        device: val(device),
        backend: val(backend),
        dtype: val(dtype),
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
    transformersVersion?: string;
    onnxRuntimeVersion?: string;
}

/** Read the raw `?privateEngine=` / localStorage engine override (mirrors PrivateSTT, no import). */
function readEngineOverride(win: Window): string | null {
    try {
        const fromQuery = new URLSearchParams(win.location.search).get('privateEngine');
        if (fromQuery && fromQuery.length > 0) return fromQuery;
        const stored = win.localStorage?.getItem('speaksharp_private_engine_override');
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
