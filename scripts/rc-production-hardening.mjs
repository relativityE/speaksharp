#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { evaluatePreflight } from './stt-launch-preflight.mjs';

const checks = [
  {
    file: 'frontend/src/config/TestFlags.ts',
    description: 'ENV.isE2E is compile-time disabled in production builds',
    pattern: /get isE2E\(\): boolean \{\s*return import\.meta\.env\.MODE !== 'production' && !!getWindow\(\)\.__SS_E2E__\?\.isActive;/s,
  },
  {
    file: 'frontend/src/components/ProfileGuard.tsx',
    description: 'synthetic guest profile path is routed through production-guarded ENV.isE2E',
    pattern: /const isE2EMockMode = ENV\.isE2E;/,
  },
  {
    file: 'frontend/src/components/ProtectedRoute.tsx',
    description: 'protected route bypass is controlled only by hardened ENV.isE2E',
    pattern: /if \(!user && !ENV\.isE2E\)/,
  },
];

const forbiddenChecks = [
  {
    file: 'frontend/src/contexts/AuthProvider.tsx',
    description: 'manual auth provider must not inject devBypass profile sessions',
    pattern: /devBypass|dev-bypass|dev@speaksharp\.app/,
  },
  {
    file: 'frontend/src/hooks/useUserProfile.ts',
    description: 'profile hook must not synthesize Pro/test profiles',
    pattern: /isProEmail|pro-user|testuser|test@example\.com|sub_e2e_paid_pro|devBypass/,
  },
  {
    file: 'frontend/src/hooks/useSessionLifecycle.ts',
    description: 'session lifecycle must not grant entitlements from VITE_DEV_USER',
    pattern: /VITE_DEV_USER|isDevUser/,
  },
];

const findings = [];

for (const check of checks) {
  const source = readFileSync(check.file, 'utf8');
  if (!check.pattern.test(source)) {
    findings.push(`${check.file}: ${check.description}`);
  }
}

for (const check of forbiddenChecks) {
  const source = readFileSync(check.file, 'utf8');
  if (check.pattern.test(source)) {
    findings.push(`${check.file}: ${check.description}`);
  }
}

// #1120 S1 (PR #1155): executable STT launch preflight. Fail the release if the STT Cloud gates are
// misconfigured for the launch posture — client/Edge disagreement, or either/both Cloud gates ON. Reads
// the REAL configured release env; hierarchy rollback (Cloud still OFF) is independently acceptable.
const sttPreflight = evaluatePreflight(process.env);
if (sttPreflight.publicReleaseBlocked) {
  findings.push(`STT launch preflight BLOCKED (${sttPreflight.state}): ${sttPreflight.reasons.join('; ')}`);
}

if (findings.length > 0) {
  console.error('RC_PRODUCTION_HARDENING_FINDINGS');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log('RC_PRODUCTION_HARDENING_OK E2E/test branches are production-guarded for controlled tester release.');
