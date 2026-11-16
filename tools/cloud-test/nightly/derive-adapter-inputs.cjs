"use strict";
// Nightly AHT suite: derive the INSPECTED INPUTS of the selected harness adapters (Sam, 16 Nov), offline, at the sealed source.
//
// The adapters (tools/cloud-test/harness/draft-adapters, sealed) were inspected against `SOURCE_SHA`. A newer served release can
// only reuse that inspection if everything the adapters depend on in the product is byte-identical there. This deriver binds:
//   1. tokens the adapters reference: test ids (literal, passed through variables, and `^=` prefixes), the `data-*` attributes
//      they read, and their fixed UI copy (`KNOWN_UI_COPY`);
//   2. the product files that DEFINE those tokens (non-comment lines; named test-id constants followed to their users;
//      template prefixes such as `feedback-type-${...}`);
//   3. the transitive import closure of those files inside `frontend/src` (relative and `@/` imports, re-exports, dynamic
//      imports, style and asset imports), so a dependency that changes while the selector file does not is still bound;
//   4. the build configuration and the lockfile (bare package imports are bound through `pnpm-lock.yaml`).
// `git grep` finds candidates; it cannot prove completeness. So anything it cannot resolve (a referenced test id with no
// definition, an import that resolves to no file, a dynamic import of a non-literal) is listed in `unresolved`, and every
// case stays NOT RUN while that list is non-empty. Run: `node derive-adapter-inputs.cjs --write` to regenerate the manifest.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SOURCE_SHA = '5a7bf6a1cbd0fb2f4a1c2b363d891c8fcc462bd2';
const REPO_ROOT = path.resolve(__dirname, '../../..');
const ADAPTER_DIR = path.join(__dirname, '..', 'harness', 'draft-adapters');
const MANIFEST = path.join(__dirname, 'adapter-inputs.json');
const CONFIG_FILES = Object.freeze([
    'package.json', 'pnpm-lock.yaml', 'frontend/package.json', 'frontend/vite.config.mjs', 'frontend/index.html',
    'frontend/tsconfig.json', 'frontend/postcss.config.cjs', 'frontend/tailwind.config.js',
]);
const SOURCE_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const ASSET = /\.(css|scss|json|svg|png|jpg|jpeg|gif|webp|wasm|txt|md)(\?.*)?$/;
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const git = (args, root = REPO_ROOT) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });

