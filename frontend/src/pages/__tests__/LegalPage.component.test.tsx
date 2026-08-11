import { describe, expect, it } from 'vitest';
import { render, screen } from '../../../tests/support/test-utils';
import { TermsPage } from '../LegalPage';
import { enablePaymentsForTest } from '../../../tests/support/payments';

describe('TermsPage product-truth contract', () => {
  it('shows the free-beta/no-checkout contract when payments are disabled', () => {
    render(<TermsPage />);

    expect(screen.getByText(/currently a controlled free beta/i)).toBeInTheDocument();
    expect(screen.getByText(/Paid enrollment and checkout are not currently offered/i)).toBeInTheDocument();
    expect(screen.queryByText(/Paid Pro enrollment is available/i)).not.toBeInTheDocument();
  });

  it('does not claim paid enrollment is unavailable when checkout is enabled', () => {
    enablePaymentsForTest();
    render(<TermsPage />);

    expect(screen.getByText(/Paid Pro enrollment is available/i)).toBeInTheDocument();
    expect(screen.getByText(/free practice path that requires no card or checkout/i)).toBeInTheDocument();
    expect(screen.queryByText(/Paid enrollment and checkout are not currently offered/i)).not.toBeInTheDocument();
  });
});
