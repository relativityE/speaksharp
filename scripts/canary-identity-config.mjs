#!/usr/bin/env node
import { validateCanaryIdentityConfig } from './lib/canaryIdentityConfig.mjs';

const result = validateCanaryIdentityConfig({
  trialEmail: process.env.CANARY_TRIAL_EMAIL,
  paidEmail: process.env.CANARY_PAID_EMAIL,
});

console.log(JSON.stringify(result));
