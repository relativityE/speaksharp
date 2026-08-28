import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UnresolvedRecoveryBanner, DISCARD_CONFIRMATION_COPY } from '../UnresolvedRecoveryBanner';

// #1033 Part-2b (A3/A4). These assert HANDLER INVOCATION and STATE TRANSITIONS, not just text.
// Boundary note: "unlocks" is a controller guarantee already proven in
// SpeechRuntimeController.test.ts (successful retryRecordingSave / discardUnresolvedRecording clear
// recordingStartedUnresolved). Here we prove the UI invokes exactly the right operation, exactly
// once, and reacts honestly to its result — including never reaching discard in attribution state.

const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
};

let onRetry: ReturnType<typeof vi.fn>;
let onDiscard: ReturnType<typeof vi.fn>;

const setup = (kind: 'initial_save' | 'full_save' | 'attribution' | null, hasWords = true) => {
    render(
        <UnresolvedRecoveryBanner
            pendingResolutionKind={kind}
            hasTranscriptText={hasWords}
            hasMeasurementsOnly={false}
            onRetry={onRetry as unknown as () => Promise<boolean>}
            onDiscard={onDiscard as unknown as () => Promise<{ outcome: 'discarded' | 'retryable' }>}
        />,
    );
};

beforeEach(() => {
    onRetry = vi.fn().mockResolvedValue(true);
    onDiscard = vi.fn().mockResolvedValue({ outcome: 'discarded' });
});

