/**
 * Draft-lane affected-test selection (pure; no Vitest, no file system).
 *
 * `vitest related` picks only tests whose static import graph contains a changed file. Two thirds of this
 * repository's unit-test time is in tests that read files at run time instead (contracts over workflows, docs,
 * migrations, cloud-test config, scripts run with spawn), and the import graph cannot see those. A test is
 * therefore selected when ANY of these hold for a changed file, checked over the test, its local imports, and
 * the code files they name by path with those files' own local imports (one hop):
 *   1. it imports the changed file (vi.importActual and dynamic imports included), or names a code file (a script
 *      it runs, or a module it reads and follows) whose own import graph contains it;
 *   2. it enumerates the whole repository (git ls-files, ls-tree, grep, or a directory walk from the root);
 *   3. a string in it names the file: its basename, or any tail of its path;
 *   4. a string in it names a directory above the file, so it may list or walk that directory;
 *   5. it is an always-run test (documentation contracts follow links from docs to any file).
 * A change to anything every test loads (the setup files and what they import) selects the whole suite.
 * The CLI also selects the whole suite on any error. Over-selection is safe; under-selection is the failure.
 */
import { posix } from 'node:path';

/** Documentation contracts: they read every doc and check each linked path, so any file can change their result. */
export const ALWAYS_RUN = Object.freeze([
    'tests/config/documentationContract.test.ts',
    'tests/deps/docs-integrity.test.js',
    'tests/release/tester-instructions.test.ts',
]);

/** Tests that enumerate every tracked file. */
export const REPO_WIDE = /^(?:git )?(?:ls-files|ls-tree|grep)\b|\bgit (?:ls-files|ls-tree|grep)\b/;

