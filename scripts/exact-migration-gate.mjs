#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import {
    assertAfterApply,
    assertBeforeApply,
    assertExactDryRun,
} from './lib/exactMigrationGate.mjs';

const [mode, file] = process.argv.slice(2);
if (!mode || !file) {
    console.error('usage: exact-migration-gate.mjs <before|dry-run|after> <output-file>');
    process.exit(2);
}

const output = await readFile(file, 'utf8');
let result;
switch (mode) {
case 'before':
    result = assertBeforeApply(output);
    break;
case 'dry-run':
    result = assertExactDryRun(output);
    break;
case 'after':
    result = assertAfterApply(output);
    break;
default:
    console.error(`unsupported exact-migration gate mode: ${mode}`);
    process.exit(2);
}

console.log(JSON.stringify({ mode, ...result }));
