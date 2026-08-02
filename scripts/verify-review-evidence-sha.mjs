import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const FULL_CANONICAL_SHA = /^[0-9a-f]{40}$/;

export function verifyReviewEvidenceSha(expectedSha, {
  repoRoot = process.cwd(),
  resolveHead = () => execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim(),
} = {}) {
  if (!FULL_CANONICAL_SHA.test(expectedSha ?? '')) {
    throw new Error('reviewed_sha must be a canonical lowercase 40-character Git SHA');
  }

  const actualSha = resolveHead();
  if (!FULL_CANONICAL_SHA.test(actualSha)) {
    throw new Error('checked-out HEAD did not resolve to a canonical 40-character Git SHA');
  }
  if (actualSha !== expectedSha) {
    throw new Error(`reviewed_sha ${expectedSha} does not match checked-out HEAD ${actualSha}`);
  }

  return actualSha;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const verifiedSha = verifyReviewEvidenceSha(process.argv[2]);
    console.log(`Review evidence SHA verified: ${verifiedSha}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
