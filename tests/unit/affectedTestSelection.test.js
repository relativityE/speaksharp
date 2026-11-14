// Draft-lane affected-test selection: tests that read changed files at run time must be selected, not only
// tests that import them (`vitest related` saw imports only).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    ALWAYS_RUN, buildTestIndex, namedScripts, referenceTokens, rejoinPathPieces, selectAffectedTests, stringLiterals,
} from '../../scripts/lib/affectedTestSelection.mjs';

const ROOT = resolve(__dirname, '../..');

// A tiny repository: file path -> text, and tests with their local imports.
function pick(files, tests, changed, wholeSuiteTriggers) {
    const readText = (path) => (path in files ? files[path] : null);
    const index = buildTestIndex({ specs: tests, readText });
    const result = selectAffectedTests({ changed, index, wholeSuiteTriggers });
    return result.full ? result : { full: false, tests: [...result.selected.keys()].sort(), selected: result.selected };
}

describe('draft-lane affected-test selection', () => {
    it('selects a test that imports the changed file, as vitest related did', () => {
        const r = pick({ 'tests/a.test.js': '', 'src/lib.ts': '' }, [{ file: 'tests/a.test.js', deps: ['src/lib.ts'] }, { file: 'tests/b.test.js', deps: [] }], ['src/lib.ts']);
        expect(r.tests).toEqual(['tests/a.test.js']);
    });

    it('selects a test that reads a changed file by path, which the import graph cannot see', () => {
        const files = {
            'tests/unit/rwt.test.ts': "const cfg = readFileSync(resolve(ROOT, 'tools/cloud-test/harness/draft-adapters/progress-numeric.cjs'), 'utf8');",
            'tests/unit/other.test.ts': "import { x } from '../../frontend/src/x';",
        };
        const tests = [{ file: 'tests/unit/rwt.test.ts', deps: [] }, { file: 'tests/unit/other.test.ts', deps: [] }];
        expect(pick(files, tests, ['tools/cloud-test/harness/draft-adapters/progress-numeric.cjs']).tests).toEqual(['tests/unit/rwt.test.ts']);
    });

    it('selects a test that walks a directory above the changed file, however the path is written', () => {
        const files = {
            'tests/joined.test.js': "const dir = path.join(ROOT, 'tools', 'cloud-test', 'config');",
            'tests/listed.test.js': "const SCANNED_ROOTS = ['.github', 'scripts', 'backend', '.agent'];",
            'frontend/src/__tests__/relative.test.ts': "const src = resolve(__dirname, '../lib');",
            'tests/unrelated.test.js': "const f = 'tools/cloud-test/README.md';",
        };
        const tests = Object.keys(files).map((file) => ({ file, deps: [] }));
        expect(pick(files, tests, ['tools/cloud-test/config/runs/R10.json']).tests).toEqual(['tests/joined.test.js']);
        expect(pick(files, tests, ['backend/supabase/functions/x/index.ts']).tests).toEqual(['tests/listed.test.js']);
        expect(pick(files, tests, ['frontend/src/lib/digest.ts']).tests).toEqual(['frontend/src/__tests__/relative.test.ts']);
    });

    it('follows a script the test runs and selects the test when a file that script reads changes', () => {
        const files = {
            'tests/runner.test.js': "execFileSync(process.execPath, ['scripts/check-docs.mjs']);",
            'scripts/check-docs.mjs': "const prd = readFileSync('docs/PRD.md', 'utf8');",
        };
        const r = pick(files, [{ file: 'tests/runner.test.js', deps: [] }], ['docs/PRD.md']);
        expect(r.tests).toEqual(['tests/runner.test.js']);
        expect(pick(files, [{ file: 'tests/runner.test.js', deps: [] }], ['scripts/check-docs.mjs']).selected.get('tests/runner.test.js')).toMatch(/imports or runs/);
    });

    it('follows the import graph of a script the test runs, since the child process loads all of it', () => {
        const files = {
            'tests/child.test.js': "spawnSync(process.execPath, ['scripts/observe.mjs', '--flag']);",
            'scripts/observe.mjs': "import { evidence } from './lib/evidence.mjs';",
            'scripts/lib/evidence.mjs': "export const CONTRACT = resolve(here, '../../backend/fn/contract.json'); const scan = () => execFileSync('git', ['ls-files']);",
            'backend/fn/contract.json': '{}',
        };
        const tests = [{ file: 'tests/child.test.js', deps: [] }];
        expect(pick(files, tests, ['scripts/lib/evidence.mjs']).selected.get('tests/child.test.js')).toMatch(/imports or runs/);
        expect(pick(files, tests, ['backend/fn/contract.json']).tests).toEqual(['tests/child.test.js']);
        // A scan defined deep in that graph is not one the test runs, so it does not select the test for every change.
        expect(pick(files, tests, ['frontend/src/unrelated.ts']).tests).toEqual([]);
    });

    it('follows a module the test reads by a path joined onto a named directory', () => {
        const files = {
            'tests/tree.test.ts': "const SRC = path.join(ROOT, 'frontend/src'); const start = path.join(SRC, 'pages/SessionPage.tsx');",
            'frontend/src/pages/SessionPage.tsx': "import { Bar } from '@/components/Bar';",
            'frontend/src/components/Bar.tsx': "import pins from '../../../tests/fixtures/pins.json';",
            'tests/fixtures/pins.json': '{}',
        };
        const tests = [{ file: 'tests/tree.test.ts', deps: [] }];
        expect(pick(files, tests, ['frontend/src/components/Bar.tsx']).tests).toEqual(['tests/tree.test.ts']);
        expect(pick(files, tests, ['tests/fixtures/pins.json']).tests).toEqual(['tests/tree.test.ts']);
    });

    it('finds paths inside template literals and module specifiers written without an extension', () => {
        const files = {
            'tests/template.test.ts': "const written = `${spec}\n${src('tests/live/helpers/account.ts')}`;",
            'tests/mock.test.ts': "vi.mock('@/lib/supabaseClient', () => ({}));",
        };
        const tests = Object.keys(files).map((file) => ({ file, deps: [] }));
        expect(pick(files, tests, ['tests/live/helpers/account.ts']).tests).toEqual(['tests/template.test.ts']);
        expect(pick(files, tests, ['frontend/src/lib/supabaseClient.ts']).tests).toEqual(['tests/mock.test.ts']);
    });

    it('follows vi.importActual of a module the suite mocks, which the import graph leaves out', () => {
        const files = {
            'frontend/src/modes/__tests__/real.test.ts': "const actual = await vi.importActual<{ default: typeof Real }>(\n    '@/modes/Whisper');",
            'frontend/src/modes/Whisper.ts': "import { CONFIG } from '../config';",
            'frontend/src/config.ts': 'export const CONFIG = {};',
        };
        const tests = [{ file: 'frontend/src/modes/__tests__/real.test.ts', deps: [] }];
        expect(pick(files, tests, ['frontend/src/config.ts']).selected.get('frontend/src/modes/__tests__/real.test.ts')).toMatch(/imports or runs/);
    });

    it('selects a test that walks the tree from the repository root for any change', () => {
        const files = { 'tests/walk.test.js': 'const ROOT = process.cwd(); function walk(dir) { return readdirSync(dir); } const FILES = walk(ROOT);' };
        expect(pick(files, [{ file: 'tests/walk.test.js', deps: [] }], ['docs/anything.md']).selected.get('tests/walk.test.js')).toBe('reads every tracked file');
        // Defining a walker is not walking the root.
        const defined = { 'tests/defines.test.js': 'import { readdirSync } from "node:fs"; function walk(root) {} const walkDir = (root) => {}; walk(fixtureDir);' };
        expect(pick(defined, [{ file: 'tests/defines.test.js', deps: [] }], ['docs/anything.md']).tests).toEqual([]);
    });

    it('selects a test that enumerates every tracked file for any change', () => {
        const files = { 'tests/scan.test.js': "execFileSync('git', ['ls-files', '-z'])", 'tests/plain.test.js': '' };
        const tests = [{ file: 'tests/scan.test.js', deps: [] }, { file: 'tests/plain.test.js', deps: [] }];
        expect(pick(files, tests, ['anything/at/all.txt']).tests).toEqual(['tests/scan.test.js']);
    });

    it('does not select a test that names only a sibling of the changed file (negative control)', () => {
        const files = { 'tests/sibling.test.js': "readFileSync('frontend/src/components/A.tsx')" };
        expect(pick(files, [{ file: 'tests/sibling.test.js', deps: [] }], ['frontend/src/components/B.tsx']).tests).toEqual([]);
    });

    it('runs the whole suite when a file every test loads changes', () => {
        const r = pick({ 'tests/a.test.js': '' }, [{ file: 'tests/a.test.js', deps: [] }], ['frontend/tests/setup.ts'], new Set(['frontend/tests/setup.ts']));
        expect(r).toEqual({ full: true, reason: 'every test loads frontend/tests/setup.ts' });
    });

    it('always runs the documentation contracts, which follow doc links to any file', () => {
        const files = Object.fromEntries(ALWAYS_RUN.map((file) => [file, '']));
        const tests = ALWAYS_RUN.map((file) => ({ file, deps: [] }));
        expect(pick(files, tests, ['frontend/src/components/session/StatusNotificationBar.tsx']).tests).toEqual([...ALWAYS_RUN].sort());
        for (const file of ALWAYS_RUN) expect(readFileSync(join(ROOT, file), 'utf8').length).toBeGreaterThan(0);
    });

    it('builds tokens, literals and script paths the way the rules above rely on', () => {
        expect(referenceTokens('a/b/c.json')).toEqual({ names: ['c.json', 'a/b/c.json', 'b/c.json'], dirs: ['a', 'a/b'] });
        expect(rejoinPathPieces("join('a', 'b') + 'c/' + 'd'")).toBe("join('a/b') + 'c/d'");
        expect(stringLiterals("['x', 'y']")).toEqual(expect.arrayContaining(['x', 'y', 'x/y']));
        expect(namedScripts('tests/unit/t.test.js', ['../../scripts/a.mjs', 'scripts/b.py', 'not a path.js', '../../../outside.mjs', 'node_modules/vitest/vitest.mjs']))
            .toEqual(['scripts/a.mjs', 'scripts/b.py']);
        expect(referenceTokens('frontend/src/lib/x.ts').names).toEqual(expect.arrayContaining(['lib/x', 'src/lib/x']));
    });

    it('the CLI selects the whole suite when it cannot run, instead of skipping tests', () => {
        const dir = mkdtempSync(join(tmpdir(), 'affected-'));
        const out = join(dir, 'out.txt');
        writeFileSync(out, 'stale\n');
        execFileSync(process.execPath, ['scripts/ci-draft-affected-tests.mjs', join(dir, 'missing-changed-list.txt'), out], { cwd: ROOT, stdio: 'pipe' });
        expect(readFileSync(out, 'utf8')).toBe('FULL\n');
    });
});