describe('#1033 A3/A4 unresolved-recording recovery surface', () => {
    it('1. initial_save renders Retry Save and Discard…', () => {
        setup('initial_save');
        expect(screen.getByTestId('session-retry-save')).toBeInTheDocument();
        expect(screen.getByTestId('session-discard')).toBeInTheDocument();
        expect(screen.getByTestId('session-unresolved-message')).toHaveTextContent(/has not been saved yet/i);
    });

    it('2. full_save renders Retry Save and Discard…', () => {
        setup('full_save');
        expect(screen.getByTestId('session-retry-save')).toBeInTheDocument();
        expect(screen.getByTestId('session-discard')).toBeInTheDocument();
        expect(screen.getByTestId('session-unresolved-message')).toHaveTextContent(/not fully saved/i);
    });

    it('3. attribution renders Retry verification and states the transcript IS saved', () => {
        setup('attribution');
        expect(screen.getByTestId('session-retry-verification')).toHaveTextContent(/retry verification/i);
        expect(screen.getByTestId('session-unresolved-message')).toHaveTextContent(/transcript was saved/i);
    });

    it('4. attribution renders NEITHER Retry Save NOR Discard (structurally absent from the DOM)', () => {
        setup('attribution');
        expect(screen.queryByTestId('session-retry-save')).toBeNull();
        expect(screen.queryByTestId('session-discard')).toBeNull();
        expect(screen.queryByTestId('session-discard-confirm')).toBeNull();
        expect(screen.queryByText(DISCARD_CONFIRMATION_COPY)).toBeNull();
        // no control anywhere offers discard
        expect(screen.queryByRole('button', { name: /discard/i })).toBeNull();
    });

    it('5. Retry verification invokes retry EXACTLY ONCE and NEVER invokes discard', async () => {
        const user = userEvent.setup();
        setup('attribution');
        await user.click(screen.getByTestId('session-retry-verification'));
        await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));
        expect(onDiscard).not.toHaveBeenCalled();
    });

    it('6. successful retry invokes the retry op and clears the error state', async () => {
        const user = userEvent.setup();
        setup('full_save');
        await user.click(screen.getByTestId('session-retry-save'));
        await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));
        // No failure copy: the controller owns clearing recovery state + unlocking (proven in its own suite).
        await waitFor(() => expect(screen.getByTestId('session-unresolved-message')).not.toHaveTextContent(/failed/i));
    });

    it('7. failed retry PRESERVES the actionable surface and shows a retryable error', async () => {
        const user = userEvent.setup();
        onRetry.mockResolvedValue(false);
        setup('full_save');
        await user.click(screen.getByTestId('session-retry-save'));
        await waitFor(() => expect(screen.getByTestId('session-unresolved-message')).toHaveTextContent(/saving failed again/i));
        // surface + both actions remain available for another attempt
        expect(screen.getByTestId('session-unresolved-recovery')).toBeInTheDocument();
        expect(screen.getByTestId('session-retry-save')).toBeEnabled();
        expect(screen.getByTestId('session-discard')).toBeEnabled();
    });

    it('7b. failed VERIFICATION retry says verification — never "saving"', async () => {
        const user = userEvent.setup();
        onRetry.mockResolvedValue(false);
        setup('attribution');
        await user.click(screen.getByTestId('session-retry-verification'));
        await waitFor(() => expect(screen.getByTestId('session-unresolved-message')).toHaveTextContent(/verification failed again/i));
        expect(screen.getByTestId('session-unresolved-message')).not.toHaveTextContent(/saving/i);
    });

    it('8. discard requires the exact approved confirmation before invoking anything', async () => {
        const user = userEvent.setup();
        setup('initial_save');
        await user.click(screen.getByTestId('session-discard'));
        expect(onDiscard).not.toHaveBeenCalled(); // first click only reveals confirmation
        const confirm = screen.getByTestId('session-discard-confirm');
        expect(confirm).toHaveTextContent(DISCARD_CONFIRMATION_COPY);
        expect(DISCARD_CONFIRMATION_COPY).toBe(
            'Permanently discard this unsaved recording? Its recoverable transcript will be removed. This cannot be undone.',
        );
        await user.click(confirm);
        await waitFor(() => expect(onDiscard).toHaveBeenCalledTimes(1));
    });

    it('9. successful discard invokes discard once and leaves no error', async () => {
        const user = userEvent.setup();
        setup('full_save');
        await user.click(screen.getByTestId('session-discard'));
        await user.click(screen.getByTestId('session-discard-confirm'));
        await waitFor(() => expect(onDiscard).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.getByTestId('session-unresolved-message')).not.toHaveTextContent(/could not discard/i));
    });

    it('10. RETRYABLE discard preserves the recording + surface and says so honestly', async () => {
        const user = userEvent.setup();
        onDiscard.mockResolvedValue({ outcome: 'retryable' });
        setup('full_save');
        await user.click(screen.getByTestId('session-discard'));
        await user.click(screen.getByTestId('session-discard-confirm'));
        await waitFor(() => expect(screen.getByTestId('session-unresolved-message')).toHaveTextContent(/could not discard it cleanly/i));
        expect(screen.getByTestId('session-unresolved-message')).toHaveTextContent(/recording was kept/i);
        expect(screen.getByTestId('session-unresolved-recovery')).toBeInTheDocument();
    });

    it('11. controls disable in flight and repeated activation cannot submit a second operation', async () => {
        const user = userEvent.setup();
        const d = deferred<boolean>();
        onRetry.mockReturnValue(d.promise);
        setup('full_save');
        const retry = screen.getByTestId('session-retry-save');
        await user.click(retry);
        await waitFor(() => expect(retry).toBeDisabled());
        expect(screen.getByTestId('session-discard')).toBeDisabled();
        // hammer it while in flight
        await user.click(retry).catch(() => undefined);
        await user.click(retry).catch(() => undefined);
        expect(onRetry).toHaveBeenCalledTimes(1);
        d.resolve(true);
        await waitFor(() => expect(screen.getByTestId('session-retry-save')).toBeEnabled());
    });

    it('12. null renders NO recovery surface; the surface is announced accessibly when present', () => {
        const { unmount } = render(
            <UnresolvedRecoveryBanner
                pendingResolutionKind={null}
                hasTranscriptText
                hasMeasurementsOnly={false}
                onRetry={onRetry as unknown as () => Promise<boolean>}
                onDiscard={onDiscard as unknown as () => Promise<{ outcome: 'discarded' | 'retryable' }>}
            />,
        );
        expect(screen.queryByTestId('session-unresolved-recovery')).toBeNull();
        unmount();

        setup('full_save');
        const surface = screen.getByTestId('session-unresolved-recovery');
        expect(surface).toHaveAttribute('role', 'status');
        expect(surface).toHaveAttribute('aria-live', 'polite');
        // controls are real, focusable buttons (keyboard reachable), not div click handlers
        expect(screen.getByRole('button', { name: /retry save/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /discard/i })).toBeInTheDocument();
    });

    it('conditional claim: "Your words are still here" only when recoverable content exists', () => {
        const { unmount } = render(
            <UnresolvedRecoveryBanner
                pendingResolutionKind="full_save"
                hasTranscriptText={false}
                hasMeasurementsOnly={false}
                onRetry={onRetry as unknown as () => Promise<boolean>}
                onDiscard={onDiscard as unknown as () => Promise<{ outcome: 'discarded' | 'retryable' }>}
            />,
        );
        expect(screen.getByTestId('session-unresolved-message')).not.toHaveTextContent(/your words are still here/i);
        unmount();

        setup('full_save', true);
        expect(screen.getByTestId('session-unresolved-message')).toHaveTextContent(/your words are still here/i);
    });
});

