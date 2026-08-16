import { render, screen, fireEvent } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { MobileActionBar } from '../MobileActionBar';
import { TEST_IDS } from '@/constants/testIds';

const MOBILE_BTN = `${TEST_IDS.SESSION_START_STOP_BUTTON}-mobile`;

describe('MobileActionBar (#1258 retry)', () => {
    it('after a Private setup failure, shows an ENABLED "Retry Private setup" that routes to the setup entry point', () => {
        const onDownloadModel = vi.fn();
        const onStartStop = vi.fn();
        // isButtonDisabled is set — the retry action must still be enabled (not a dead end on mobile either).
        render(
            <MobileActionBar
                isListening={false}
                isButtonDisabled
                modelLoadingProgress={null}
                onStartStop={onStartStop}
                mode="private"
                privateModelStatus="init-failed"
                onDownloadModel={onDownloadModel}
            />,
        );
        const btn = screen.getByTestId(MOBILE_BTN);
        expect(btn).toBeEnabled();
        expect(screen.getByText('Retry Private setup')).toBeInTheDocument();

        fireEvent.click(btn);
        expect(onDownloadModel).toHaveBeenCalledOnce(); // routes to Private setup, not start/stop
        expect(onStartStop).not.toHaveBeenCalled();
    });

    it('does not treat init-failed as a retry while a recording is active (never interrupt)', () => {
        const onDownloadModel = vi.fn();
        const onStartStop = vi.fn();
        render(
            <MobileActionBar
                isListening
                isButtonDisabled={false}
                modelLoadingProgress={null}
                onStartStop={onStartStop}
                mode="private"
                privateModelStatus="init-failed"
                onDownloadModel={onDownloadModel}
            />,
        );
        const btn = screen.getByTestId(MOBILE_BTN);
        fireEvent.click(btn);
        expect(onStartStop).toHaveBeenCalledOnce(); // Stop, not a setup retry
        expect(onDownloadModel).not.toHaveBeenCalled();
    });
});
