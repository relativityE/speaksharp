#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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

const result = validateModelDownselectionEvidence(evidence);
console.log(JSON.stringify(result, null, 2));
process.exit(result.verdict === 'PASS' ? 0 : 1);
