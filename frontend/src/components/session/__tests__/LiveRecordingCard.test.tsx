import { fireEvent, render, screen } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { LiveRecordingCard } from '../LiveRecordingCard';
import { TEST_IDS } from '@/constants/testIds';

describe('LiveRecordingCard', () => {
    const defaultProps = {
        mode: 'native' as const,
        isListening: false,
        isReady: true,
        isProUser: false,
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

    it('keeps Cloud disabled for trial-style Pro access without Cloud Pro feature entitlement', async () => {
        render(<LiveRecordingCard {...defaultProps} isProUser={true} canUseCloudStt={false} />);

        fireEvent.pointerDown(screen.getByTestId(TEST_IDS.STT_MODE_SELECT));

        expect(await screen.findByTestId(TEST_IDS.STT_MODE_PRIVATE)).not.toHaveAttribute('data-disabled');
        const cloudOption = await screen.findByTestId(TEST_IDS.STT_MODE_CLOUD);
        expect(cloudOption).toHaveAttribute('data-disabled');
        expect(screen.getByText(/^Cloud$/i)).toBeDefined();
        expect(screen.getByText(/Browser and Private are available now/i)).toBeDefined();
        expect(cloudOption.textContent).toMatch(/Pro feature/i);
        expect(cloudOption.textContent).toMatch(/highest-accuracy transcription/i);
    });

    it('sets Private latency and privacy expectations before recording', async () => {
        render(<LiveRecordingCard {...defaultProps} mode="private" isProUser={true} canUseCloudStt={false} />);

        expect(screen.getAllByText(/Vault Mode/i).length).toBeGreaterThan(0);
        expect(screen.getByText(/one-time setup/i)).toBeDefined();
        expect(screen.getByText(/audio stays in your browser/i)).toBeDefined();

        fireEvent.pointerDown(screen.getByTestId(TEST_IDS.STT_MODE_SELECT));

        expect((await screen.findAllByText(/Vault Mode keeps transcription local/i)).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/Audio stays in your browser/i).length).toBeGreaterThan(0);
    });

    it('does not place Private setup inside the recording card when the model is missing', () => {
        render(
            <LiveRecordingCard
                {...defaultProps}
                mode="private"
                isProUser={true}
                canUseCloudStt={false}
                sttStatusType="download-required"
                isButtonDisabled={true}
            />
        );

        expect(screen.queryByTestId('private-setup-panel')).toBeNull();
        expect(screen.queryByTestId('download-model-button')).toBeNull();
    });

    it('positions Browser STT as Chrome-recommended and browser-dependent', async () => {
        render(<LiveRecordingCard {...defaultProps} mode="native" isProUser={true} canUseCloudStt={false} />);

        expect(screen.getByText(/Free and instant/i)).toBeDefined();
        expect(screen.getByText(/accuracy varies by browser and environment/i)).toBeDefined();

        fireEvent.pointerDown(screen.getByTestId(TEST_IDS.STT_MODE_SELECT));

        expect((await screen.findAllByText(/Free and instant/i)).length).toBeGreaterThan(0);
    });

    it('explains why Private is unavailable for Free or expired-trial users', async () => {
        render(<LiveRecordingCard {...defaultProps} isProUser={false} canUseCloudStt={false} />);

        fireEvent.pointerDown(screen.getByTestId(TEST_IDS.STT_MODE_SELECT));

        const privateOption = await screen.findByTestId(TEST_IDS.STT_MODE_PRIVATE);
        expect(privateOption).toHaveAttribute('data-disabled');
        expect(privateOption.textContent).toMatch(/^Private/i);
        expect(privateOption.textContent).toMatch(/active trial or Pro/i);
        expect(screen.getByText(/Browser is available now/i)).toBeDefined();
        expect(screen.getByText(/Private unlocks during an active trial or with Pro/i)).toBeDefined();
        expect(screen.getByText(/Cloud STT is a Pro feature\.$/i)).toBeDefined();
    });

    it('lets a trial user switch to Browser while Private setup is downloading', async () => {
        const onModeChange = vi.fn();
        render(
            <LiveRecordingCard
                {...defaultProps}
                mode="private"
                isProUser={true}
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
                isProUser={true}
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
});