/** Tests that walk the tree from the repository root (no literal names the directory they list). */
export const ROOT_WALK = /(?<!function\s{0,4})\b(?:readdir(?:Sync)?|opendir(?:Sync)?|walk\w*|list\w*|collect\w*|scan\w*|find\w*|gather\w*)\(\s*(?:ROOT|REPO_ROOT|REPO|repoRoot|REPO_DIR|root|rootDir|ROOT_DIR|projectRoot|PROJECT_ROOT|process\.cwd\(\)|['"`]\.\/?['"`])\s*(?:,|\)(?!\s*(?:\{|=>|:)))|['"`]\*\*\//;

const LISTS = /\breaddir(?:Sync)?\b|\bopendir(?:Sync)?\b|\bglob(?:Sync)?\b|\bfast-glob\b/;

// Each quote kind is matched on its own, so a string inside a template literal's ${...} is still found.
const LITERALS = [/'([^'\n]{1,400})'/g, /"([^"\n]{1,400})"/g, /`([^`]{1,600})`/g];
const SCRIPT = /\.(?:mjs|cjs|js|jsx|ts|tsx|mts|cts|py|sh)$/;
const CODE = /\.(?:mjs|cjs|js|jsx|ts|tsx|mts|cts)$/;
const IMPORT = /(?:\bimport\s[^'"`;]*?\bfrom\s*|\bexport\s[^'"`;]*?\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bvi\.(?:mock|doMock|importActual|importMock)\s*(?:<[^;]{0,300}?>)?\s*\(\s*)['"]([^'"\n]+)['"]/g;
const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs', '.cjs', '.json', '/index.ts', '/index.tsx', '/index.js', '/index.mjs'];

/** Rejoin path pieces written apart: path.join('a', 'b'), 'a/' + 'b', escaped backslashes. */
export function rejoinPathPieces(text) {
    let out = text.replace(/\\\\/g, '/');
    for (let i = 0; i < 4; i++) out = out.replace(/(['"`])\s*[,+]\s*(['"`])/g, '/');
    return out.replace(/([^:/])\/{2,}/g, '$1/');
}

/** Every quoted string in a source, as written and with split paths rejoined (a list of names stays a list). */
export function stringLiterals(text) {
    const out = new Set();
    for (const source of [text, rejoinPathPieces(text)]) for (const pattern of LITERALS) for (const m of source.matchAll(pattern)) out.add(m[1]);
    return [...out];
}

/**
 * Index one literal: every contiguous run of its path components (for names) and every tail (for directories).
 * A relative literal is also indexed as the repository path it resolves to from its own file.
 */
export function indexLiteral(literal, fromFile, runs, tails) {
    const add = (text) => {
        const parts = text.split('/').map((p) => p.replace(/^\$\{[^}]*\}$/, '')).filter((p) => p && p !== '.' && p !== '..');
        for (let i = 0; i < parts.length; i++) {
            for (let j = i + 1; j <= Math.min(parts.length, i + 12); j++) runs.add(parts.slice(i, j).join('/'));
            tails.add(parts.slice(i).join('/'));
        }
    };
    add(literal);
    if (fromFile && /^\.{1,2}(\/|$)/.test(literal)) {
        const resolved = posix.normalize(posix.join(posix.dirname(fromFile), literal));
        if (!resolved.startsWith('..')) add(resolved);
    }
}

/** What a source would contain if it referred to `file`: names (basename, path tails) and the directories above it. */
export function referenceTokens(file) {
    const parts = file.split('/');
    const names = new Set([parts.at(-1)]);
    for (let i = 0; i < parts.length - 1; i++) names.add(parts.slice(i).join('/'));
    // Module specifiers leave the extension off ('@/lib/client', '../x/y'), so a tail with a directory also counts without it.
    if (CODE.test(file)) for (let i = 0; i < parts.length - 1; i++) names.add(parts.slice(i).join('/').replace(CODE, ''));
    const dirs = [];
    for (let i = 1; i < parts.length; i++) dirs.push(parts.slice(0, i).join('/'));
    return { names: [...names], dirs };
}

/**
 * Repository paths of code files a source names (run with spawn, exec or node, or read and followed), resolved from
 * that source. With `exists`, a name that is not a repository path is also tried under each directory the same
 * source names, as path.join(SRC, 'pages/x.tsx') reads it.
 */
export function namedScripts(fromFile, literals, exists) {
    const out = [];
    const dirs = exists ? literals.filter((l) => !/\s/.test(l) && !/\.[A-Za-z0-9]+$/.test(l) && /^[\w.@/-]+$/.test(l) && !l.startsWith('.')) : [];
    for (const literal of literals) {
        if (!SCRIPT.test(literal) || /\s/.test(literal)) continue;
        const clean = literal.replace(/^\$\{[^}]*\}\//, '');
        const resolved = posix.normalize(clean.startsWith('.') ? posix.join(posix.dirname(fromFile), clean) : clean);
        if (resolved.startsWith('..') || resolved.split('/').includes('node_modules')) continue;
        if (!exists || exists(resolved)) { out.push(resolved); continue; }
        for (const dir of dirs) {
            const joined = posix.normalize(posix.join(dir, clean));
            if (!joined.startsWith('..') && !joined.split('/').includes('node_modules') && exists(joined)) out.push(joined);
        }
    }
    return out;
}

/**
 * Local modules a source imports (static, dynamic, require, vi.mock), resolved the way the test config resolves them:
 * relative to the source, and '@/' to frontend/src. Bare package names are skipped. `exists(path)` decides resolution.
 */
export function localImports(fromFile, text, exists) {
    const out = [];
    for (const m of text.matchAll(IMPORT)) {
        const spec = m[1];
        let base;
        if (spec.startsWith('.')) base = posix.normalize(posix.join(posix.dirname(fromFile), spec));
        else if (spec.startsWith('@/')) base = `frontend/src/${spec.slice(2)}`;
        else if (spec === '@') base = 'frontend/src';
        else continue;
        if (base.startsWith('..')) continue;
        const hit = RESOLVE_SUFFIXES.map((suffix) => base + suffix).find(exists);
        if (hit) out.push(hit);
    }
    return out;
}

/**
 * specs: [{ file, deps }] with repository-relative paths (deps = the test's local static imports).
 * readText(path) returns the file's text, or null when it does not exist.
 */
export function buildTestIndex({ specs, readText, hops = 1 }) {
    const texts = new Map();
    const textOf = (path) => { if (!texts.has(path)) texts.set(path, readText(path)); return texts.get(path); };
    const cache = new Map();
    const literalsOf = (path) => {
        if (!cache.has(path)) { const text = textOf(path); cache.set(path, text == null ? null : stringLiterals(text)); }
        return cache.get(path);
    };
    const exists = (path) => textOf(path) != null;
    // A named code file brings its whole local import graph: a script run as a child process loads it, and a test
    // that reads a module to follow its imports reads it.
    const closures = new Map();
    const closureOf = (start) => {
        if (closures.has(start)) return closures.get(start);
        const seen = new Set([start]);
        const queue = [start];
        while (queue.length) {
            const path = queue.pop();
            if (!CODE.test(path)) continue;
            for (const dep of localImports(path, textOf(path) || '', exists)) if (!seen.has(dep)) { seen.add(dep); queue.push(dep); }
        }
        closures.set(start, seen);
        return seen;
    };
    return specs.map(({ file, deps }) => {
        const corpus = new Set([file, ...deps]);
        // Whole-repository scans count only where the test runs them: the test, what it imports, and the scripts it
        // names. A module deep in a named script's import graph may define a scan the test never calls.
        const scanners = new Set(corpus);
        // Modules the import graph leaves out: vi.importActual of a module the suite mocks, and dynamic imports.
        for (const path of [file, ...deps]) {
            if (!CODE.test(path)) continue;
            for (const dep of localImports(path, textOf(path) || '', exists)) {
                if (!corpus.has(dep)) for (const member of closureOf(dep)) corpus.add(member);
            }
        }
        let frontier = [...corpus];
        for (let hop = 0; hop < hops; hop++) {
            const next = [];
            for (const path of frontier) {
                for (const script of namedScripts(path, literalsOf(path) || [], exists)) {
                    if (corpus.has(script) || !exists(script)) continue;
                    scanners.add(script);
                    for (const member of closureOf(script)) if (!corpus.has(member)) { corpus.add(member); next.push(member); }
                }
            }
            frontier = next;
        }
        const runs = new Set(), tails = new Set();
        let repoWide = false;
        for (const path of corpus) {
            const text = textOf(path) || '';
            const scans = scanners.has(path);
            if (scans && LISTS.test(text) && ROOT_WALK.test(text)) repoWide = true;
            for (const literal of literalsOf(path) || []) {
                indexLiteral(literal, path, runs, tails);
                if (scans && REPO_WIDE.test(literal)) repoWide = true;
            }
        }
        return { file, corpus, runs, tails, repoWide };
    });
}

/**
 * changed: repository-relative paths (added, modified and deleted). wholeSuiteTriggers: paths every test loads.
 * Returns { full: true, reason } or { full: false, selected: Map<test, reason> }.
 */
export function selectAffectedTests({ changed, index, wholeSuiteTriggers = new Set() }) {
    const trigger = changed.find((path) => wholeSuiteTriggers.has(path));
    if (trigger) return { full: true, reason: `every test loads ${trigger}` };
    const selected = new Map();
    const known = new Set(index.map(({ file }) => file));
    for (const test of ALWAYS_RUN) if (known.has(test)) selected.set(test, 'documentation contract (always runs)');
    for (const path of changed) {
        const { names, dirs } = referenceTokens(path);
        for (const { file, corpus, runs, tails, repoWide } of index) {
            if (selected.has(file)) continue;
            if (corpus.has(path)) selected.set(file, `imports or runs ${path}`);
            else if (repoWide) selected.set(file, 'reads every tracked file');
            else if (names.some((token) => runs.has(token))) selected.set(file, `names ${path}`);
            else if (dirs.some((dir) => tails.has(dir))) selected.set(file, `reads a directory above ${path}`);
        }
    }
    return { full: false, selected };
}
