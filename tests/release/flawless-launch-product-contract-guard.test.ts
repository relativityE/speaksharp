import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  HISTORICAL_EXCLUSIONS,
  isExcluded,
  isProminentlyHistoricalDocument,
  scanText,
} from '../../scripts/lib/product-contract-guard.mjs';

describe('flawless-launch product-contract guard (#1290)', () => {
  it('keeps both canary identities protected and fail-closed behind migration readiness', () => {
    const workflow = readFileSync('.github/workflows/canary.yml', 'utf8');

    // #1294 sourcing split: canary EMAILS resolve from repository Variables, PASSWORDS from Secrets.
    expect(workflow).toContain('vars.CANARY_TRIAL_EMAIL');
    expect(workflow).toContain('vars.CANARY_PAID_EMAIL');
    expect(workflow).not.toContain('secrets.CANARY_TRIAL_EMAIL');
    expect(workflow).not.toContain('secrets.CANARY_PAID_EMAIL');
    expect(workflow).toContain('secrets.CANARY_TRIAL_PASSWORD');
    expect(workflow).toContain('secrets.CANARY_PAID_PASSWORD');
    expect(workflow).toContain('node scripts/canary-identity-config.mjs');
    expect(workflow).toContain('needs.migration-readiness.outputs.ready');
    expect(workflow).toContain('HOLD — migration pending; canary not executed');
    expect(workflow).toContain('lane: active-trial');
    expect(workflow).toContain('lane: paid-continuation');
    expect(workflow).not.toMatch(/@speaksharp\.app\b/i);
  });

  it('rejects every retired launch proposition', () => {
    const fixtures = [
      ['frontend/src/pages/Home.tsx', 'Start your five-minute Private sample today'],
      ['frontend/src/pages/Pricing.tsx', 'Our Basic tier is a free plan forever'],
      ['README.md', 'Choose Browser transcription or upgrade to the Cloud option'],
      ['frontend/src/components/Usage.tsx', 'Upgrade when your 2 hours/day recording limit is reached'],
      ['frontend/src/hooks/useSessionLifecycle.ts', 'Daily usage limit reached.'],
      ['product_release/ENTITLEMENTS_AND_BILLING.md', 'Configure the monthly price at $9.99 (999 cents)'],
      ['.github/workflows/release.yml', "EXPECTED_STRIPE_PRO_AMOUNT: '999'"],
      ['scripts/price-config.mjs', "const unit_amount = 999;"],
      ['.github/workflows/canary.yml', 'CANARY_EMAIL: canary@speaksharp.app'],
      ['USER_GUIDE.md', 'Contact support@speaksharp.app'],
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
      ['.github/workflows/release.yml', "EXPECTED_STRIPE_PRO_AMOUNT: '1000'"],
      ['.github/workflows/canary.yml', 'CANARY_EMAIL: ${{ vars.CANARY_PAID_EMAIL }}'],
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

  it('requires a prominent two-part boundary before treating a root document as historical', () => {
    const contradiction = 'Cloud is the paid Pro customer option.';
    const banner = [
      '> **Status:** Historical — superseded',
      '> **Not authoritative for:** current product policy or GO/HOLD gates.',
      '> **Current authority:** `PRODUCT_REQUIREMENTS.md` and `RELEASE_PROCESS.md`.',
      '',
      contradiction,
    ].join('\n');

    expect(isProminentlyHistoricalDocument('product_release/OLD.md', banner)).toBe(true);
    expect(scanText('product_release/OLD.md', banner)).toEqual([]);
    expect(scanText('product_release/OLD.md', `> **Status:** Historical — superseded\n${contradiction}`)).not.toEqual([]);
    expect(scanText('README.md', banner)).not.toEqual([]);
  });
});
