#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import {
    assertAfterApply,
    assertBeforeApply,
    assertExactDryRun,
    assertNoNewLint,
    assertTerminalOutcome,
    expectedAuthorizationPhrase,
    prepareExactMigrationWorkspace,
    resolveExactMigrationConfig,
    verifyMigrationSourceIdentity,
} from './lib/exactMigrationGate.mjs';

const [mode, ...args] = process.argv.slice(2);
if (!mode) {
    console.error('usage: exact-migration-gate.mjs <resolve|source|phrase|prepare-workspace|before|dry-run|after|lint-delta|final> <arguments...>');
    process.exit(2);
}

let result;
switch (mode) {
case 'resolve':
    result = resolveExactMigrationConfig(process.env);
    break;
case 'source':
    result = verifyMigrationSourceIdentity(args[0]);
    break;
case 'phrase':
    result = { phrase: expectedAuthorizationPhrase(args[0]) };
    break;
case 'prepare-workspace':
    result = prepareExactMigrationWorkspace(args[0], args[1]);
    break;
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
case 'final': {
    // final <apply> <verify> <lint> <targetFile> [<gateId>=<outcome> ...]
    // Postflights are passed as NAMED pairs, not trailing positionals. The previous form took three
    // positionals and silently dropped the fourth argument the workflow was already passing, so a failed
    // postflight could not affect the terminal result. Unknown ids now throw rather than being ignored.
    const postflights = {};
    for (const pair of args.slice(4)) {
        const eq = pair.indexOf('=');
        if (eq <= 0) {
            console.error(`final: postflight arguments must be <gateId>=<outcome>, got '${pair}'`);
            process.exit(2);
        }
        postflights[pair.slice(0, eq)] = pair.slice(eq + 1);
    }
    result = assertTerminalOutcome({
        apply: args[0], verify: args[1], lint: args[2], targetFile: args[3], postflights,
    });
    break;
}
default:
    console.error(`unsupported exact-migration gate mode: ${mode}`);
    process.exit(2);
}

console.log(JSON.stringify({ mode, ...result }));
