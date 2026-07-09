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

        // Short cue visible; the explanatory detail lives behind accessible help.
        expect(screen.getByTestId('stt-mode-cue')).toHaveTextContent('Ready on this device');
        expect(screen.queryByText(/Runs locally on your device/i)).toBeNull();
        fireEvent.click(screen.getByTestId('stt-mode-help'));
        expect(screen.getByText(/Runs locally on your device/i)).toBeInTheDocument();
        expect(screen.getByText(/Best for privacy/i)).toBeInTheDocument();

        // The dropdown option keeps its descriptive title + the 5-minute cap.
        fireEvent.pointerDown(screen.getByTestId(TEST_IDS.STT_MODE_SELECT));
        expect(await screen.findByTestId(TEST_IDS.STT_MODE_PRIVATE)).toHaveAttribute('title', expect.stringMatching(/Private transcription runs on your device after setup/i));
        expect(screen.getByTestId(TEST_IDS.STT_MODE_PRIVATE)).toHaveAttribute('title', expect.stringMatching(/capped at 5 minutes/i));
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
        expect(inlineSetupButton.textContent).toMatch(/Set up Private/i);
        fireEvent.click(inlineSetupButton);
        expect(onDownloadModel).toHaveBeenCalledTimes(1);

        expect(screen.queryByTestId('private-setup-panel')).toBeNull();
        expect(screen.queryByTestId('download-model-button')).toBeNull();
    });

    it('positions Browser STT with a short cue and moves the explanation into help', async () => {
        render(<LiveRecordingCard {...defaultProps} mode="native" canUsePrivate={true} canUseCloudStt={false} />);

        // Short cue visible; the old long paragraph is NOT default-visible.
        expect(screen.getByTestId('stt-mode-cue')).toHaveTextContent('Browser provider');
        expect(screen.queryByText(/Starts instantly with your browser's speech recognition/i)).toBeNull();
        expect(screen.queryByText(/FREE BROWSER/i)).toBeNull();

        // The explanation is available through help.
        fireEvent.click(screen.getByTestId('stt-mode-help'));
        expect(screen.getByText(/browser.s speech service/i)).toBeInTheDocument();
        expect(screen.getByText(/processed by the browser provider/i)).toBeInTheDocument();

        // The dropdown option keeps its descriptive title.
        fireEvent.pointerDown(screen.getByTestId(TEST_IDS.STT_MODE_SELECT));
        expect(await screen.findByTestId(TEST_IDS.STT_MODE_NATIVE)).toHaveAttribute('title', expect.stringMatching(/Starts instantly with your browser's speech recognition/i));
    });

    it('shows the approved privacy CTA on the Browser path and the sample detail in help', () => {
        render(<LiveRecordingCard {...defaultProps} mode="native" canUsePrivate={true} isPaidProUser={false} canUseCloudStt={false} />);

        expect(screen.getByTestId('first-run-setup-private')).toHaveTextContent('Want more privacy? Set up Private');
        // The sample detail is not a default-visible paragraph.
        expect(screen.queryByText(/up to 5 minutes per recording during beta/i)).toBeNull();
        fireEvent.click(screen.getByTestId('stt-mode-help'));
        expect(screen.getByText(/up to 5 minutes per recording during beta/i)).toBeInTheDocument();
        expect(screen.getByText(/compare it with Browser transcription/i)).toBeInTheDocument();
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

    it('shows model size (not setup time) in the Private setup help (#30)', () => {
        render(
            <LiveRecordingCard
                {...defaultProps}
                mode="private"
                sttStatusType="download-required"
                onDownloadModel={vi.fn()}
            />
        );
        // The "Set up Private" action is visible; the download detail lives in help.
        expect(screen.getByTestId('download-model-button-inline')).toBeInTheDocument();
        expect(screen.queryByTestId('private-model-size-note')).toBeNull();

        fireEvent.click(screen.getByTestId('stt-mode-help'));
        const note = screen.getByTestId('private-model-size-note');
        expect(note).toHaveTextContent(`about ${PRIV_STT.DEFAULT_MODEL_DOWNLOAD_MB} MB`);
        expect(note).toHaveTextContent('If site storage is cleared');
        // Approved spec: show model SIZE, never an estimated setup TIME.
        expect(note.textContent ?? '').not.toMatch(/minute|second|estimat|~\s*\d+\s*(s|m|min)\b/i);
    });

    it('surfaces the Cloud external-server explanation through help, not a default paragraph', () => {
        render(<LiveRecordingCard {...defaultProps} mode="cloud" canUseCloudStt={true} />);

        expect(screen.getByTestId('stt-mode-cue')).toHaveTextContent('External server');
        expect(screen.queryByText(/sent to an external transcription server/i)).toBeNull();
        fireEvent.click(screen.getByTestId('stt-mode-help'));
        expect(screen.getByText(/Audio is sent to an external transcription server/i)).toBeInTheDocument();
        expect(screen.getByText(/Cloud is available for Pro users/i)).toBeInTheDocument();
    });

    it('keeps the approved dropdown labels and order: Cloud, Browser, 🔒 Private', async () => {
        render(<LiveRecordingCard {...defaultProps} canUsePrivate={true} canUseCloudStt={true} />);

        fireEvent.pointerDown(screen.getByTestId(TEST_IDS.STT_MODE_SELECT));
        const cloud = await screen.findByTestId(TEST_IDS.STT_MODE_CLOUD);
        const browser = await screen.findByTestId(TEST_IDS.STT_MODE_NATIVE);
        const priv = await screen.findByTestId(TEST_IDS.STT_MODE_PRIVATE);

        expect(cloud).toHaveTextContent('Cloud');
        expect(browser).toHaveTextContent('Browser');
        expect(priv).toHaveTextContent('Private');
        // Approved order: Cloud before Browser before Private.
        expect(cloud.compareDocumentPosition(browser) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(browser.compareDocumentPosition(priv) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});
