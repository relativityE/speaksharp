import { describe, expect, it } from 'vitest';
import { render, screen } from '../../../tests/support/test-utils';
import { TermsPage } from '../LegalPage';
import { enablePaymentsForTest } from '../../../tests/support/payments';

describe('TermsPage product-truth contract', () => {
  it('shows the free-beta/no-checkout contract when payments are disabled', () => {
    render(<TermsPage />);

    expect(screen.getByText(/free for your first 30 days — no card required/i)).toBeInTheDocument();
    expect(screen.getByText(/checkout is not yet enabled/i)).toBeInTheDocument();
    expect(screen.queryByText(/continued access is \$10\/month/i)).not.toBeInTheDocument();
  });

  it('does not claim paid enrollment is unavailable when checkout is enabled', () => {
    enablePaymentsForTest();
    render(<TermsPage />);

    expect(screen.getByText(/continued access is \$10\/month/i)).toBeInTheDocument();
    expect(screen.getByText(/then \$10\/month to continue/i)).toBeInTheDocument();
    expect(screen.queryByText(/checkout is not yet enabled/i)).not.toBeInTheDocument();
  });
});
