// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Spy on the v4 telemetry emitter (the unit under regression).
vi.mock('@/services/transcription/privateV4Telemetry', () => ({
    emitV4SessionSaved: vi.fn(),
}));
// Minimal deps so the controller singleton constructs without side effects.
vi.mock('../../lib/logger', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../lib/sessionRepository', () => ({
    saveSession: vi.fn().mockResolvedValue({ session: { id: 'test-sess' }, usageExceeded: false }),
    heartbeatSession: vi.fn().mockResolvedValue({ success: true }),
    completeSession: vi.fn().mockResolvedValue({ success: true }),
    updateSession: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('../../lib/supabaseClient', () => ({
    getSupabaseClient: vi.fn(() => ({
        auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'u' } } } }) },
    })),
}));

import { SpeechRuntimeController } from '../SpeechRuntimeController';
import { emitV4SessionSaved } from '@/services/transcription/privateV4Telemetry';

type PersistDetails = { sessionId?: string | null; mode?: string | null; engineType?: string | null };
type PersistableController = {
    updateSessionPersisted: (persisted: boolean, details?: PersistDetails) => void;
    lastV4SessionSavedId: string | null;
};

/**
 * PR #763 regression: private_stt_v4_session_saved must fire EXACTLY ONCE per saved v4 session.
 * updateSessionPersisted(true, …) is invoked at three successful-stop checkpoints for one save, so a
 * naive emit fired up to 3x. The fix dedupes by sessionId.
 */
describe('SpeechRuntimeController — v4 session_saved telemetry idempotence (PR #763)', () => {
    let controller: PersistableController;

    beforeEach(() => {
        vi.clearAllMocks();
        controller = SpeechRuntimeController.getInstance() as unknown as PersistableController;
        controller.lastV4SessionSavedId = null; // reset singleton dedupe state between tests
    });

    it('emits session_saved exactly ONCE for one v4 save across 3 persist checkpoints', () => {
        const v4 = { engineType: 'transformers-js-v4', sessionId: 'sess-1', mode: 'private' };
        controller.updateSessionPersisted(true, v4);
        controller.updateSessionPersisted(true, v4);
        controller.updateSessionPersisted(true, v4);
        expect(emitV4SessionSaved).toHaveBeenCalledTimes(1);
        expect(emitV4SessionSaved).toHaveBeenCalledWith(
            expect.objectContaining({ engine: 'transformers-js-v4', saved: true }),
        );
    });

    it('emits again for a DIFFERENT saved v4 session', () => {
        controller.updateSessionPersisted(true, { engineType: 'transformers-js-v4', sessionId: 'sess-1' });
        controller.updateSessionPersisted(true, { engineType: 'transformers-js-v4', sessionId: 'sess-2' });
        expect(emitV4SessionSaved).toHaveBeenCalledTimes(2);
    });

    it('is a NO-OP for v2 / native / cloud saves', () => {
        controller.updateSessionPersisted(true, { engineType: 'transformers-js', sessionId: 'sess-1' });
        controller.updateSessionPersisted(true, { sessionId: 'sess-2', mode: 'native' });
        controller.updateSessionPersisted(true, { engineType: 'cloud', sessionId: 'sess-3' });
        expect(emitV4SessionSaved).not.toHaveBeenCalled();
    });

    it('does NOT emit on un-persist (persisted=false)', () => {
        controller.updateSessionPersisted(false, { engineType: 'transformers-js-v4', sessionId: 'sess-1' });
        expect(emitV4SessionSaved).not.toHaveBeenCalled();
    });
});
