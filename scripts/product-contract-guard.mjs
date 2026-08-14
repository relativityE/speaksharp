#!/usr/bin/env node
import { formatViolations, scanRepository } from './lib/product-contract-guard.mjs';

const violations = scanRepository();
if (violations.length > 0) {
  console.error(`[product-contract] ${violations.length} active contract violation(s):`);
  console.error(formatViolations(violations));
  process.exit(1);
}

console.log('[product-contract] active customer/runtime/release surfaces match the locked launch contract');
