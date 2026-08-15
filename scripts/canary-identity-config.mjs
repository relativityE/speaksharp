#!/usr/bin/env node
import { validateCanaryIdentityConfig } from './lib/canaryIdentityConfig.mjs';

// #1294 sourcing split: emails arrive from repository Variables, passwords from Secrets. The guard requires
// all four to be present (emails valid + distinct + non-prohibited; passwords present) — never logging a value.
const result = validateCanaryIdentityConfig({
  trialEmail: process.env.CANARY_TRIAL_EMAIL,
  paidEmail: process.env.CANARY_PAID_EMAIL,
  trialPassword: process.env.CANARY_TRIAL_PASSWORD,
  paidPassword: process.env.CANARY_PAID_PASSWORD,
});

console.log(JSON.stringify(result));
