import { render, screen, fireEvent } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { TranscriptCard, type TranscriptCardProps } from '../TranscriptCard';

// #1222 S3 — the transcript card's before-state: offer overlay, dismissal, recovery link, prompt-in-place.
describe('TranscriptCard (#1222 S3)', () => {
    const base: TranscriptCardProps = {
        offerDismissed: false,
        onDismissOffer: vi.fn(),
        onRestoreOffer: vi.fn(),
        onTakePrompt: vi.fn(),
        onReadSample: vi.fn(),
    };

    it('shows the prompt offer as an overlay inside the empty frame (not its own card)', () => {
        render(<TranscriptCard {...base} />);
        // The offer lives INSIDE the transcript card's dashed empty frame.
        const frame = screen.getByTestId('transcript-empty-frame');
        expect(frame).toContainElement(screen.getByTestId('prompt-offer'));
        expect(screen.getByTestId('transcript-card')).toHaveAttribute('data-transcript-state', 'offer');
        // Matched pair, both buttons.
        expect(screen.getByTestId('prompt-offer-give')).toBeInTheDocument();
        expect(screen.getByTestId('prompt-offer-sample')).toBeInTheDocument();
    });

    it('offer buttons invoke their handlers', () => {
        const onTakePrompt = vi.fn();
        const onReadSample = vi.fn();
        render(<TranscriptCard {...base} onTakePrompt={onTakePrompt} onReadSample={onReadSample} />);
        fireEvent.click(screen.getByTestId('prompt-offer-give'));
        fireEvent.click(screen.getByTestId('prompt-offer-sample'));
        expect(onTakePrompt).toHaveBeenCalledOnce();
        expect(onReadSample).toHaveBeenCalledOnce();
    });

    it('✕ dismisses the offer; when dismissed the plain empty state + recovery link show', () => {
        const onDismissOffer = vi.fn();
        const { rerender } = render(<TranscriptCard {...base} onDismissOffer={onDismissOffer} />);
        fireEvent.click(screen.getByTestId('transcript-dismiss-offer'));
        expect(onDismissOffer).toHaveBeenCalledOnce();

        // Parent flips offerDismissed → plain empty state, no offer, recovery link appears.
        rerender(<TranscriptCard {...base} offerDismissed />);
        expect(screen.queryByTestId('prompt-offer')).toBeNull();
        expect(screen.getByTestId('transcript-plain-empty')).toBeInTheDocument();
        expect(screen.getByTestId('transcript-card')).toHaveAttribute('data-transcript-state', 'empty');
        expect(screen.getByTestId('transcript-need-prompt')).toBeInTheDocument();
    });

    it('the recovery link restores the offer', () => {
        const onRestoreOffer = vi.fn();
        render(<TranscriptCard {...base} offerDismissed onRestoreOffer={onRestoreOffer} />);
        fireEvent.click(screen.getByTestId('transcript-need-prompt'));
        expect(onRestoreOffer).toHaveBeenCalledOnce();
    });

    it('a chosen prompt replaces the offer IN PLACE (same frame) and can be re-rolled', () => {
        const onRerollPrompt = vi.fn();
        render(<TranscriptCard {...base} chosenPrompt="Describe a place you love." onRerollPrompt={onRerollPrompt} />);
        const frame = screen.getByTestId('transcript-empty-frame'); // still the same frame — card did not move
        expect(frame).toContainElement(screen.getByTestId('transcript-chosen-prompt'));
        expect(screen.queryByTestId('prompt-offer')).toBeNull();
        expect(screen.getByText('Describe a place you love.')).toBeInTheDocument();
        expect(screen.getByTestId('transcript-card')).toHaveAttribute('data-transcript-state', 'prompt');
        fireEvent.click(screen.getByTestId('transcript-reroll-prompt'));
        expect(onRerollPrompt).toHaveBeenCalledOnce();
    });

    it('transcript content wins over the offer (later live/after states)', () => {
        render(
            <TranscriptCard {...base}>
                <p>live words appear here</p>
            </TranscriptCard>,
        );
        expect(screen.getByTestId('transcript-content')).toBeInTheDocument();
        expect(screen.queryByTestId('prompt-offer')).toBeNull();
        expect(screen.getByTestId('transcript-card')).toHaveAttribute('data-transcript-state', 'content');
    });
});