/** The tokens the adapters reference, from the adapter sources on disk (the sealed copies). */
function adapterTokens(dir = ADAPTER_DIR) {
    const testIds = new Set(); const kebab = new Set(); const dataAttrs = new Set(); const copy = new Set(); const prefixes = new Set();
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.cjs')).sort()) {
        const src = fs.readFileSync(path.join(dir, f), 'utf8');
        for (const m of src.matchAll(/getByTestId\('([A-Za-z0-9_-]+)'\)/g)) testIds.add(m[1]);
        for (const m of src.matchAll(/data-testid=\\?["']?([A-Za-z0-9_-]+)/g)) testIds.add(m[1]);
        for (const m of src.matchAll(/data-testid\^=\\?["']?([A-Za-z0-9_-]+)/g)) prefixes.add(m[1]);
        // Test ids passed through a variable (`getByTestId(control)`) come from kebab-case literals in the same module.
        for (const m of src.matchAll(/'([a-z][a-z0-9]*(?:-[a-z0-9]+)+)'/g)) kebab.add(m[1]);
        for (const m of src.matchAll(/\b(data-[a-z][a-z0-9-]*)/g)) if (m[1] !== 'data-testid') dataAttrs.add(m[1]);
        const block = /KNOWN_UI_COPY\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/.exec(src);
        if (block) for (const m of block[1].matchAll(/:\s*'([^']{3,})'/g)) copy.add(m[1]);
    }
    return { testIds: [...testIds].sort(), prefixes: [...prefixes].sort(), kebab: [...kebab].sort(), dataAttrs: [...dataAttrs].sort(), copy: [...copy].sort() };
}

/** Every product source file at the sha, with its bytes: frontend/src only, tests excluded. */
function productFiles(sha, root = REPO_ROOT) {
    const names = git(['ls-tree', '-r', '--name-only', sha, 'frontend/src'], root).toString().split('\n')
        .filter((n) => n && !/(^|\/)__tests__\/|\.test\.|\.spec\./.test(n));
    const files = new Map();
    for (const n of names) files.set(n, git(['show', `${sha}:${n}`], root));
    files.sha = sha;
    files.root = root;
    return files;
}

const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);
/** Files with `needle` on a non-comment line. */
function definingFiles(files, needle) {
    const out = [];
    for (const [name, bytes] of files) {
        if (ASSET.test(name)) continue;
        const text = bytes.toString('utf8');
        if (!text.includes(needle)) continue;
        if (text.split('\n').some((l) => l.includes(needle) && !isComment(l))) out.push(name);
    }
    return out;
}

/** Where a test id is defined: literally, through a named test-id constant, or by a template prefix. */
function resolveTestId(files, id) {
    // An id the adapter uses as a prefix (`focus-point-`) is defined by a template that starts with it.
    if (id.endsWith('-')) return definingFiles(files, `\`${id}\${`).concat(definingFiles(files, `'${id}'`)).sort();
    const found = new Set(definingFiles(files, `'${id}'`).concat(definingFiles(files, `"${id}"`), definingFiles(files, `\`${id}\``)));
    // A named constant (`KEY: 'id'`) is followed to every file that uses `.KEY`.
    for (const f of [...found]) {
        const text = files.get(f).toString('utf8');
        for (const m of text.matchAll(new RegExp(`\\b([A-Z][A-Z0-9_]+)\\s*:\\s*['"\`]${id.replace(/[-]/g, '\\-')}['"\`]`, 'g')))
            for (const user of definingFiles(files, `.${m[1]}`)) found.add(user);
    }
    if (found.size > 0) return [...found].sort();
    // A numbered or keyed id (`objective-point-label-2`, `feedback-type-broke`) defined by a template prefix.
    const prefix = id.replace(/-[^-]+$/, '-');
    return prefix !== id ? definingFiles(files, `\`${prefix}\${`).sort() : [];
}

/** Resolves an import specifier from `from` to a product path, or null; bare packages return `{ pkg }`. */
function resolveImport(files, from, spec) {
    if (!spec.startsWith('.') && !spec.startsWith('@/')) {
        const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
        return { pkg };
    }
    const base = spec.startsWith('@/') ? path.posix.join('frontend/src', spec.slice(2)) : path.posix.join(path.posix.dirname(from), spec);
    const clean = base.replace(/\?.*$/, '');
    const candidates = [clean, ...SOURCE_EXT.map((e) => clean + e), ...SOURCE_EXT.map((e) => `${clean}/index${e}`)];
    const hit = candidates.find((c) => files.has(c));
    if (hit) return { file: hit };
    // An import that leaves frontend/src (e.g. shared test types) is still a product build input: bind it from the same sha.
    if (files.sha && !clean.startsWith('..')) {
        for (const c of candidates) {
            try {
                files.set(c, git(['show', `${files.sha}:${c}`], files.root ?? REPO_ROOT));
                return { file: c };
            }
            catch { /* not this candidate */ }
        }
    }
    return null;
}

/** The transitive import closure inside frontend/src; an unresolvable import is recorded, never skipped. */
function importClosure(files, seeds) {
    const seen = new Set(); const packages = new Set(); const unresolved = [];
    const queue = [...seeds];
    while (queue.length > 0) {
        const f = queue.shift();
        if (seen.has(f)) continue;
        seen.add(f);
        if (ASSET.test(f)) continue;
        const text = files.get(f).toString('utf8');
        const specs = [
            ...[...text.matchAll(/(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
            ...[...text.matchAll(/import\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
            ...[...text.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
        ];
        for (const m of text.matchAll(/import\(\s*([^'"\s)][^)]*)\)/g)) unresolved.push({ kind: 'dynamic-import', file: f, detail: m[1].slice(0, 60) });
        for (const spec of specs) {
            const r = resolveImport(files, f, spec);
            if (r === null) unresolved.push({ kind: 'import', file: f, detail: spec });
            else if (r.pkg) packages.add(r.pkg);
            else if (!seen.has(r.file)) queue.push(r.file);
        }
    }
    return { files: [...seen].sort(), packages: [...packages].sort(), unresolved };
}

function derive({ sha = SOURCE_SHA, adapterDir = ADAPTER_DIR, repoRoot = REPO_ROOT } = {}) {
    const tokens = adapterTokens(adapterDir);
    const files = productFiles(sha, repoRoot);
    const unresolved = [];
    const seeds = new Set();
    const bind = (kind, token, found) => { if (found.length === 0) unresolved.push({ kind, token }); for (const f of found) seeds.add(f); };
    for (const id of tokens.testIds) bind('test-id', id, resolveTestId(files, id));
    for (const p of tokens.prefixes) bind('test-id-prefix', p, definingFiles(files, `\`${p}\${`).concat(definingFiles(files, `'${p}`)));
    for (const k of tokens.kebab) for (const f of resolveTestId(files, k)) seeds.add(f); // variable-passed ids: bound when found
    for (const a of tokens.dataAttrs) for (const f of definingFiles(files, a)) seeds.add(f); // attributes the page may set
    for (const c of tokens.copy) bind('copy', c, definingFiles(files, c));
    const closure = importClosure(files, [...seeds]);
    unresolved.push(...closure.unresolved);
    const inputs = [...closure.files.map((p) => ({ path: p, sha256: sha256(files.get(p)) })),
        ...CONFIG_FILES.map((p) => ({ path: p, sha256: sha256(git(['show', `${sha}:${p}`], repoRoot)) }))]
        .sort((a, b) => a.path.localeCompare(b.path));
    return {
        schema: 'speaksharp.nightly.adapter-inputs.v1', sourceSha: sha,
        note: 'Generated by derive-adapter-inputs.cjs. Every selected adapter shares this bundle (source-adapters.cjs loads every control module), so the inputs bind all selected cases together.',
        tokens: { testIds: tokens.testIds.length, prefixes: tokens.prefixes.length, dataAttrs: tokens.dataAttrs.length, copy: tokens.copy.length },
        packages: closure.packages, inputs, unresolved,
    };
}

module.exports = { CONFIG_FILES, SOURCE_SHA, adapterTokens, definingFiles, derive, importClosure, resolveImport, resolveTestId };

if (require.main === module) {
    const manifest = derive();
    const text = `${JSON.stringify(manifest, null, 2)}\n`;
    if (process.argv.includes('--write')) fs.writeFileSync(MANIFEST, text);
    process.stdout.write(`${manifest.inputs.length} inputs, ${manifest.packages.length} packages, ${manifest.unresolved.length} unresolved\n`);
    // `--check` needs this checkout's git history at SOURCE_SHA (the unit tests are hermetic and cannot): the committed manifest
    // must be exactly what the deriver produces at the sealed source, with nothing unresolved.
    if (process.argv.includes('--check')) {
        const committed = fs.readFileSync(MANIFEST, 'utf8');
        if (committed !== text || manifest.unresolved.length > 0) {
            process.stderr.write('adapter-inputs.json is not what the deriver produces at the sealed source, or has unresolved inputs\n');
            process.exitCode = 1;
        }
        else process.stdout.write('adapter-inputs.json matches the deriver at the sealed source\n');
    }
}
