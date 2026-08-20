import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';

// #1294 workflow contract for Admin - Test Users. The rename is display-name ONLY; the filename, action
// names, and standard free/pro create path stay stable. The Basic tier option and Basic count inputs are
// gone, an additive create_purpose selector is present, and the four canary secrets are wired at the exact
// step that runs the provisioning script (canary passwords are never dispatch inputs).
const wf = yaml.load(readFileSync(resolve(process.cwd(), '.github/workflows/setup-test-users.yml'), 'utf8'));
const inputs = wf.on.workflow_dispatch.inputs;
const raw = readFileSync(resolve(process.cwd(), '.github/workflows/setup-test-users.yml'), 'utf8');

describe('Admin - Test Users workflow contract', () => {
  it('renames the display name only, keeping the stable action set', () => {
    expect(wf.name).toBe('Admin - Test Users');
    expect(inputs.action.options).toEqual(['setup', 'query', 'create', 'sync_reviewers']);
  });

  it('preserves standard free/pro create with NO Basic tier option', () => {
    expect(inputs.create_tier.options).toEqual(['free', 'pro']);
    expect(inputs.create_tier.options).not.toContain('basic');
    expect(inputs.create_tier.default).toBe('free');
  });

  it('removed the Basic count input alias', () => {
    expect(inputs).not.toHaveProperty('new_basic_count');
    expect(raw).not.toMatch(/new_basic_count|NEW_BASIC_COUNT/);
  });

  it('adds an additive create_purpose selector (standard default + secret-backed canary + free_test)', () => {
    expect(inputs.create_purpose.options).toEqual(['standard', 'canary_trial', 'canary_paid', 'free_test']);
    expect(inputs.create_purpose.default).toBe('standard');
  });

  it('never exposes a canary or free_test password as a dispatch input', () => {
    for (const key of Object.keys(inputs)) {
      expect(key).not.toMatch(/canary.*password|password.*canary|free_test.*password/i);
    }
  });

  it('wires test-account EMAILS from Variables and PASSWORDS from Secrets at the provisioning step (#1294 split)', () => {
    // #1294 sourcing split: test-account emails are operator-owned identifiers (Variables); passwords are
    // credentials (Secrets). All four email identifiers (canary + free/pro) resolve from Variables.
    for (const s of ['CANARY_TRIAL_EMAIL', 'CANARY_PAID_EMAIL', 'FREE_TEST_EMAIL', 'PRO_TEST_EMAIL']) {
      expect(raw).toContain(`${s}: \${{ vars.${s} }}`);
      expect(raw, `${s} must not resolve from a Secret`).not.toContain(`${s}: \${{ secrets.${s} }}`);
    }
    for (const s of ['CANARY_TRIAL_PASSWORD', 'CANARY_PAID_PASSWORD', 'FREE_TEST_PASSWORD']) {
      expect(raw).toContain(`${s}: \${{ secrets.${s} }}`);
    }
  });

  it('keeps the stable script path and filename contract', () => {
    expect(raw).toContain('node scripts/setup-test-users.mjs');
  });
});
