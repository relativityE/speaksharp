#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const checks = [
  {
    file: 'frontend/src/config/TestFlags.ts',
    description: 'ENV.isE2E is compile-time disabled in production builds',
    pattern: /get isE2E\(\): boolean \{\s*return import\.meta\.env\.MODE !== 'production' && !!getWindow\(\)\.__SS_E2E__\?\.isActive;/s,
  },
  {
    file: 'frontend/src/components/ProfileGuard.tsx',
    description: 'synthetic guest profile path is additionally production-guarded',
    pattern: /const isE2EMockMode = ENV\.isE2E && import\.meta\.env\.MODE !== 'production';/,
  },
  {
    file: 'frontend/src/hooks/useUserProfile.ts',
    description: 'test Pro rescue remains dev/E2E-only and cannot run in production after ENV guard',
    pattern: /if \(\(import\.meta\.env\.DEV \|\| ENV\.isE2E\) && isProEmail\)/,
  },
  {
    file: 'frontend/src/components/ProtectedRoute.tsx',
    description: 'protected route bypass is controlled only by hardened ENV.isE2E',
    pattern: /if \(!user && !ENV\.isE2E\)/,
  },
];

const findings = [];

for (const check of checks) {
  const source = readFileSync(check.file, 'utf8');
  if (!check.pattern.test(source)) {
    findings.push(`${check.file}: ${check.description}`);
  }
}

if (findings.length > 0) {
  console.error('RC_PRODUCTION_HARDENING_FINDINGS');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log('RC_PRODUCTION_HARDENING_OK E2E/test branches are production-guarded for controlled tester release.');
