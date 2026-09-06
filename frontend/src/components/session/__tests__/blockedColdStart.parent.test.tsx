import { render, screen, fireEvent } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionOverhaulView, type SessionOverhaulViewProps } from '../SessionOverhaulView';
import { MobileActionBar } from '../MobileActionBar';
import { useSessionStore } from '@/stores/useSessionStore';
import type { SttStatus } from '@/types/transcription';
import { progressGateNotice } from '@/services/progress/progressStartGate';

/**
 * #1415 — A BLOCKED COLD START EXPLAINS ITSELF, ON BOTH VIEWPORTS.
 *
 * These render the real PARENTS, not the controls in isolation, because the defect lived in the wiring
 * between them: `MicCard` computed `isBlockedFromStart` with `downloadRequired` excluded, and
 * `MobileActionBar` was never handed a reason at all. A component-level assertion would have passed
 * against both of those, since each control renders correctly for the props it is given — the bug was
 * which props it was given.
 *
 * The reason itself comes from `progressGateNotice`, the same authority the product uses, rather than
 * a literal invented here: a test asserting its own string would still pass if the real notice went
 * missing.
 */

const OWNER = 'user-1';
const GATE = { sessionId: 'sess-1', ownerId: OWNER, state: 'unresolved' as const };
// The exact bounded copy the gate authority produces for this state.
const EXPECTED_REASON = progressGateNotice(GATE, false) ?? '';

const base: SessionOverhaulViewProps = {
    authUserId: OWNER,
    isListening: false,
    sttStatus: { type: 'idle' } as SttStatus,
    elapsedTime: 0,
    micLevel: 0,
    transcriptContent: '',
    showAnalyticsPrompt: false,
    metricsFillerCount: 0,
    onStartStop: vi.fn(),
    history: [],
};

beforeEach(() => {
    useSessionStore.setState({ progressGate: GATE, progressGateResolvedFor: null } as never);
});

describe('#1415 — desktop: a blocked cold start says why', () => {
    it('renders the bounded gate reason instead of a silent disabled control', () => {
        const onStart = vi.fn();
        render(
            <SessionOverhaulView
                {...base}
                onStartStop={onStart}
                privateModelStatus="download-required"
                onDownloadModel={vi.fn()}
            />,
        );

        // The reason is present, and it is the gate's own copy — not "One-time download needed", which
        // describes the model and says nothing about why the button cannot be pressed.
        expect(EXPECTED_REASON.length).toBeGreaterThan(0);
        expect(screen.getByTestId('mic-card')).toHaveTextContent(EXPECTED_REASON);
    });

    it('starts neither a download nor a recording while blocked', () => {
        const onStart = vi.fn();
        const onDownloadModel = vi.fn();
        render(
            <SessionOverhaulView
                {...base}
                onStartStop={onStart}
                privateModelStatus="download-required"
                onDownloadModel={onDownloadModel}
            />,
        );
        const control = screen.getByTestId('mic-download');
        expect(control).toBeDisabled();
        fireEvent.click(control);
        expect(onStart).not.toHaveBeenCalled();
        expect(onDownloadModel).not.toHaveBeenCalled();
    });

    it('an UNBLOCKED cold start keeps the truthful label and is actionable', () => {
        useSessionStore.setState({ progressGate: null, progressGateResolvedFor: OWNER } as never);
        const onStart = vi.fn();
        render(
            <SessionOverhaulView
                {...base}
                onStartStop={onStart}
                privateModelStatus="download-required"
                onDownloadModel={vi.fn()}
            />,
        );
        expect(screen.getByText('Download & start recording')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('mic-download'));
        expect(onStart).toHaveBeenCalledOnce();
    });
});

describe('#1415 — mobile: the same reason reaches the phone', () => {
    it('renders the bounded gate reason and describes the control with it', () => {
        render(
            <MobileActionBar
                isListening={false}
                isButtonDisabled
                modelLoadingProgress={null}
                onStartStop={vi.fn()}
                mode="private"
                privateModelStatus="download-required"
                onDownloadModel={vi.fn()}
                blockedReason={EXPECTED_REASON}
            />,
        );

        const reason = screen.getByTestId('mobile-start-blocked-reason');
        expect(reason).toHaveTextContent(EXPECTED_REASON);
        // Tied to the control, so a screen reader announces the two together rather than leaving a
        // disabled button with an explanation floating somewhere unrelated.
        expect(screen.getByTestId('session-start-stop-button-mobile'))
            .toHaveAttribute('aria-describedby', reason.id);
    });

    it('starts nothing while blocked', () => {
        const onStartStop = vi.fn();
        const onDownloadModel = vi.fn();
        render(
            <MobileActionBar
                isListening={false}
                isButtonDisabled
                modelLoadingProgress={null}
                onStartStop={onStartStop}
                mode="private"
                privateModelStatus="download-required"
                onDownloadModel={onDownloadModel}
                blockedReason={EXPECTED_REASON}
            />,
        );
        fireEvent.click(screen.getByTestId('session-start-stop-button-mobile'));
        expect(onStartStop).not.toHaveBeenCalled();
        expect(onDownloadModel).not.toHaveBeenCalled();
    });

    it('shows NO reason when the gate permits activation', () => {
        render(
            <MobileActionBar
                isListening={false}
                isButtonDisabled={false}
                modelLoadingProgress={null}
                onStartStop={vi.fn()}
                mode="private"
                privateModelStatus="download-required"
                onDownloadModel={vi.fn()}
                blockedReason={null}
            />,
        );
        expect(screen.queryByTestId('mobile-start-blocked-reason')).not.toBeInTheDocument();
        expect(screen.getByText('Download & start recording')).toBeInTheDocument();
    });

    it('setup-error RETRY stays actionable and setup-only even while the gate blocks', () => {
        const onStartStop = vi.fn();
        const onDownloadModel = vi.fn();
        render(
            <MobileActionBar
                isListening={false}
                isButtonDisabled
                modelLoadingProgress={null}
                onStartStop={onStartStop}
                mode="private"
                privateModelStatus="init-failed"
                onDownloadModel={onDownloadModel}
                blockedReason={EXPECTED_REASON}
            />,
        );
        const retry = screen.getByTestId('session-start-stop-button-mobile');
        expect(retry).toBeEnabled();
        fireEvent.click(retry);
        expect(onDownloadModel).toHaveBeenCalledOnce();
        expect(onStartStop).not.toHaveBeenCalled();
    });
});