/**
 * #1360 — THE METRICS-ONLY STATE, which is where the remaining copy defect lived.
 *
 * The corrected recovery panel is suppressed while this banner is showing, so during the main retry
 * path this banner is the ONLY thing the user reads. It used to take a single `hasRecoverableWords`
 * that was true whenever a content-free draft carried a numeric `totalWords` — and then say "Your
 * words are still here" and offer to remove "its recoverable transcript". No words and no transcript
 * were ever stored. A COUNT of words is not words.
 */
describe('#1360 metrics-only: no transcript claim without transcript text', () => {
    const renderMetricsOnly = (kind: 'initial_save' | 'full_save' = 'full_save') =>
        render(
            <UnresolvedRecoveryBanner
                pendingResolutionKind={kind}
                hasTranscriptText={false}
                hasMeasurementsOnly
                onRetry={async () => true}
                onDiscard={async () => ({ outcome: 'discarded' as const })}
            />,
        );

    it('does NOT say the user\'s words are still here', () => {
        renderMetricsOnly();
        expect(screen.getByTestId('session-unresolved-message').textContent ?? '')
            .not.toMatch(/your words are still here/i);
    });

    it('says what actually survived — measurements on this device', () => {
        renderMetricsOnly();
        expect(screen.getByTestId('session-unresolved-message').textContent ?? '')
            .toMatch(/measurements from this session are still on this device/i);
    });

    it('the discard confirmation does not promise to remove a transcript', async () => {
        const user = userEvent.setup();
        renderMetricsOnly();
        // `userEvent`, not a raw `.click()`: the raw call does not flush React's state update, so the
        // confirmation button never appears and the test fails for the wrong reason.
        await user.click(screen.getByTestId('session-discard'));
        const confirm = screen.getByTestId('session-discard-confirm').textContent ?? '';
        expect(confirm).not.toMatch(/transcript will be removed/i);
        expect(confirm).toMatch(/measurements will be removed/i);
        expect(confirm).toMatch(/no transcript was stored/i);
        // Still a real confirmation: destructive and irreversible.
        expect(confirm).toMatch(/cannot be undone/i);
    });

    it('WITH transcript text, the transcript wording returns — the rule is conditional, not a ban', async () => {
        // Positive control. Without it, simply deleting the transcript copy would pass every
        // assertion above while making the banner wrong in the other direction.
        const user = userEvent.setup();
        render(
            <UnresolvedRecoveryBanner
                pendingResolutionKind="full_save"
                hasTranscriptText
                hasMeasurementsOnly={false}
                onRetry={async () => true}
                onDiscard={async () => ({ outcome: 'discarded' as const })}
            />,
        );
        expect(screen.getByTestId('session-unresolved-message').textContent ?? '')
            .toMatch(/your words are still here/i);
        await user.click(screen.getByTestId('session-discard'));
        expect(screen.getByTestId('session-discard-confirm').textContent)
            .toBe(DISCARD_CONFIRMATION_COPY);
    });

    it('with NEITHER, it claims nothing about content at all', () => {
        render(
            <UnresolvedRecoveryBanner
                pendingResolutionKind="initial_save"
                hasTranscriptText={false}
                hasMeasurementsOnly={false}
                onRetry={async () => true}
                onDiscard={async () => ({ outcome: 'discarded' as const })}
            />,
        );
        const message = screen.getByTestId('session-unresolved-message').textContent ?? '';
        expect(message).not.toMatch(/your words|transcript|measurements/i);
    });

    it('THE OLD INFERENCE FAILS: a numeric word count must not license transcript wording', async () => {
        const user = userEvent.setup();
        // This is the defect stated as a test. The old component derived one boolean from
        // `totalWords > 0 || liveTranscript`, so a metrics-only draft rendered the transcript copy.
        // The prop split makes that inference unrepresentable: there is no way to pass "a count" and
        // have the transcript sentence appear.
        renderMetricsOnly('initial_save');
        const message = screen.getByTestId('session-unresolved-message').textContent ?? '';
        expect(message).not.toMatch(/words/i);
        await user.click(screen.getByTestId('session-discard'));
        expect(screen.getByTestId('session-discard-confirm').textContent)
            .not.toBe(DISCARD_CONFIRMATION_COPY);
    });
});
