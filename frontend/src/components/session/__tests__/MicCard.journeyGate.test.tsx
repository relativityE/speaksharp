import { render, screen, fireEvent } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { MicCard } from '../MicCard';
import { MobileActionBar } from '../MobileActionBar';

/**
 * #1415 — the cold path is ONE press, on both surfaces, and it is still gated.
 *
 * Two defects are guarded here. Mobile bundled the cold start with the retry, so a cold press called
 * `onDownloadModel` and stopped — the two-click failure, preserved on mobile while desktop was fixed.
 * And the cold desktop action was unconditionally enabled, which was harmless when it only downloaded
 * and is not harmless now that the same press records: it would start a recording the durable start
 * gate exists to prevent, and pull a large download on the way.
 */
describe('#1415 — cold start: same contract on desktop and mobile', () => {
    it('DESKTOP and MOBILE use the same truthful label', () => {
        const { unmount } = render(<MicCard onStart={vi.fn()} privateModelStatus="download-required" onDownloadModel={vi.fn()} />);
        expect(screen.getByText('Download & start recording')).toBeInTheDocument();
        unmount();

        render(
            <MobileActionBar
                isListening={false} isButtonDisabled={false} modelLoadingProgress={null}
                onStartStop={vi.fn()} mode="private" privateModelStatus="download-required"
                onDownloadModel={vi.fn()}
            />,
        );
        // Was `Set up Private`, which promised setup and delivered only setup.
        expect(screen.getByText('Download & start recording')).toBeInTheDocument();
    });

    it('MOBILE cold press invokes the RECORDING intent, not the setup-only action', () => {
        const onStartStop = vi.fn();
        const onDownloadModel = vi.fn();
        render(
            <MobileActionBar
                isListening={false} isButtonDisabled={false} modelLoadingProgress={null}
                onStartStop={onStartStop} mode="private" privateModelStatus="download-required"
                onDownloadModel={onDownloadModel}
            />,
        );
        fireEvent.click(screen.getByTestId('session-start-stop-button-mobile'));
        expect(onStartStop).toHaveBeenCalledOnce();
        expect(onDownloadModel).not.toHaveBeenCalled();
    });

    it('MOBILE retry still routes to the setup entry point', () => {
        const onStartStop = vi.fn();
        const onDownloadModel = vi.fn();
        render(
            <MobileActionBar
                isListening={false} isButtonDisabled={false} modelLoadingProgress={null}
                onStartStop={onStartStop} mode="private" privateModelStatus="init-failed"
                onDownloadModel={onDownloadModel}
            />,
        );
        expect(screen.getByText('Retry Private setup')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('session-start-stop-button-mobile'));
        expect(onDownloadModel).toHaveBeenCalledOnce();
        expect(onStartStop).not.toHaveBeenCalled();
    });
});

describe('#1415 — a blocked gate blocks the cold start too', () => {
    it('DESKTOP cold control is DISABLED while the start gate blocks', () => {
        const onStart = vi.fn();
        render(<MicCard onStart={onStart} privateModelStatus="download-required" onDownloadModel={vi.fn()} disabled />);
        const control = screen.getByTestId('mic-download');
        expect(control).toBeDisabled();
        fireEvent.click(control);
        // No recording request, and therefore no download either.
        expect(onStart).not.toHaveBeenCalled();
    });

    it('MOBILE cold control is DISABLED while the start gate blocks', () => {
        const onStartStop = vi.fn();
        render(
            <MobileActionBar
                isListening={false} isButtonDisabled modelLoadingProgress={null}
                onStartStop={onStartStop} mode="private" privateModelStatus="download-required"
                onDownloadModel={vi.fn()}
            />,
        );
        const control = screen.getByTestId('session-start-stop-button-mobile');
        expect(control).toBeDisabled();
        fireEvent.click(control);
        expect(onStartStop).not.toHaveBeenCalled();
    });

    it('RETRY remains actionable even while the gate blocks — a failed setup is never a dead end', () => {
        const onDownloadModel = vi.fn();
        render(<MicCard onStart={vi.fn()} privateModelStatus="init-failed" onDownloadModel={onDownloadModel} disabled />);
        const retry = screen.getByTestId('mic-retry');
        expect(retry).toBeEnabled();
        fireEvent.click(retry);
        expect(onDownloadModel).toHaveBeenCalledOnce();
    });

    it('WARM start keeps its existing gating behaviour', () => {
        const onStart = vi.fn();
        const { rerender } = render(<MicCard onStart={onStart} privateModelStatus="ready" />);
        expect(screen.getByTestId('mic-start')).toBeEnabled();
        rerender(<MicCard onStart={onStart} privateModelStatus="ready" disabled />);
        expect(screen.getByTestId('mic-start')).toBeDisabled();
    });
});
