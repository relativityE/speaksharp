import { fireEvent, render, screen } from '../../../../tests/support/test-utils';
import { within } from '@testing-library/react';
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
        // Cloud's entitlement copy is readable via "About transcription modes" without selecting Cloud.
        fireEvent.click(screen.getByTestId('stt-mode-help'));
        expect(screen.getByTestId('stt-about-cloud')).toHaveTextContent(/paid Early Access/i);
    });

    it('sets Private latency and privacy expectations before recording', async () => {
        render(<LiveRecordingCard {...defaultProps} mode="private" canUsePrivate={true} canUseCloudStt={false} />);

        // Short cue visible; the explanatory detail lives behind the "About transcription modes" help.
        expect(screen.getByTestId('stt-mode-cue')).toHaveTextContent('Ready on this device');
        expect(screen.queryByText(/on your device after a one-time setup/i)).toBeNull();
        // The help lists all three modes; Private's description sets the on-device expectation.
        fireEvent.click(screen.getByTestId('stt-mode-help'));
        const about = screen.getByTestId('stt-modes-about');
        expect(about).toHaveTextContent('Private — Recommended');
        expect(about).toHaveTextContent('Browser');
        expect(about).toHaveTextContent('Cloud — Pro');
        // #1041: "Quick preview" is retired user-facing wording; Browser stands alone.
        expect(about).not.toHaveTextContent(/quick preview/i);
        expect(screen.getByTestId('stt-about-private')).toHaveTextContent(/Private runs on your device after a one-time setup/i);
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
                canUseCloudStt={false}
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

    it('Native/Cloud mic-init is never mislabelled as the blue "downloading" pill', () => {
        // isDownloadingModel is Private-only; a Browser/Cloud 'initializing' phase must not paint blue.
        render(<LiveRecordingCard {...defaultProps} mode="native" sttStatusType="initializing" statusMessage="Initializing engine..." />);
        expect(screen.getByTestId('stt-status-label')).not.toHaveAttribute('data-pill-state', 'downloading');
    });

    it('positions Browser STT with a short cue and moves the explanation into help', async () => {
        render(<LiveRecordingCard {...defaultProps} mode="native" canUsePrivate={true} canUseCloudStt={false} />);

        // #1041: the short cue is now "Browser" (Quick preview retired); no visible provider paragraph.
        expect(screen.getByTestId('stt-mode-cue')).toHaveTextContent('Browser');
        expect(screen.getByTestId('stt-mode-cue')).not.toHaveTextContent(/quick preview/i);
        expect(screen.queryByText(/FREE BROWSER/i)).toBeNull();

        // The explanation is available through "About transcription modes" using the exact approved copy.
        fireEvent.click(screen.getByTestId('stt-mode-help'));
        expect(screen.getByTestId('stt-about-native')).toHaveTextContent(
            "Uses your browser's speech recognition. Availability and accuracy vary by browser. Chrome recommended.",
        );
        expect(screen.getByTestId('stt-about-native')).not.toHaveTextContent(/quick preview/i);
    });

    it('shows NO pre-save Browser card CTA; the Private sample detail lives in help (P0.2 single post-save transition)', () => {
        render(<LiveRecordingCard {...defaultProps} mode="native" canUsePrivate={true} isPaidProUser={false} canUseCloudStt={false} />);

        // The single Browser→Private transition is post-save (status bar), so there is NO pre-save card CTA.
        expect(screen.queryByTestId('first-run-setup-private')).toBeNull();
        // Mode descriptions are not default-visible paragraphs; they live behind the About help.
        expect(screen.queryByTestId('stt-modes-about')).toBeNull();
        fireEvent.click(screen.getByTestId('stt-mode-help'));
        // The About panel lists all three modes together, Private first (Recommended).
        expect(screen.getByTestId('stt-about-private')).toBeInTheDocument();
        expect(screen.getByTestId('stt-about-native')).toBeInTheDocument();
        expect(screen.getByTestId('stt-about-cloud')).toBeInTheDocument();
        expect(screen.queryByText(/compare it with Browser/i)).toBeNull();
    });

    it('explains why Private is unavailable after the sample is unavailable', async () => {
        render(<LiveRecordingCard {...defaultProps} canUsePrivate={false} canUseCloudStt={false} />);

        fireEvent.pointerDown(screen.getByTestId(TEST_IDS.STT_MODE_SELECT));

        const privateOption = await screen.findByTestId(TEST_IDS.STT_MODE_PRIVATE);
        expect(privateOption).toHaveAttribute('data-disabled');
        expect(privateOption.textContent).toMatch(/^Private/i);
        // Locked-mode entitlement copy is readable via "About transcription modes" without selecting.
        fireEvent.click(screen.getByTestId('stt-mode-help'));
        const privDesc = screen.getByTestId('stt-about-private');
        expect(privDesc).toHaveTextContent(/Private transcription is part of Early Access/i);
        expect(privDesc).toHaveTextContent(/full session history, and deeper reports/i);
        expect(screen.getByTestId('stt-about-cloud')).toHaveTextContent(/paid Early Access/i);
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
                privateModelStatus="download-required"
                onDownloadModel={vi.fn()}
            />
        );
        // First-run note is visible; the download size detail lives in help (not in the note).
        expect(screen.getByTestId('private-first-run-note')).toBeInTheDocument();
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

    it('uses the Private-first dropdown order and tags: Private (Recommended), Browser (no badge), Cloud (Pro)', async () => {
        render(<LiveRecordingCard {...defaultProps} canUsePrivate={true} canUseCloudStt={true} />);

        fireEvent.pointerDown(screen.getByTestId(TEST_IDS.STT_MODE_SELECT));
        const priv = await screen.findByTestId(TEST_IDS.STT_MODE_PRIVATE);
        const browser = await screen.findByTestId(TEST_IDS.STT_MODE_NATIVE);
        const cloud = await screen.findByTestId(TEST_IDS.STT_MODE_CLOUD);

        expect(priv).toHaveTextContent('Private');
        expect(browser).toHaveTextContent('Browser');
        expect(cloud).toHaveTextContent('Cloud');

        // #1041: ONLY Private carries a tag (Recommended). Browser carries NO badge (Quick preview
        // removed, not replaced); Cloud = Pro.
        expect(within(priv).getByTestId('stt-mode-tag-recommended')).toBeInTheDocument();
        expect(within(browser).queryByTestId('stt-mode-tag-quick-preview')).toBeNull();
        expect(within(browser).queryByText(/quick preview/i)).toBeNull();
        expect(within(cloud).getByTestId('stt-mode-tag-pro')).toBeInTheDocument();
        expect(within(browser).queryByTestId('stt-mode-tag-recommended')).toBeNull();

        // #1041 accessibility: the Browser option's accessible name is exactly "Browser" — it must not
        // expose the retired "Native" or "Quick preview" wording to assistive tech.
        expect(browser).toHaveAccessibleName('Browser');
        expect(browser).not.toHaveAccessibleName(/native|quick preview/i);
        expect(within(cloud).queryByTestId('stt-mode-tag-recommended')).toBeNull();

        // Private-first order: Private before Browser before Cloud.
        expect(priv.compareDocumentPosition(browser) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(browser.compareDocumentPosition(cloud) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('drives exactly ONE controlled description surface from the active row (mutually exclusive)', async () => {
        // Desktop: hover + fine pointer present, so the single flyout renders.
        const original = window.matchMedia;
        window.matchMedia = vi.fn().mockImplementation((q: string) => ({
            matches: /hover:\s*hover/.test(q), media: q, onchange: null,
            addEventListener: vi.fn(), removeEventListener: vi.fn(),
            addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
        })) as unknown as typeof window.matchMedia;
        try {
            render(<LiveRecordingCard {...defaultProps} canUsePrivate={true} canUseCloudStt={true} />);
            fireEvent.pointerDown(screen.getByTestId(TEST_IDS.STT_MODE_SELECT));

            // Focus Cloud → ONE flyout, showing Cloud, linked via aria-describedby.
            const cloud = await screen.findByTestId(TEST_IDS.STT_MODE_CLOUD);
            fireEvent.focus(cloud);
            let flyouts = screen.getAllByTestId('stt-mode-flyout');
            expect(flyouts).toHaveLength(1);
            expect(flyouts[0]).toHaveAttribute('data-mode', 'cloud');
            expect(flyouts[0]).toHaveTextContent(/external transcription server/i);
            expect(cloud).toHaveAttribute('aria-describedby', 'stt-mode-flyout-desc');

            // Move to Browser → the SAME single surface switches; Cloud help is gone (not a second bubble).
            const native = screen.getByTestId(TEST_IDS.STT_MODE_NATIVE);
            fireEvent.focus(native);
            flyouts = screen.getAllByTestId('stt-mode-flyout');
            expect(flyouts).toHaveLength(1);
            expect(flyouts[0]).toHaveAttribute('data-mode', 'native');
            expect(flyouts[0]).toHaveTextContent(/browser.s speech recognition/i);
            expect(flyouts[0]).not.toHaveTextContent(/external transcription server/i);

            // Move to Private → still exactly one, now Private.
            const priv = screen.getByTestId(TEST_IDS.STT_MODE_PRIVATE);
            fireEvent.focus(priv);
            flyouts = screen.getAllByTestId('stt-mode-flyout');
            expect(flyouts).toHaveLength(1);
            expect(flyouts[0]).toHaveAttribute('data-mode', 'private');
            expect(flyouts[0]).toHaveTextContent(/on your device/i);
        } finally {
            window.matchMedia = original;
        }
    });

    it('renders NO desktop flyout without hover capability — touch relies on the About panel', async () => {
        // Global setup mock reports matches:false for every query → no hover:hover, no fine pointer.
        render(<LiveRecordingCard {...defaultProps} canUsePrivate={true} canUseCloudStt={true} />);
        fireEvent.pointerDown(screen.getByTestId(TEST_IDS.STT_MODE_SELECT));
        const cloud = await screen.findByTestId(TEST_IDS.STT_MODE_CLOUD);
        fireEvent.focus(cloud);
        expect(screen.queryByTestId('stt-mode-flyout')).toBeNull();
        // The single "About transcription modes" help trigger is the touch fallback (its panel content
        // is asserted elsewhere); no per-row info icons exist.
        expect(screen.getByTestId('stt-mode-help')).toBeInTheDocument();
    });

    it('About panel and the mode dropdown are MUTUALLY EXCLUSIVE (never both open)', async () => {
        render(<LiveRecordingCard {...defaultProps} canUsePrivate={true} canUseCloudStt={true} />);
        const help = screen.getByTestId('stt-mode-help');

        // Open the dropdown → menu present, About closed.
        fireEvent.pointerDown(screen.getByTestId(TEST_IDS.STT_MODE_SELECT));
        expect(await screen.findByRole('menu')).toBeInTheDocument();
        expect(screen.queryByTestId('stt-mode-help-content')).toBeNull();
        expect(help).toHaveAttribute('aria-expanded', 'false');

        // Open About → dropdown CLOSES (mutually exclusive), About present + a11y wired.
        fireEvent.click(help);
        expect(screen.getByTestId('stt-mode-help-content')).toBeInTheDocument();
        expect(screen.queryByRole('menu')).toBeNull();
        expect(help).toHaveAttribute('aria-expanded', 'true');
        expect(help).toHaveAttribute('aria-controls', 'stt-mode-help-content');

        // Re-open the dropdown → About CLOSES.
        fireEvent.pointerDown(screen.getByTestId(TEST_IDS.STT_MODE_SELECT));
        expect(await screen.findByRole('menu')).toBeInTheDocument();
        expect(screen.queryByTestId('stt-mode-help-content')).toBeNull();
        expect(help).toHaveAttribute('aria-expanded', 'false');

        // At no observed point were both surfaces present together.
    });

    it('Escape closes the About panel (single dismissable help surface)', async () => {
        render(<LiveRecordingCard {...defaultProps} canUsePrivate={true} canUseCloudStt={true} />);
        const help = screen.getByTestId('stt-mode-help');
        fireEvent.click(help);
        expect(screen.getByTestId('stt-mode-help-content')).toBeInTheDocument();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByTestId('stt-mode-help-content')).toBeNull();
        expect(help).toHaveAttribute('aria-expanded', 'false');
    });
});
