/** #1258 punch list D10 — the ended take: title "Transcript", no tick, and a card that fits its content. */
import React from 'react';
import { render, screen } from '../../../../tests/support/test-utils';
import { describe, expect, it } from 'vitest';
import { TranscriptCard } from '@/components/session/TranscriptCard';

const base = { offerDismissed: true, onDismissOffer: () => {}, onRestoreOffer: () => {}, onTakePrompt: () => {}, onReadSample: () => {} };

describe('TranscriptCard ended (D10)', () => {
    it('ended: heading "Transcript", "· n words" meta, and no h-full on the root', () => {
        render(<TranscriptCard {...base} ended headerMeta="73 words"><p>Good morning everyone.</p></TranscriptCard>);
        expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/^Transcript$/);
        expect(screen.getByTestId('transcript-header-meta')).toHaveTextContent('· 73 words');
        expect(screen.getByTestId('transcript-card').className).not.toMatch(/\bh-full\b/);
    });
    it('during/recording keeps "Live Transcript" and h-full', () => {
        render(<TranscriptCard {...base} headerMeta="12 words"><p>Live words.</p></TranscriptCard>);
        expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Live Transcript');
        expect(screen.getByTestId('transcript-card').className).toMatch(/\bh-full\b/);
    });
});
