import { render, screen } from '../../../tests/support/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { FreePlanSupport } from '@/components/FreePlanSupport';
import { enablePaymentsForTest } from '../../../tests/support/payments';

// Render the panel deterministically regardless of route/placement gating.
vi.mock('@/services/freePlanSupport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/freePlanSupport')>();
  return { ...actual, canShowFreePlanSupport: () => true };
});

describe('FreePlanSupport — checkout surface fail-closed gating (P0.1)', () => {
  // Fail-closed beta DEFAULT (no opt-in): the support panel renders but exposes NO Upgrade control.
  it('renders NO actionable Upgrade control when payments are disabled (beta default)', () => {
    render(<FreePlanSupport tier="free" placement="dashboard-lower" />);
    expect(screen.getByLabelText('Free plan support')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Upgrade to Pro/i })).not.toBeInTheDocument();
  });

  it('shows the Upgrade control only under local payments-enabled opt-in', () => {
    enablePaymentsForTest(); // stubs both VITE_PAYMENTS_ENABLED=true + a live-class key
    render(<FreePlanSupport tier="free" placement="dashboard-lower" />);
    expect(screen.getByRole('button', { name: /Upgrade to Pro/i })).toBeInTheDocument();
  });
});
