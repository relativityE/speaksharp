#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import {
    assertAfterApply,
    assertBeforeApply,
    assertExactDryRun,
    assertNoNewLint,
    assertTerminalOutcome,
} from './lib/exactMigrationGate.mjs';

const [mode, ...args] = process.argv.slice(2);
if (!mode) {
    console.error('usage: exact-migration-gate.mjs <before|dry-run|after|lint-delta|final> <arguments...>');
    process.exit(2);
}

let result;
switch (mode) {
case 'before':
    result = assertBeforeApply(await readFile(args[0], 'utf8'));
    break;
case 'dry-run':
    result = assertExactDryRun(await readFile(args[0], 'utf8'));
    break;
case 'after':
    result = assertAfterApply(await readFile(args[0], 'utf8'), await readFile(args[1], 'utf8'));
    break;
case 'lint-delta':
    result = assertNoNewLint(await readFile(args[0], 'utf8'), await readFile(args[1], 'utf8'));
    break;
case 'final':
    result = assertTerminalOutcome(args[0], args[1], args[2]);
    break;
default:
    console.error(`unsupported exact-migration gate mode: ${mode}`);
    process.exit(2);
}

console.log(JSON.stringify({ mode, ...result }));
