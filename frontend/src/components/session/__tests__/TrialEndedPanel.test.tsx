import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TrialEndedPanel } from '../TrialEndedPanel';
import { TRIAL_ENDED_COPY } from '../trialStatus';
import { TrialCountdownChip } from '../TrialCountdownChip';
import { PAID_CONTINUATION_UNAVAILABLE } from '@/components/pricing/offerDisclosure';

const renderPanel = (paymentsEnabled: boolean) => render(
    <MemoryRouter><TrialEndedPanel paymentsEnabled={paymentsEnabled} /></MemoryRouter>,
);

describe('TrialEndedPanel', () => {
    it('says the trial ended and lists what still works', () => {
        renderPanel(false);
        expect(screen.getByRole('heading', { name: TRIAL_ENDED_COPY.title })).toBeInTheDocument();
        expect(screen.getByText(TRIAL_ENDED_COPY.body)).toBeInTheDocument();
        for (const { label } of TRIAL_ENDED_COPY.keeps) expect(screen.getByText(label)).toBeInTheDocument();
        expect(screen.getByTestId('trial-ended-progress')).toHaveAttribute('href', '/progress');
        expect(screen.getByTestId('trial-ended-account')).toHaveAttribute('href', '/account');
    });

    it('matches newest-one retention: never claims every transcript or review is still there', () => {
        // Retention keeps only the newest saved transcript (and its coaching); history and measurements survive.
        renderPanel(true);
        const text = screen.getByTestId('trial-ended-panel').textContent ?? '';
        expect(text).toMatch(/most recent saved transcript/i);
        expect(text).toMatch(/keeps only the newest one/i);
        expect(text).not.toMatch(/\beverything\b/i);
        expect(text).not.toMatch(/\ball (of )?your\b/i);
        expect(text).not.toMatch(/\breviews\b/i);
        expect(text).not.toMatch(/\bany saved session\b/i);
    });

    it('uses neutral paid-access wording, never a tier name', () => {
        for (const paymentsEnabled of [true, false]) {
            const { unmount } = renderPanel(paymentsEnabled);
            expect(screen.getByTestId('trial-ended-panel').textContent ?? '').not.toMatch(/\bPro\b/);
            unmount();
        }
    });

    it('with payments closed, points to Pricing without promising an upgrade', () => {
        renderPanel(false);
        expect(screen.getByTestId('trial-ended-continuation')).toHaveTextContent(PAID_CONTINUATION_UNAVAILABLE.title);
        expect(screen.queryByText(TRIAL_ENDED_COPY.continueOpen)).not.toBeInTheDocument();
        expect(screen.getByTestId('trial-ended-pricing')).toHaveAttribute('href', '/pricing');
        // It links to Pricing; it never starts checkout itself.
        expect(screen.queryByText(/checkout/i)).not.toBeInTheDocument();
    });

    it('with payments open, invites continuing with Pro through Pricing', () => {
        renderPanel(true);
        expect(screen.getByTestId('trial-ended-continuation')).toHaveTextContent(TRIAL_ENDED_COPY.continueOpen);
        expect(screen.getByTestId('trial-ended-pricing')).toHaveAttribute('href', '/pricing');
    });
});

describe('TrialCountdownChip', () => {
    it.each([
        ['calm', '20 days left in your trial', 'bg-neutral-band'],
        ['soon', '3 days left in your trial', 'bg-signature-ground'],
        ['urgent', 'Trial ends in 5 hours', 'bg-state-error-ground'],
    ] as const)('renders the %s tone', (tone, label, cls) => {
        render(<TrialCountdownChip countdown={{ tone, label }} />);
        const chip = screen.getByTestId('trial-countdown');
        expect(chip).toHaveTextContent(label);
        expect(chip).toHaveAttribute('data-trial-tone', tone);
        expect(chip.className).toContain(cls);
    });
});
