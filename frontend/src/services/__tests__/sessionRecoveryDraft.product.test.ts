import { beforeEach, describe, expect, it } from 'vitest';
import { getSessionRecoveryDraft, saveSessionRecoveryDraft } from '../sessionRecoveryDraft';

/** #1541 Codex P2 r4126402525 — the recovery draft carries the take's confirmed product for the Share feedback list. */
describe('recovery draft product', () => {
    const KEY = 'speaksharp_unsaved_session_draft';
    const NEXT = { reasonCode: 'ON_TRACK', actionCode: 'MAINTAIN', metric: 'none', value: 0, comparator: 'within_target', templateVersion: 'rec_v1' } as const;
    const base = { sessionId: 's1', userId: 'u1', recoveryState: 'finalized_pending_save' as const, durationSeconds: 20, mode: 'private' as const, metrics: { totalWords: 5 }, nextActionSignal: NEXT as never };
    beforeEach(() => localStorage.clear());

    it.each(['open_mic', 'focus_points'] as const)('a finalized draft round-trips product %s', (product) => {
        saveSessionRecoveryDraft({ ...base, product });
        expect(getSessionRecoveryDraft()?.product).toBe(product);
    });

    it('an unknown product value is dropped to null at write and read (never guessed)', () => {
        saveSessionRecoveryDraft({ ...base, product: 'podcast' as never });
        expect(getSessionRecoveryDraft()?.product).toBeNull();
        localStorage.setItem(KEY, JSON.stringify({ ...JSON.parse(localStorage.getItem(KEY)!), product: 'podcast' }));
        expect(getSessionRecoveryDraft()?.product).toBeNull();
    });

    it('a LEGACY draft written without the field reads as null (backward compatible, fail closed)', () => {
        saveSessionRecoveryDraft({ ...base });
        const stored = JSON.parse(localStorage.getItem(KEY)!);
        delete stored.product;
        localStorage.setItem(KEY, JSON.stringify(stored));
        expect(getSessionRecoveryDraft()?.product).toBeNull();
        expect(getSessionRecoveryDraft()?.sessionId).toBe('s1');   // the draft itself stays recoverable
    });

    it('an interrupted draft never carries a product', () => {
        saveSessionRecoveryDraft({ ...base, recoveryState: 'active_interrupted', nextActionSignal: null, product: 'open_mic' });
        expect(getSessionRecoveryDraft()?.product).toBeNull();
    });
});
