/**
 * Consent to download the Focus Points meaning model — NOT a claim about the cache.
 *
 * Same discipline as Private STT's `modelConsent.ts`: what is durable is the user's consent to a possible
 * download of a SPECIFIC set of bytes (model id + pin digest + the maximum quoted to them). Whether those bytes
 * are on disk right now is not recorded here and not claimed — the worker finds out, from the cache only.
 *
 * A receipt covers only the same model, the same pin digest and the same maximum. A re-pin, or any change to the
 * size quoted, voids it and the user is asked again.
 *
 * A write that cannot be read back is reported as a failure, never as consent: an unpersisted "yes" would
 * mean a download now and the same question next session.
 */
import { MEANING_MODEL_ID, MEANING_MODEL_PIN_DIGEST, MEANING_MODEL_TOTAL_BYTES } from './meaningAssetPins';

export const MEANING_CONSENT_STORAGE_KEY = 'ss_focus_meaning_model_consent_v1';

export interface MeaningConsentTerms {
    modelId: string;
    pinDigest: string;
    maxBytes: number;
}

export interface MeaningConsentReceipt extends MeaningConsentTerms {
    grantedAt: string;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

const defaultStore = (): Store | null => {
    try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
};

/** ONE AUTHORITY: the terms come from the shipped pins, never assembled at a call site. */
export function meaningConsentTerms(): MeaningConsentTerms {
    return { modelId: MEANING_MODEL_ID, pinDigest: MEANING_MODEL_PIN_DIGEST, maxBytes: MEANING_MODEL_TOTAL_BYTES };
}

export function meaningReceiptCovers(receipt: MeaningConsentReceipt | null, terms: MeaningConsentTerms): boolean {
    if (!receipt) return false;
    return receipt.modelId === terms.modelId
        && receipt.pinDigest === terms.pinDigest
        && receipt.maxBytes === terms.maxBytes;
}

export function readMeaningConsent(store: Store | null = defaultStore()): MeaningConsentReceipt | null {
    if (!store) return null;
    try {
        const raw = store.getItem(MEANING_CONSENT_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<MeaningConsentReceipt> | null;
        if (!parsed || typeof parsed.modelId !== 'string' || typeof parsed.pinDigest !== 'string'
            || typeof parsed.maxBytes !== 'number' || typeof parsed.grantedAt !== 'string') return null;
        return parsed as MeaningConsentReceipt;
    } catch {
        // Unreadable storage cannot show consent was given; absence of proof is absence of consent.
        return null;
    }
}

/** A storage error's name (DOMException is not always an `Error` across realms), never its message. */
function errorName(cause: unknown): string {
    const name = (cause as { name?: unknown } | null)?.name;
    return typeof name === 'string' && name !== '' ? name : 'unknown';
}

export class MeaningConsentNotPersistedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'MeaningConsentNotPersistedError';
    }
}

/** Record the grant and READ IT BACK; throw if it cannot be shown to have persisted. */
export function recordMeaningConsent(
    terms: MeaningConsentTerms,
    grantedAt: string,
    store: Store | null = defaultStore(),
): MeaningConsentReceipt {
    const receipt: MeaningConsentReceipt = { ...terms, grantedAt };
    if (!store) {
        throw new MeaningConsentNotPersistedError('MEANING_CONSENT_NOT_PERSISTED: no storage is available');
    }
    try {
        store.setItem(MEANING_CONSENT_STORAGE_KEY, JSON.stringify(receipt));
    } catch (cause) {
        throw new MeaningConsentNotPersistedError(
            `MEANING_CONSENT_NOT_PERSISTED: the decision could not be written (${errorName(cause)})`,
        );
    }
    const stored = readMeaningConsent(store);
    if (!stored || stored.grantedAt !== grantedAt || !meaningReceiptCovers(stored, terms)) {
        throw new MeaningConsentNotPersistedError('MEANING_CONSENT_NOT_PERSISTED: the decision was written but could not be read back');
    }
    return receipt;
}
