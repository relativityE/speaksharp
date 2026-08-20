#!/usr/bin/env node
// #1260 — inspect the hosted ALLOWED_ORIGIN value without printing or persisting it.

import { readFileSync } from 'node:fs';
import { scanText } from './no-unaffiliated-domain-scan.mjs';

let payload;
try {
  payload = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  console.error('[hosted-origin-check] invalid Management API response');
  process.exit(1);
}

if (!Array.isArray(payload)) {
  console.error('[hosted-origin-check] expected a secret list');
  process.exit(1);
}

const matches = payload.filter((entry) => entry?.name === 'ALLOWED_ORIGIN');
if (matches.length !== 1 || typeof matches[0].value !== 'string') {
  console.error('[hosted-origin-check] ALLOWED_ORIGIN is missing or malformed');
  process.exit(1);
}

if (scanText(matches[0].value).length > 0) {
  console.error('[hosted-origin-check] FAIL — hosted ALLOWED_ORIGIN contains an unaffiliated entry');
  process.exit(1);
}

console.log('[hosted-origin-check] PASS — hosted ALLOWED_ORIGIN contains no unaffiliated entry');
