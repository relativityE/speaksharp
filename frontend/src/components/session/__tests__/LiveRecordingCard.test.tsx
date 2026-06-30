import { fireEvent, render, screen } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { LiveRecordingCard } from '../LiveRecordingCard';
import { TEST_IDS } from '@/constants/testIds';
import { PRIV_STT } from '@/services/transcription/sttConstants';

describe('LiveRecordingCard', () => {
    const defaultProps = {
        mode: 'native' as const,
        isListening: false,
        isReady: true,
        canUsePrivate: false,
        formattedTime: '00:00',
        elapsedSeconds: 0,
        isButtonDisabled: false,
        activeEngine: null as 'native' | 'cloud' | 'private' | 'none' | null,
        onModeChange: vi.fn(),
        onStartStop: vi.fn(),
    };

    it('renders with the correct test IDs', () => {
        render(<LiveRecordingCard {...defaultProps} />);

        // Check for the main card test ID (if any, it has data-testid="live-recording-card")
        expect(screen.getByTestId('live-recording-card')).toBeDefined();

        // Check for the mode selector button
        const modeSelect = screen.getByTestId(TEST_IDS.STT_MODE_SELECT);
        expect(modeSelect).toBeDefined();
        expect(modeSelect.textContent).toContain('Browser');
    });

    it('displays the correct label for the mode', () => {
        const { rerender } = render(<LiveRecordingCard {...defaultProps} mode="cloud" />);
        expect(screen.getByTestId(TEST_IDS.STT_MODE_SELECT).textContent).toContain('Cloud');

        rerender(<LiveRecordingCard {...defaultProps} mode="private" />);
        expect(screen.getByTestId(TEST_IDS.STT_MODE_SELECT).textContent).toContain('Private');
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

    it('keeps Cloud disabled for Private-sample access without paid Cloud entitlement', async () => {
        render(<LiveRecordingCard {...defaultProps} canUsePrivate={true} isPaidProUser={false} canUseCloudStt={false} />);

        fireEvent.pointerDown(screen.getByTestId(TEST_IDS.STT_MODE_SELECT));

        expect(await screen.findByTestId(TEST_IDS.STT_MODE_PRIVATE)).not.toHaveAttribute('data-disabled');
        const cloudOption = await screen.findByTestId(TEST_IDS.STT_MODE_CLOUD);
        expect(cloudOption).toHaveAttribute('data-disabled');
        expect(screen.getByText(/^Cloud$/i)).toBeDefined();
        expect(cloudOption).toHaveAttribute('title', expect.stringMatching(/paid Early Access/i));
    });

    it('sets Private latency and privacy expectations before recording', async () => {
        render(<LiveRecordingCard {...defaultProps} mode="private" canUsePrivate={true} canUseCloudStt={false} />);

        expect(screen.getByText(/Runs locally after model setup/i)).toBeDefined();
        expect(screen.getByText(/All audio processing remains local/i)).toBeDefined();

        fireEvent.pointerDown(screen.getByTestId(TEST_IDS.STT_MODE_SELECT));

        expect(await screen.findByTestId(TEST_IDS.STT_MODE_PRIVATE)).toHaveAttribute('title', expect.stringMatching(/Private transcription keeps transcription local/i));
        expect(screen.getByTestId(TEST_IDS.STT_MODE_PRIVATE)).toHaveAttribute('title', expect.stringMatching(/All audio processing remains local/i));
        // #891 beta: the 90s per-recording cap is surfaced up front.
        expect(screen.getByTestId(TEST_IDS.STT_MODE_PRIVATE)).toHaveAttribute('title', expect.stringMatching(/capped at 90s/i));
    });

    it('shows a prominent "getting mic ready" cue while the mic is warming (#891)', () => {
        render(<LiveRecordingCard {...defaultProps} mode="private" isListening={true} sttStatusType="warming" />);
        const cue = screen.getByTestId('mic-ready-cue');
        expect(cue).toHaveAttribute('data-state', 'warming');
        expect(cue.textContent).toMatch(/getting mic ready/i);
    });

    it('does NOT show the mic-ready cue when not warming and not just-ready', () => {
        render(<LiveRecordingCard {...defaultProps} mode="private" isListening={true} sttStatusType="recording" />);
        expect(screen.queryByTestId('mic-ready-cue')).toBeNull();
    });

    it('shows explicit Private setup inside the recording card when the model is missing', () => {
        const onDownloadModel = vi.fn();
        render(
            <LiveRecordingCard
                {...defaultProps}
                mode="private"
                canUsePrivate={true}
                canUseCloudStt={false}
                sttStatusType="download-required"
                isButtonDisabled={true}
                onDownloadModel={onDownloadModel}
            />
        );

        const inlineSetupButton = screen.getByTestId('download-model-button-inline');
        expect(inlineSetupButton).toBeDefined();
        expect(inlineSetupButton.textContent).toMatch(/Set Up/i);
        fireEvent.click(inlineSetupButton);
        expect(onDownloadModel).toHaveBeenCalledTimes(1);

        expect(screen.queryByTestId('private-setup-panel')).toBeNull();
        expect(screen.queryByTestId('download-model-button')).toBeNull();
    });

    it('positions Browser STT as instant and browser-dependent without the old badge copy', async () => {
        render(<LiveRecordingCard {...defaultProps} mode="native" canUsePrivate={true} canUseCloudStt={false} />);

        expect(screen.getByText(/Starts instantly with browser speech recognition/i)).toBeDefined();
        expect(screen.getByText(/Accuracy depends on browser and room/i)).toBeDefined();
        expect(screen.queryByText(/FREE BROWSER/i)).toBeNull();

        fireEvent.pointerDown(screen.getByTestId(TEST_IDS.STT_MODE_SELECT));

        expect(await screen.findByTestId(TEST_IDS.STT_MODE_NATIVE)).toHaveAttribute('title', expect.stringMatching(/Free and instant/i));
        expect(screen.getByTestId(TEST_IDS.STT_MODE_NATIVE)).toHaveAttribute('title', expect.stringMatching(/accuracy varies by browser and environment/i));
    });

    it('shows the approved Private sample CTA for sample-entitled users on the Browser path', () => {
        render(<LiveRecordingCard {...defaultProps} mode="native" canUsePrivate={true} isPaidProUser={false} canUseCloudStt={false} />);

        expect(screen.getByTestId('first-run-setup-private')).toHaveTextContent('Try one Private sample session');
        expect(screen.getByText(/up to 5 minutes total/i)).toBeDefined();
        expect(screen.getByText(/90s per recording during beta/i)).toBeDefined();
        expect(screen.getByText(/compare it with Browser transcription/i)).toBeDefined();
    });

    it('explains why Private is unavailable after the sample is unavailable', async () => {
        render(<LiveRecordingCard {...defaultProps} canUsePrivate={false} canUseCloudStt={false} />);

        fireEvent.pointerDown(screen.getByTestId(TEST_IDS.STT_MODE_SELECT));

        const privateOption = await screen.findByTestId(TEST_IDS.STT_MODE_PRIVATE);
        expect(privateOption).toHaveAttribute('data-disabled');
        expect(privateOption.textContent).toMatch(/^Private/i);
        expect(privateOption).toHaveAttribute('title', expect.stringMatching(/Private transcription is part of Early Access/i));
        expect(privateOption).toHaveAttribute('title', expect.stringMatching(/full session history, and deeper reports/i));
        expect(screen.getByText(/Private transcription is part of Early Access/i)).toBeDefined();
        expect(screen.getByTestId(TEST_IDS.STT_MODE_CLOUD)).toHaveAttribute('title', expect.stringMatching(/paid Early Access/i));
    });

    it('lets a Private-sample user switch to Browser while Private setup is downloading', async () => {
        const onModeChange = vi.fn();
        render(
            <LiveRecordingCard
                {...defaultProps}
                mode="private"
                canUsePrivate={true}
                canUseCloudStt={false}
                onModeChange={onModeChange}
            />
        );

        fireEvent.pointerDown(screen.getByTestId(TEST_IDS.STT_MODE_SELECT));
        expect(await screen.findByTestId(TEST_IDS.STT_MODE_CLOUD)).toHaveAttribute('data-disabled');
        fireEvent.click(await screen.findByTestId(TEST_IDS.STT_MODE_NATIVE));

        expect(onModeChange).toHaveBeenCalledWith('native');
    });

    it('lets a subscribed Pro user switch to Cloud while Private setup is downloading', async () => {
        const onModeChange = vi.fn();
        render(
            <LiveRecordingCard
                {...defaultProps}
                mode="private"
                canUsePrivate={true}
                canUseCloudStt={true}
                onModeChange={onModeChange}
            />
        );

        fireEvent.pointerDown(screen.getByTestId(TEST_IDS.STT_MODE_SELECT));
        const cloudOption = await screen.findByTestId(TEST_IDS.STT_MODE_CLOUD);
        expect(cloudOption).not.toHaveAttribute('data-disabled');
        fireEvent.click(cloudOption);

        expect(onModeChange).toHaveBeenCalledWith('cloud');
    });

    it('shows model size (not setup time) in the Private setup CTA (#30)', () => {
        render(
            <LiveRecordingCard
                {...defaultProps}
                mode="private"
                sttStatusType="download-required"
                onDownloadModel={vi.fn()}
            />
        );
        const note = screen.getByTestId('private-model-size-note');
        expect(note).toHaveTextContent(`about ${PRIV_STT.DEFAULT_MODEL_DOWNLOAD_MB} MB`);
        expect(note).toHaveTextContent('If site storage is cleared');
        // Approved spec: show model SIZE, never an estimated setup TIME.
        expect(note.textContent ?? '').not.toMatch(/minute|second|estimat|~\s*\d+\s*(s|m|min)\b/i);
        expect(screen.getByTestId('download-model-button-inline')).toBeInTheDocument();
    });
});
