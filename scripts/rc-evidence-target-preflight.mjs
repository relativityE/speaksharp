#!/usr/bin/env node
import { qualifyEvidenceTarget, writeEvidenceEligibility } from './lib/releaseEvidenceEligibility.mjs';
import { pathToFileURL } from 'node:url';

export async function runEvidenceTargetPreflight(env = process.env, fetchImpl = globalThis.fetch) {
  const evidenceScope = env.EVIDENCE_SCOPE || 'canonical-production';
  const result = await qualifyEvidenceTarget({
    baseUrl: env.BASE_URL,
    expectedReleaseSha: env.EXPECTED_RELEASE_SHA,
    evidenceScope,
    fetchImpl,
  });
  writeEvidenceEligibility(env.EVIDENCE_ELIGIBILITY_FILE, result);
  return result;
}

async function main() {
  const result = await runEvidenceTargetPreflight();
  console.log(`RC_EVIDENCE_TARGET ${JSON.stringify(result)}`);

  // Diagnostic evidence is intentionally ineligible but remains runnable for root-cause work. Every other
  // scope must be positively eligible or the command fails.
  if (result.evidenceScope !== 'diagnostic' && !result.releaseProofEligible) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
