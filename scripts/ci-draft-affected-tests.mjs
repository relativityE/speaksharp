#!/usr/bin/env node
/**
 * Draft lane: which unit tests a change can affect (scripts/lib/affectedTestSelection.mjs has the rules).
 *
 * usage: node scripts/ci-draft-affected-tests.mjs <changed-files.txt> <out.txt>
 * <changed-files.txt> lists every changed path (added, modified, deleted; `git diff --no-renames --name-only`).
 * <out.txt> gets either the selected test files, one per line, or a first line `FULL` when the whole suite must
 * run. Any failure here also writes `FULL`: this lane must never skip a test because the selector broke.
 * Draft feedback only. Merge candidates always run the complete suite in the full lane.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { buildTestIndex, selectAffectedTests } from './lib/affectedTestSelection.mjs';

const [changedPath, outPath] = process.argv.slice(2);
if (!changedPath || !outPath) {
    console.error('usage: node scripts/ci-draft-affected-tests.mjs <changed-files.txt> <out.txt>');
    process.exit(2);
}
const root = process.cwd();
const full = (reason) => {
    writeFileSync(outPath, 'FULL\n');
    console.log(`Affected tests: the whole unit suite runs (${reason}).`);
};

try {
    const changed = readFileSync(changedPath, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean);
    const { createVitest } = await import('vitest/node');
    const vitest = await createVitest('test', { config: 'frontend/vitest.config.mjs', watch: false, run: true, coverage: { enabled: false } });
    try {
        const local = (path) => relative(root, path).split('\\').join('/');
        const inRepo = (path) => !path.startsWith('..') && !path.includes('node_modules/');
        const specs = await vitest.specifications.globTestSpecifications();
        if (!specs.length) throw Error('no test files found');
        const indexed = [];
        for (const spec of specs) {
            const deps = await vitest.specifications.getTestDependencies(spec);
            indexed.push({ file: local(spec.moduleId), deps: [...deps].map(local).filter(inRepo) });
        }
        // Everything the setup files load runs with every test, so a change there selects the whole suite.
        const wholeSuiteTriggers = new Set();
        for (const project of vitest.projects) {
            for (const setupFile of project.config.setupFiles || []) {
                wholeSuiteTriggers.add(local(setupFile));
                const deps = await vitest.specifications.getTestDependencies({ project, moduleId: setupFile });
                for (const dep of deps) if (inRepo(local(dep))) wholeSuiteTriggers.add(local(dep));
            }
        }
        const readText = (path) => { try { return readFileSync(resolve(root, path), 'utf8'); } catch { return null; } };
        const index = buildTestIndex({ specs: indexed, readText });
        const result = selectAffectedTests({ changed, index, wholeSuiteTriggers });
        if (result.full) full(result.reason);
        else {
            const tests = [...result.selected.keys()].sort();
            writeFileSync(outPath, tests.length ? `${tests.join('\n')}\n` : '');
            console.log(`Affected tests: ${tests.length} of ${specs.length} test files for ${changed.length} changed path(s).`);
            for (const test of tests) console.log(`  ${test}: ${result.selected.get(test)}`);
        }
    } finally {
        await vitest.close();
    }
} catch (error) {
    full(`selector error: ${error?.message || error}`);
}
