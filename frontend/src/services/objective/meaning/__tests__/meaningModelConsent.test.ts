import { describe, expect, it } from 'vitest';
import {
    MEANING_CONSENT_STORAGE_KEY,
    MeaningConsentNotPersistedError,
    meaningConsentTerms,
    meaningReceiptCovers,
    readMeaningConsent,
    recordMeaningConsent,
} from '../meaningModelConsent';
import { MEANING_MODEL_PIN_DIGEST, MEANING_MODEL_TOTAL_BYTES } from '../meaningAssetPins';

function memoryStore() {
    const data = new Map<string, string>();
    return {
        data,
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => { data.set(k, v); },
    };
}

describe('meaning model consent receipt', () => {
    it('terms come from the shipped pins', () => {
        expect(meaningConsentTerms()).toEqual({
            modelId: 'nli-deberta-v3-xsmall', pinDigest: MEANING_MODEL_PIN_DIGEST, maxBytes: MEANING_MODEL_TOTAL_BYTES,
        });
    });

    it('records, reads back, and covers the same terms', () => {
        const store = memoryStore();
        const terms = meaningConsentTerms();
        const receipt = recordMeaningConsent(terms, '2026-11-27T00:00:00.000Z', store);
        expect(readMeaningConsent(store)).toEqual(receipt);
        expect(meaningReceiptCovers(readMeaningConsent(store), terms)).toBe(true);
    });

    it('covers only the same pin digest', () => {
        const terms = meaningConsentTerms();
        const receipt = { ...terms, grantedAt: 'x' };
        expect(meaningReceiptCovers(receipt, { ...terms, pinDigest: 'f'.repeat(64) })).toBe(false);
    });

    it('covers only the same maximum (a larger OR a different size voids it)', () => {
        const terms = meaningConsentTerms();
        const receipt = { ...terms, grantedAt: 'x' };
        expect(meaningReceiptCovers(receipt, { ...terms, maxBytes: terms.maxBytes + 1 })).toBe(false);
        expect(meaningReceiptCovers(receipt, { ...terms, maxBytes: terms.maxBytes - 1 })).toBe(false);
        expect(meaningReceiptCovers(receipt, { ...terms, modelId: 'other' })).toBe(false);
        expect(meaningReceiptCovers(null, terms)).toBe(false);
    });

    it('throws when the write cannot be read back (never reports unpersisted consent)', () => {
        const swallowing = { getItem: () => null, setItem: () => undefined };
        expect(() => recordMeaningConsent(meaningConsentTerms(), 'now', swallowing)).toThrow(MeaningConsentNotPersistedError);
    });

    it('throws when storage refuses the write or is unavailable', () => {
        const refusing = { getItem: () => null, setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } };
        expect(() => recordMeaningConsent(meaningConsentTerms(), 'now', refusing)).toThrow(/QuotaExceededError/);
        expect(() => recordMeaningConsent(meaningConsentTerms(), 'now', null)).toThrow(MeaningConsentNotPersistedError);
    });

    it('treats unreadable or malformed storage as no consent', () => {
        const store = memoryStore();
        store.data.set(MEANING_CONSENT_STORAGE_KEY, '{not json');
        expect(readMeaningConsent(store)).toBeNull();
        store.data.set(MEANING_CONSENT_STORAGE_KEY, JSON.stringify({ modelId: 'nli-deberta-v3-xsmall' }));
        expect(readMeaningConsent(store)).toBeNull();
        expect(readMeaningConsent(null)).toBeNull();
    });
});
