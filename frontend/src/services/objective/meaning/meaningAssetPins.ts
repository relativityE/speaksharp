/**
 * The exact bytes of the self-hosted Focus Points meaning model, as one authority for the loader, the consent
 * receipt and the opt-in copy. `meaningAssetPins.json` is re-derived from `frontend/public/models/` by a unit
 * test, so the size the user is quoted and the bytes the worker accepts cannot drift from what ships.
 */
import pins from './meaningAssetPins.json' with { type: 'json' };

export interface MeaningAssetFile {
    path: string;
    sha256: string;
    bytes: number;
}

/** A pinned absolute request URL, as the worker verifies it. */
export interface MeaningResponsePin {
    url: string;
    sha256: string;
    bytes: number;
}

export const MEANING_MODEL_ID: string = pins.modelId;
export const MEANING_MODEL_REVISION: string = pins.revision;
export const MEANING_MODEL_SERVED_FROM: string = pins.servedFrom;
export const MEANING_MODEL_PIN_DIGEST: string = pins.pinDigest;
export const MEANING_MODEL_FILES: readonly MeaningAssetFile[] = pins.files;
export const MEANING_MODEL_TOTAL_BYTES: number = pins.files.reduce((sum, f) => sum + f.bytes, 0);

/**
 * The cache the meaning worker writes VERIFIED bytes to. Its own name, so clearing or probing it never touches
 * a Private STT model cache.
 */
export const MEANING_MODEL_CACHE = 'speaksharp-meaning-model-v1';

/** Every URL under this prefix must be pinned; anything else the worker is asked for there is refused. */
export function meaningModelScope(origin: string): string {
    return new URL(`${MEANING_MODEL_SERVED_FROM}/`, origin).href;
}

/** The pinned request URLs on this origin. */
export function meaningModelResponsePins(origin: string): MeaningResponsePin[] {
    const scope = meaningModelScope(origin);
    return MEANING_MODEL_FILES.map((f) => ({ url: new URL(f.path, scope).href, sha256: f.sha256, bytes: f.bytes }));
}

/** Rounded decimal megabytes, for user-facing copy. Derived from the pins, never typed by hand. */
export const MEANING_MODEL_APPROX_MB = Math.round(MEANING_MODEL_TOTAL_BYTES / 1_000_000);
