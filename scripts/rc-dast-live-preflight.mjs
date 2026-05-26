import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

const groups = [
  {
    label: 'BASE_URL',
    alternatives: ['BASE_URL'],
    reason: 'targets the intended deployed app instead of an implicit default',
  },
  {
    label: 'Supabase URL',
    alternatives: ['SUPABASE_URL', 'VITE_SUPABASE_URL'],
    reason: 'runs live auth, function, and session metadata checks',
  },
  {
    label: 'Supabase anon key',
    alternatives: ['SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY'],
    reason: 'signs in live test users and calls authenticated functions',
  },
  {
    label: 'SUPABASE_SERVICE_ROLE_KEY',
    alternatives: ['SUPABASE_SERVICE_ROLE_KEY'],
    reason: 'creates live cloud-token users and reads live session metadata',
  },
  {
    label: 'Basic test email',
    alternatives: ['E2E_BASIC_EMAIL'],
    reason: 'proves Basic-tier live mode restrictions and custom word persistence',
  },
  {
    label: 'Basic test password',
    alternatives: ['E2E_BASIC_PASSWORD'],
    reason: 'signs in the Basic live test user',
  },
  {
    label: 'Pro test email',
    alternatives: ['PRO_TEST_EMAIL', 'E2E_PRO_EMAIL'],
    reason: 'proves Pro live STT switching, checkout readiness, and engine metadata',
  },
  {
    label: 'Pro test password',
    alternatives: ['PRO_TEST_PASSWORD', 'E2E_PRO_PASSWORD'],
    reason: 'signs in the Pro live test user',
  },
  {
    label: 'STRIPE_WEBHOOK_SECRET',
    alternatives: ['STRIPE_WEBHOOK_SECRET'],
    reason: 'proves signed Stripe webhook readiness instead of skipping it',
    validate: (value) => /^whsec_/.test(value) && !/mock/i.test(value),
    validationMessage: 'must be a non-mock Stripe webhook signing secret beginning with whsec_',
  },
];

const missing = [];
const invalid = [];

for (const group of groups) {
  const values = group.alternatives
    .map((name) => ({ name, value: process.env[name] }))
    .filter((entry) => Boolean(entry.value));

  if (values.length === 0) {
    missing.push(group);
    continue;
  }

  if (group.validate && !values.some((entry) => group.validate(entry.value))) {
    invalid.push(group);
  }
}

if (missing.length || invalid.length) {
  console.error('RC_DAST_LIVE_PREFLIGHT_FAILED');
  if (missing.length) {
    console.error('\nMissing required live gate environment groups:');
    for (const group of missing) {
      console.error(`- ${group.label} (${group.alternatives.join(' or ')}): ${group.reason}`);
    }
  }

  if (invalid.length) {
    console.error('\nInvalid live gate environment groups:');
    for (const group of invalid) {
      console.error(`- ${group.label}: ${group.validationMessage}`);
    }
  }

  console.error('\nLive DAST must fail when required proof inputs are absent; skipped live tests are not release evidence.');
  process.exit(1);
}

console.log('RC_DAST_LIVE_PREFLIGHT_OK required live proof inputs are present.');
