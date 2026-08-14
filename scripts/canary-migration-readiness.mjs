#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { evaluateCanaryMigrationReadiness } from './lib/canaryMigrationReadiness.mjs';

const [path] = process.argv.slice(2);
if (!path) {
  console.error('usage: canary-migration-readiness.mjs <supabase-migration-list-output>');
  process.exit(2);
}

console.log(JSON.stringify(evaluateCanaryMigrationReadiness(await readFile(path, 'utf8'))));
