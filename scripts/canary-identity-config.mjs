#!/usr/bin/env node
import { validateCanaryIdentityConfig } from './lib/canaryIdentityConfig.mjs';

// #1294 sourcing split: emails arrive from repository Variables, passwords from Secrets. Both emails are
// validated (valid + distinct + non-prohibited); ONLY the selected lane's password is required, so a routine
// active-trial run never depends on CANARY_PAID_PASSWORD. Never logs a value.
const result = validateCanaryIdentityConfig({
  trialEmail: process.env.CANARY_TRIAL_EMAIL,
  paidEmail: process.env.CANARY_PAID_EMAIL,
  lane: process.env.CANARY_EXPECTED_ACCESS,
  lanePassword: process.env.CANARY_LANE_PASSWORD,
});

console.log(JSON.stringify(result));
