import { fireEvent, render, screen } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { LiveRecordingCard } from '../LiveRecordingCard';
import { TEST_IDS } from '@/constants/testIds';

describe('LiveRecordingCard', () => {
    const defaultProps = {
        // #1184: Private is the only engine, so the default recorder mode is 'private'.
        mode: 'private' as const,
        isListening: false,
        isReady: true,
        canUsePrivate: true,
        formattedTime: '00:00',
        elapsedSeconds: 0,
        isButtonDisabled: false,
        activeEngine: null as 'native' | 'cloud' | 'private' | 'none' | null,
        onModeChange: vi.fn(),
        onStartStop: vi.fn(),
    };

    // #1184: the Private/Browser/Cloud selector, its "About transcription modes" help, and the per-row
    // flyout are removed — Private is the only STT, so there is nothing to choose or compare. The card now
    // shows a static Private indicator + the header engine cue.
    it('renders the recorder card and a static Private engine indicator (no selector)', () => {
        render(<LiveRecordingCard {...defaultProps} />);

        expect(screen.getByTestId('live-recording-card')).toBeDefined();
        // The former mode-select trigger is now a non-interactive Private indicator.
        const indicator = screen.getByTestId(TEST_IDS.STT_MODE_SELECT);
        expect(indicator).toHaveTextContent('Private');
        expect(indicator).toHaveAttribute('data-state', 'private');
        // The green privacy lock is present; the header cue names the on-device engine.
        expect(screen.getByTestId('stt-private-lock')).toBeInTheDocument();
        expect(screen.getByTestId('stt-mode-cue')).toHaveTextContent('Private · on this device');
    });

    it('surfaces the on-device privacy claim via the persistent screen-reader descriptor', () => {
        render(<LiveRecordingCard {...defaultProps} />);
        // The privacy sentence is not a default-visible paragraph; it is the sr-only descriptor the
        // indicator points at, so it is announced once without cluttering the surface.
        expect(screen.getByTestId(TEST_IDS.STT_MODE_SELECT)).toHaveAttribute('aria-describedby', 'stt-private-descriptor');
        expect(document.getElementById('stt-private-descriptor')?.textContent)
            .toMatch(/Stays local\. Transcription runs on this device; audio is not uploaded\./i);
    });

    it('no engine selector, mode options, modes-help, or flyout are rendered (Private-only)', () => {
        render(<LiveRecordingCard {...defaultProps} />);
        expect(screen.queryByTestId(TEST_IDS.STT_MODE_NATIVE)).toBeNull();
        expect(screen.queryByTestId(TEST_IDS.STT_MODE_CLOUD)).toBeNull();
        expect(screen.queryByTestId('stt-mode-help')).toBeNull();
        expect(screen.queryByTestId('stt-modes-about')).toBeNull();
        expect(screen.queryByTestId('stt-mode-flyout')).toBeNull();
        // No Browser/Cloud copy leaks onto the surface.
        expect(screen.queryByText(/quick preview/i)).toBeNull();
        expect(screen.queryByText(/^Cloud$/)).toBeNull();
    });

    it('does not surface generic recording error copy in the status pill', () => {
        render(<LiveRecordingCard {...defaultProps} statusMessage="Error occurred" />);

        expect(screen.queryByText(/^Error occurred$/i)).toBeNull();
        expect(screen.getByText(/Recording could not start/i)).toBeDefined();
    });

    it('does not show active recording controls for startup states before recording is confirmed', () => {
        render(
            <LiveRecordingCard
                {...defaultProps}
                isListening={false}
                recordingIntent={false}
                fsmState="ENGINE_INITIALIZING"
                statusMessage="Starting microphone..."
                isButtonDisabled={true}
            />
        );

        const startButton = screen.getByLabelText('Start Recording');
        expect(startButton).toBeDisabled();
        expect(startButton).toHaveAttribute('data-recording', 'false');
        expect(screen.queryByLabelText('Stop Recording')).toBeNull();
    });

    it('shows Stop only for confirmed active recording', () => {
        render(
            <LiveRecordingCard
                {...defaultProps}
                isListening={true}
                recordingIntent={true}
                fsmState="RECORDING"
                statusMessage="Recording active"
            />
        );

        const stopButton = screen.getByLabelText('Stop Recording');
        expect(stopButton).toHaveAttribute('data-recording', 'true');
        expect(screen.queryByLabelText('Start Recording')).toBeNull();
    });

    it('keeps Stop visible while the controller is finishing a recording', () => {
        render(
            <LiveRecordingCard
                {...defaultProps}
                isListening={false}
                recordingIntent={true}
                fsmState="STOPPING"
                statusMessage="Saving session"
            />
        );

        const stopButton = screen.getByLabelText('Stop Recording');
        expect(stopButton).toHaveAttribute('data-recording', 'true');
        expect(screen.queryByLabelText('Start Recording')).toBeNull();
    });

    it('tints the status pill amber with "getting mic ready" while warming (#891)', () => {
        render(<LiveRecordingCard {...defaultProps} mode="private" isListening={true} sttStatusType="warming" />);
        const pill = screen.getByTestId('stt-status-label');
        expect(pill).toHaveAttribute('data-pill-state', 'warming');
        expect(pill.textContent).toMatch(/getting mic ready/i);
    });

    it('tints the status pill blue with "finalizing" during the post-Stop decode (#891)', () => {
        render(<LiveRecordingCard {...defaultProps} mode="private" isListening={false} isFinalizing={true} />);
        const pill = screen.getByTestId('stt-status-label');
        expect(pill).toHaveAttribute('data-pill-state', 'finalizing');
        expect(pill.textContent).toMatch(/finalizing your transcript/i);
    });

    it('first run (download-required): the mic downloads the model (no separate button) and never starts', () => {
        const onDownloadModel = vi.fn();
        const onStartStop = vi.fn();
        render(
            <LiveRecordingCard
                {...defaultProps}
                mode="private"
                canUsePrivate={true}
                privateModelStatus="download-required"
                isButtonDisabled={true}
                onDownloadModel={onDownloadModel}
                onStartStop={onStartStop}
            />
        );

        // No separate "Set up" button — a first-run note explains the mic starts setup.
        expect(screen.queryByTestId('download-model-button-inline')).toBeNull();
        expect(screen.getByTestId('private-first-run-note')).toHaveTextContent(/click the mic to download the model/i);

        // Clickable even though isButtonDisabled=true (download-required is the one override), and it
        // triggers the DOWNLOAD — never a recording start on a model-less engine (that was the crash).
        const micButton = screen.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);
        expect(micButton).toHaveAttribute('aria-label', 'Set up Private — download the on-device model');
        expect(micButton).not.toBeDisabled();
        fireEvent.click(micButton);
        expect(onDownloadModel).toHaveBeenCalledTimes(1);
        expect(onStartStop).not.toHaveBeenCalled();
        expect(screen.queryByTestId('download-model-button')).toBeNull();
    });

    // Start-ability follows the DURABLE privateModelStatus/isButtonDisabled, never a transient status
    // pulse — so a returning user at post-session idle can record again without a reload.
    it('downloading the model (privateModelStatus=loading): mic disabled, blue downloading pill, cannot start', () => {
        const onStartStop = vi.fn();
        render(
            <LiveRecordingCard
                {...defaultProps}
                mode="private"
                privateModelStatus="loading"
                sttStatusType="downloading"
                statusMessage="Downloading model… 42%"
                isButtonDisabled={true}
                onStartStop={onStartStop}
            />
        );
        const mic = screen.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);
        expect(mic).toBeDisabled();
        const pill = screen.getByTestId('stt-status-label');
        expect(pill).toHaveAttribute('data-pill-state', 'downloading');
        expect(pill.textContent).toMatch(/downloading model… 42%/i);
        fireEvent.click(mic);
        expect(onStartStop).not.toHaveBeenCalled();
    });

    it('model ready (privateModelStatus=ready): green "Ready to record" and the mic can start', () => {
        const onStartStop = vi.fn();
        render(<LiveRecordingCard {...defaultProps} mode="private" privateModelStatus="ready" isButtonDisabled={false} onStartStop={onStartStop} />);
        const pill = screen.getByTestId('stt-status-label');
        expect(pill).toHaveAttribute('data-pill-state', 'ready');
        expect(pill.textContent).toMatch(/ready to record/i);
        const mic = screen.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);
        expect(mic).not.toBeDisabled();
        fireEvent.click(mic);
        expect(onStartStop).toHaveBeenCalledTimes(1);
    });

    it('returning user (post-session idle, model cached): the mic can start again WITHOUT a reload', () => {
        // Regression guard: after a session the runtime rests at privateModelStatus 'idle' (model
        // still cached) with isButtonDisabled=false. The mic MUST stay startable — an earlier fix that
        // gated on the transient sttStatusType==='ready' dead-locked exactly this ('Private not ready').
        const onStartStop = vi.fn();
        render(<LiveRecordingCard {...defaultProps} mode="private" privateModelStatus="idle" isButtonDisabled={false} statusMessage="Ready" onStartStop={onStartStop} />);
        const mic = screen.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);
        expect(mic).not.toBeDisabled();
        expect(screen.getByTestId('stt-status-label').textContent).not.toMatch(/private not ready/i);
        fireEvent.click(mic);
        expect(onStartStop).toHaveBeenCalledTimes(1);
    });

    it('setup failed (init-failed): mic disabled, shows the failure message, never green, cannot start', () => {
        const onStartStop = vi.fn();
        render(
            <LiveRecordingCard
                {...defaultProps}
                mode="private"
                privateModelStatus="init-failed"
                statusMessage="Private transcription could not finish setup."
                isButtonDisabled={true}
                onStartStop={onStartStop}
            />
        );
        const pill = screen.getByTestId('stt-status-label');
        expect(pill).not.toHaveAttribute('data-pill-state', 'ready');
        expect(pill.textContent).toMatch(/could not finish setup/i);
        expect(pill.textContent).not.toMatch(/ready to record/i);
        const mic = screen.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);
        expect(mic).toBeDisabled();
        fireEvent.click(mic);
        expect(onStartStop).not.toHaveBeenCalled();
    });

    it('setup error (privateModelStatus=error): mic disabled, shows the error message, never green, cannot start', () => {
        const onStartStop = vi.fn();
        render(<LiveRecordingCard {...defaultProps} mode="private" privateModelStatus="error" statusMessage="Something went wrong" isButtonDisabled={true} onStartStop={onStartStop} />);
        const pill = screen.getByTestId('stt-status-label');
        expect(pill).not.toHaveAttribute('data-pill-state', 'ready');
        expect(pill.textContent).toMatch(/something went wrong/i);
        expect(pill.textContent).not.toMatch(/ready to record/i);
        const mic = screen.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);
        expect(mic).toBeDisabled();
        fireEvent.click(mic);
        expect(onStartStop).not.toHaveBeenCalled();
    });
});
