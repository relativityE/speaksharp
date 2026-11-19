import { describe, expect, it } from 'vitest';
import { render, screen } from '../../../tests/support/test-utils';
import { PrivacyPage, TermsPage } from '../LegalPage';
import { legalSectionId } from '../legalSectionId';
import { PROVIDER_DETAIL_HREF } from '@/components/session/reviewCopy';
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

describe('PrivacyPage provider detail (#1820)', () => {
  it('the review card link /privacy#service-providers lands on the section that names the current AI provider', () => {
    render(<PrivacyPage />);

    const section = document.getElementById('service-providers');
    expect(section).not.toBeNull();
    expect(section?.querySelector('h2')?.textContent).toBe('Service Providers');
    expect(section?.textContent).toMatch(/Google Gemini/);
    expect(legalSectionId('Service Providers')).toBe(PROVIDER_DETAIL_HREF.split('#')[1]);
  });
});
