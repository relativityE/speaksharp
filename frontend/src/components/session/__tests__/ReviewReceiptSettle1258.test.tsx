import { render, act } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionOverhaulView, type SessionOverhaulViewProps } from '../SessionOverhaulView';
import type { SttStatus } from '@/types/transcription';
import { emitTranscriptAuthority } from '@/services/telemetry/transcriptAuthority';

vi.mock('@/services/telemetry/transcriptAuthority', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/services/telemetry/transcriptAuthority')>()),
    emitTranscriptAuthority: vi.fn(),
}));

// #1258 (run 38790238983, PM 6200367845) — the review receipt describes what the user actually saw. A settled review whose
// saved transcript is not yet bound must not emit a blank receipt one render before the real one; a persisted take whose
// transcript NEVER arrives must still emit its honest failing receipt after a bounded settle.
const base: SessionOverhaulViewProps = {
    authUserId: 'user-1',
    isListening: false,
    sttStatus: { type: 'idle' } as SttStatus,
    elapsedTime: 0,
    micLevel: 0,
    transcriptContent: '',
    showAnalyticsPrompt: true,
    metricsFillerCount: 0,
    onStartStop: vi.fn(),
    history: [],
};
const reviewReceipts = () => vi.mocked(emitTranscriptAuthority).mock.calls
    .map((c) => c[0])
    .filter((p) => p.stage === 'review_rendered');

describe('review_rendered receipt — bound before it reports', () => {
    beforeEach(() => { vi.useFakeTimers(); vi.mocked(emitTranscriptAuthority).mockClear(); });
    afterEach(() => { vi.useRealTimers(); });

    it('CASUALTY: the transcript arriving just after the review settles yields only the real receipt, never a blank one', () => {
        const { rerender } = render(<SessionOverhaulView {...base} reviewTranscript={undefined} />);
        expect(reviewReceipts(), 'no receipt while the saved transcript is not yet bound').toHaveLength(0);
        rerender(<SessionOverhaulView {...base} reviewTranscript={{ kind: 'available', text: 'I will name the price now.' }} />);
        act(() => { vi.advanceTimersByTime(5_000); });
        const receipts = reviewReceipts();
        expect(receipts.length).toBeGreaterThan(0);
        expect(receipts.every((r) => typeof r.authoritative === 'string' && r.authoritative.length > 0),
            'every review receipt carries the bound transcript').toBe(true);
    });

    it('CONTROL: a transcript that never arrives still reports the honest failing receipt after the settle', () => {
        render(<SessionOverhaulView {...base} reviewTranscript={{ kind: 'unavailable' }} />);
        expect(reviewReceipts()).toHaveLength(0);
        act(() => { vi.advanceTimersByTime(2_000); });
        const receipts = reviewReceipts();
        expect(receipts).toHaveLength(1);
        expect(receipts[0].authoritative).toBeNull();
    });

    it('CONTROL: a resolved state (expired / not captured) reports at once', () => {
        render(<SessionOverhaulView {...base} reviewTranscript={{ kind: 'expired' }} />);
        expect(reviewReceipts()).toHaveLength(1);
    });
});
