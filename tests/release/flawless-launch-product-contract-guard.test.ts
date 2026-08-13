import { describe, expect, it } from 'vitest';
import {
  HISTORICAL_EXCLUSIONS,
  isExcluded,
  scanText,
} from '../../scripts/lib/product-contract-guard.mjs';

describe('flawless-launch product-contract guard (#1290)', () => {
  it('rejects every retired launch proposition', () => {
    const fixtures = [
      ['frontend/src/pages/Home.tsx', 'Start your five-minute Private sample today'],
      ['frontend/src/pages/Pricing.tsx', 'Our Basic tier is a free plan forever'],
      ['README.md', 'Choose Browser transcription or upgrade to the Cloud option'],
      ['frontend/src/components/Usage.tsx', 'Upgrade when your 2 hours/day recording limit is reached'],
      ['product_release/ENTITLEMENTS_AND_BILLING.md', 'Configure the monthly price at $9.99 (999 cents)'],
    ] as const;

    for (const [path, source] of fixtures) {
      expect(scanText(path, source), `${path} should fail`).not.toEqual([]);
    }
  });

  it('allows the locked contract and explicit retirement statements', () => {
    const fixtures = [
      ['frontend/src/pages/Pricing.tsx', 'The complete Private Practice product is free for 30 days, then $10/month.'],
      ['product_release/PRODUCT_REQUIREMENTS.md', 'Browser and Cloud are not customer entitlements.'],
      ['product_release/PRODUCT_REQUIREMENTS.md', 'There is no five-minute Private sample.'],
      ['product_release/PRODUCT_REQUIREMENTS.md', 'Daily and monthly accumulated-minute quotas are retired.'],
      ['product_release/PRODUCT_REQUIREMENTS.md', 'The former $9.99 price is rejected; launch pricing is exactly $10.'],
    ] as const;

    for (const [path, source] of fixtures) {
      expect(scanText(path, source), `${path} should pass`).toEqual([]);
    }
  });

  it('does not let a nearby retirement statement hide an active contradiction', () => {
    const source = [
      '- Browser remains an available customer option.',
      '- Cloud is not a customer entitlement.',
    ].join('\n');

    expect(scanText('product_release/PRODUCT_REQUIREMENTS.md', source)).toEqual([
      expect.objectContaining({
        line: 1,
        rule: 'browser-cloud-customer-entitlement',
      }),
    ]);
  });

  it('keeps the historical exclusion list narrow and explicit', () => {
    expect(HISTORICAL_EXCLUSIONS).toEqual([
      'backend/supabase/migrations/',
      'product_release/archive/',
      'product_release/evidence/',
      'product_release/v4_work/',
    ]);
    expect(isExcluded('product_release/evidence/old-report.md')).toBe(true);
    expect(isExcluded('product_release/RELEASE_STATUS.md')).toBe(false);
    expect(isExcluded('frontend/src/pages/PricingPage.tsx')).toBe(false);
    expect(isExcluded('tests/live/stt-switching-contract.live.spec.ts')).toBe(false);
  });
});
