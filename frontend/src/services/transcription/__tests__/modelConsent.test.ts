/**
 * #1381 — consent is durable; cache presence is not invented.
 *
 * The six cases below are the ones that separate "the user agreed to this download" from "the bytes are
 * on disk". Conflating them is what let a v2-cached user start a Moonshine session with no prompt and
 * then pull ~305 MB, and what made the prompt they should have seen quote ~80 MB.
 */
import { describe, expect, it } from 'vitest';
import {
    consentCopy, consentDecision, consentTermsFor, readReceipt, recordConsent, receiptCovers,
    reducedDataRequested,
} from '../modelConsent';
import { CANDIDATES } from '../candidateRegistry';

const MOONSHINE = CANDIDATES['moonshine:streaming-medium'];
const NOW = '2026-09-01T00:00:00.000Z';

const memoryStore = () => {
    const data: Record<string, string> = {};
    return {
        getItem: (k: string) => data[k] ?? null,
        setItem: (k: string, v: string) => { data[k] = v; },
    };
};

describe('consent is about a named set of bytes, not about the cache', () => {
    it('CASUALTY 1: v2 cached but no Moonshine consent still requires Moonshine consent, at Moonshine size', () => {
        // The original defect. v2 cache state is not evidence about Moonshine, in either direction.
        const d = consentDecision(MOONSHINE, null);
        expect(d.state).toBe('consent_required');
        if (d.state !== 'consent_required') throw new Error('unreachable');
        expect(d.maxBytes).toBe(304_690_919);
        // ~305 MB, never v2's ~80 MB.
        expect(Math.round((d.maxBytes ?? 0) / 1_000_000)).toBe(305);
    });

    it('CASUALTY 2: valid consent stops the prompt — but is NOT readiness', () => {
        const store = memoryStore();
        recordConsent(consentTermsFor(MOONSHINE), NOW, store);
        const d = consentDecision(MOONSHINE, readReceipt(MOONSHINE.id, store));
        expect(d.state).toBe('may_initialize');
        // The decision deliberately exposes no ready/cached field to read. READY comes only from the
        // real engine publishing a matching identity, which this module cannot and must not assert.
        expect(Object.keys(d)).toEqual(['state', 'terms']);
        expect(JSON.stringify(d)).not.toMatch(/cached|ready|downloaded/i);
    });

    it('CASUALTY 3: a changed pin digest, runtime version or larger size requires consent again', () => {
        const store = memoryStore();
        recordConsent(consentTermsFor(MOONSHINE), NOW, store);
        const granted = readReceipt(MOONSHINE.id, store);

        const repinned = { ...MOONSHINE, assets: { ...MOONSHINE.assets, pinDigest: 'a-different-digest' } };
        const upgraded = { ...MOONSHINE, runtime: { ...MOONSHINE.runtime, version: '0.2.0' } };
        const bigger = { ...MOONSHINE, assets: { ...MOONSHINE.assets, totalBytes: 800_000_000 } };

        for (const [name, cand] of [['re-pinned', repinned], ['runtime bump', upgraded], ['larger', bigger]] as const) {
            expect(consentDecision(cand, granted).state, `${name} must re-ask`).toBe('consent_required');
        }
    });

    it('a SMALLER download does not re-ask — re-prompting for good news teaches people to click through', () => {
        const store = memoryStore();
        recordConsent(consentTermsFor(MOONSHINE), NOW, store);
        const smaller = { ...MOONSHINE, assets: { ...MOONSHINE.assets, totalBytes: 100_000_000 } };
        expect(consentDecision(smaller, readReceipt(MOONSHINE.id, store)).state).toBe('may_initialize');
    });

    it('CASUALTY 6: nothing anywhere claims the runtime cache is present', () => {
        const store = memoryStore();
        recordConsent(consentTermsFor(MOONSHINE), NOW, store);
        const copy = consentCopy(consentTermsFor(MOONSHINE));
        // "may download UP TO", plus the storage-cleared caveat — never "will download", never "already
        // downloaded", because the runtime's storage is opaque to us.
        expect(copy).toMatch(/may download up to 305 MB/);
        expect(copy).toMatch(/storage is cleared/);
        expect(copy).not.toMatch(/already downloaded|will download|cached/i);
    });

    it('an unreadable store is treated as NO consent, never as consent', () => {
        const hostile = {
            getItem: () => { throw new Error('storage blocked'); },
            setItem: () => { throw new Error('storage blocked'); },
        };
        expect(readReceipt(MOONSHINE.id, hostile)).toBeNull();
        expect(consentDecision(MOONSHINE, readReceipt(MOONSHINE.id, hostile)).state).toBe('consent_required');
    });

    it('an unknown maximum on either side is never treated as covered', () => {
        const unknown = { ...MOONSHINE, assets: { ...MOONSHINE.assets, totalBytes: null } };
        const store = memoryStore();
        recordConsent(consentTermsFor(unknown), NOW, store);
        // Consent given when the size was unknown does not cover a now-known 305 MB.
        expect(receiptCovers(readReceipt(unknown.id, store), consentTermsFor(MOONSHINE))).toBe(false);
    });

    it('explicit reduced-data mode re-surfaces the size; nothing else infers the network', () => {
        const store = memoryStore();
        recordConsent(consentTermsFor(MOONSHINE), NOW, store);
        const receipt = readReceipt(MOONSHINE.id, store);
        expect(consentDecision(MOONSHINE, receipt, true).state).toBe('consent_required');
        expect(consentDecision(MOONSHINE, receipt, false).state).toBe('may_initialize');

        expect(reducedDataRequested({ connection: { saveData: true } })).toBe(true);
        expect(reducedDataRequested({ connection: { saveData: false } })).toBe(false);
        // Absent or non-boolean signals are NOT reduced-data; guessing would prompt at random.
        expect(reducedDataRequested({})).toBe(false);
        expect(reducedDataRequested(null)).toBe(false);
        expect(reducedDataRequested({ connection: { saveData: 'yes' } })).toBe(false);
    });

    it('the quoted maximum comes from the registry, and matches the committed pin table', async () => {
        // Binds the number the user is shown to the pinned bytes, so re-pinning to larger assets fails
        // here instead of silently enlarging a download the user already agreed to.
        const { pinnedAssetsFor } = await import('../moonshineAssetPins');
        const medium = pinnedAssetsFor('medium-streaming-en').map((a) => a.bytes);
        expect(MOONSHINE.assets.componentCount).not.toBeNull();
        expect(medium).toHaveLength(MOONSHINE.assets.componentCount as number);
        expect(consentTermsFor(MOONSHINE).maxBytes).toBe(medium.reduce((a, b) => a + b, 0));
    });
});
