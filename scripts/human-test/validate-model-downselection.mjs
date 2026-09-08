#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { validateModelDownselectionEvidence } from './modelDownselectionEvidence.mjs';

const input = process.argv[2];
if (!input || process.argv.length !== 3) {
  console.error('usage: node scripts/human-test/validate-model-downselection.mjs <evidence.json>');
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
});
console.log(JSON.stringify(result, null, 2));
process.exit(result.verdict === 'PASS' ? 0 : 1);
