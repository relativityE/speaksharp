// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { syncSessionPersisted } from '../forensicAnchors';

type PersistedWindow = Window & { __SS_LAST_PERSISTED_SESSION__?: Record<string, unknown> };

describe('syncSessionPersisted (identity-bearing persisted-session marker, blocker #5)', () => {
    beforeEach(() => {
        document.documentElement.removeAttribute('data-session-persisted');
        document.documentElement.removeAttribute('data-session-persisted-id');
        delete (window as PersistedWindow).__SS_LAST_PERSISTED_SESSION__;
    });

    it('sets the boolean marker AND the exact persisted session id + mode', () => {
        syncSessionPersisted(true, { sessionId: 'sess-abc-123', mode: 'native' });

        expect(document.documentElement.getAttribute('data-session-persisted')).toBe('true');
        expect(document.documentElement.getAttribute('data-session-persisted-id')).toBe('sess-abc-123');
        expect((window as PersistedWindow).__SS_LAST_PERSISTED_SESSION__).toEqual(
            expect.objectContaining({ id: 'sess-abc-123', mode: 'native', at: expect.any(Number) }),
        );
    });

    it('clears both DOM markers on reset so a stale id cannot be mistaken for the live session', () => {
        syncSessionPersisted(true, { sessionId: 'sess-abc-123', mode: 'native' });
        syncSessionPersisted(false);

        expect(document.documentElement.getAttribute('data-session-persisted')).toBeNull();
        expect(document.documentElement.getAttribute('data-session-persisted-id')).toBeNull();
    });

    it('still sets the boolean marker when no session id is provided (backward compatible)', () => {
        syncSessionPersisted(true);

        expect(document.documentElement.getAttribute('data-session-persisted')).toBe('true');
        expect(document.documentElement.getAttribute('data-session-persisted-id')).toBeNull();
    });

    it('tolerates a null mode (id present, mode unknown)', () => {
        syncSessionPersisted(true, { sessionId: 'sess-xyz', mode: null });

        expect(document.documentElement.getAttribute('data-session-persisted-id')).toBe('sess-xyz');
        expect((window as PersistedWindow).__SS_LAST_PERSISTED_SESSION__).toEqual(
            expect.objectContaining({ id: 'sess-xyz', mode: null }),
        );
    });
});
