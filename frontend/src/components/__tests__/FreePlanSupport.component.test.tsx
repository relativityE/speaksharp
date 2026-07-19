import { render, screen } from '../../../tests/support/test-utils';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { FreePlanSupport } from '@/components/FreePlanSupport';
import * as runtimeConfig from '@/config/appRuntimeConfig';

// Render the panel deterministically regardless of route/placement gating.
vi.mock('@/services/freePlanSupport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/freePlanSupport')>();
  return { ...actual, canShowFreePlanSupport: () => true };
});

afterEach(() => vi.restoreAllMocks());

describe('FreePlanSupport — checkout surface fail-closed gating (P0.1)', () => {
  it('shows the Upgrade control when payments are enabled', () => {
    vi.spyOn(runtimeConfig, 'arePaymentsEnabled').mockReturnValue(true);
    render(<FreePlanSupport tier="free" placement="dashboard-lower" />);
    expect(screen.getByRole('button', { name: /Upgrade to Pro/i })).toBeInTheDocument();
  });

  it('renders NO actionable Upgrade control when payments are disabled (fail-closed beta)', () => {
    vi.spyOn(runtimeConfig, 'arePaymentsEnabled').mockReturnValue(false);
    render(<FreePlanSupport tier="free" placement="dashboard-lower" />);
    // The support panel still renders (it is not a checkout surface by itself),
    // but the actionable Upgrade control must be absent.
    expect(screen.getByLabelText('Free plan support')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Upgrade to Pro/i })).not.toBeInTheDocument();
  });
});
