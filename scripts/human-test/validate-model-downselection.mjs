#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { validateModelDownselectionEvidence } from './modelDownselectionEvidence.mjs';

const arg = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1];
};
const input = process.argv[2];
const telemetryAuthorityPath = arg('telemetry-authority');
const geminiAuthorityPath = arg('gemini-authority');
if (!input || !telemetryAuthorityPath || !geminiAuthorityPath) {
  console.error('usage: node scripts/human-test/validate-model-downselection.mjs <evidence.json> --telemetry-authority <trusted-posthog.json> --gemini-authority <trusted-gemini.json>');
  process.exit(2);
}

let evidence;
try {
  evidence = JSON.parse(await readFile(resolve(input), 'utf8'));
} catch (error) {
  console.error(`HOLD: evidence could not be read as JSON (${error instanceof Error ? error.name : 'unknown_error'})`);
  process.exit(1);
}

const evidencePath = resolve(input);
const telemetryAuthorityFile = resolve(telemetryAuthorityPath);
const geminiAuthorityFile = resolve(geminiAuthorityPath);
let telemetryAuthority;
let geminiAuthority;
try {
  // These are not trusted because a filename says so. Verify GitHub's artifact provenance before
  // parsing either byte. A locally rewritten authority therefore fails before it can become a resolver.
  const gh = process.env.GH_BIN || 'gh';
  for (const path of [telemetryAuthorityFile, geminiAuthorityFile]) {
    execFileSync(gh, ['attestation', 'verify', path, '--repo', 'relativityE/speaksharp'], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
  }
  telemetryAuthority = JSON.parse(await readFile(telemetryAuthorityFile, 'utf8'));
  geminiAuthority = JSON.parse(await readFile(geminiAuthorityFile, 'utf8'));
} catch (error) {
  console.error(`HOLD: trusted authority provenance or JSON could not be verified (${error instanceof Error ? error.name : 'unknown_error'})`);
  process.exit(1);
}
const approvalResolver = (htmlUrl) => {
  const match = /^https:\/\/github\.com\/relativityE\/speaksharp\/(?:issues|pull)\/\d+#issuecomment-(\d+)$/.exec(htmlUrl ?? '');
  if (!match) return null;
  const gh = process.env.GH_BIN || 'gh';
  return JSON.parse(execFileSync(
    gh,
    ['api', `repos/relativityE/speaksharp/issues/comments/${match[1]}`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  ));
};
const result = validateModelDownselectionEvidence(evidence, {
  baseDir: dirname(evidencePath),
  approvalResolver,
  telemetryResolver: (queryId) => telemetryAuthority?.schemaVersion === 'speaksharp.posthog-readback-authority.v1'
    && telemetryAuthority?.releaseSha === evidence?.environment?.releaseSha
    && telemetryAuthority?.readback?.queryId === queryId
    ? telemetryAuthority.readback : null,
  geminiResolver: () => geminiAuthority?.schemaVersion === 'speaksharp.gemini-session-readback-authority.v1'
    && geminiAuthority?.releaseSha === evidence?.environment?.releaseSha
    && Array.isArray(geminiAuthority?.observations)
    ? geminiAuthority.observations : null,
});
console.log(JSON.stringify(result, null, 2));
process.exit(result.verdict === 'PASS' ? 0 : 1);
