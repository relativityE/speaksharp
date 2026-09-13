import { writeFileSync } from 'node:fs';

export const CANONICAL_PRODUCTION_ORIGIN = 'https://speaksharp-public.vercel.app';
const FULL_SHA = /^[0-9a-f]{40}$/;

function normalizedTarget(raw) {
  try {
    const url = new URL(raw);
    const exactRoot = url.pathname === '/' && url.search === '' && url.hash === ''
      && url.username === '' && url.password === '';
    return { origin: url.origin, exactRoot };
  } catch {
    return { origin: null, exactRoot: false };
  }
}

export function extractDeployedRelease(html) {
  if (typeof html !== 'string') return null;
  const match = html.match(/window\.__APP_RELEASE__\s*=\s*["']([0-9a-f]{40})["']/i);
  return match ? match[1].toLowerCase() : null;
}

export function evaluateProductionEvidenceTarget({ baseUrl, expectedReleaseSha, observedReleaseSha } = {}) {
  const reasons = [];
  const target = normalizedTarget(baseUrl);
  const expected = typeof expectedReleaseSha === 'string' ? expectedReleaseSha.toLowerCase() : '';
  const observed = typeof observedReleaseSha === 'string' ? observedReleaseSha.toLowerCase() : '';

  if (target.origin !== CANONICAL_PRODUCTION_ORIGIN || !target.exactRoot) {
    reasons.push('not_canonical_production_url');
  }
  if (!FULL_SHA.test(expected)) reasons.push('expected_release_sha_missing_or_invalid');
  if (!FULL_SHA.test(observed)) reasons.push('deployed_release_sha_missing_or_invalid');
  if (FULL_SHA.test(expected) && FULL_SHA.test(observed) && expected !== observed) {
    reasons.push('deployed_release_sha_mismatch');
  }

  return {
    schemaVersion: 1,
    evidenceScope: 'canonical-production',
    releaseProofEligible: reasons.length === 0,
    origin: target.origin,
    expectedReleaseSha: expected || null,
    observedReleaseSha: observed || null,
    reasons,
  };
}

export function classifyDiagnosticEvidence({ baseUrl, observedReleaseSha = null } = {}) {
  const target = normalizedTarget(baseUrl);
  return {
    schemaVersion: 1,
    evidenceScope: 'diagnostic',
    releaseProofEligible: false,
    origin: target.origin,
    expectedReleaseSha: null,
    observedReleaseSha: observedReleaseSha || null,
    reasons: [target.origin === CANONICAL_PRODUCTION_ORIGIN
      ? 'diagnostic_run_ineligible_for_release_proof'
      : 'preview_or_noncanonical_run_ineligible_for_release_proof'],
  };
}

export async function qualifyEvidenceTarget({
  baseUrl,
  expectedReleaseSha,
  evidenceScope = 'canonical-production',
  fetchImpl = globalThis.fetch,
} = {}) {
  if (evidenceScope === 'diagnostic') return classifyDiagnosticEvidence({ baseUrl });
  if (evidenceScope !== 'canonical-production') {
    return {
      schemaVersion: 1,
      evidenceScope: evidenceScope ?? null,
      releaseProofEligible: false,
      origin: normalizedTarget(baseUrl).origin,
      expectedReleaseSha: expectedReleaseSha ?? null,
      observedReleaseSha: null,
      reasons: ['unknown_evidence_scope'],
    };
  }

  // Reject a Preview/lookalike/malformed target before attempting any network read. Besides being
  // cheaper, this keeps a user-provided release URL from turning the gate into an arbitrary fetcher.
  const inputOnly = evaluateProductionEvidenceTarget({
    baseUrl,
    expectedReleaseSha,
    observedReleaseSha: null,
  });
  if (inputOnly.reasons.includes('not_canonical_production_url')
      || inputOnly.reasons.includes('expected_release_sha_missing_or_invalid')) {
    return inputOnly;
  }

  let observedReleaseSha = null;
  let readFailure = null;
  try {
    const response = await fetchImpl(baseUrl, {
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: { accept: 'text/html' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    observedReleaseSha = extractDeployedRelease(await response.text());
  } catch (error) {
    readFailure = error instanceof Error ? error.message : String(error);
  }

  const result = evaluateProductionEvidenceTarget({ baseUrl, expectedReleaseSha, observedReleaseSha });
  if (readFailure) result.reasons.push('deployed_release_read_failed');
  result.releaseProofEligible = result.reasons.length === 0;
  return result;
}

export function writeEvidenceEligibility(path, result) {
  if (!path) return;
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
}
