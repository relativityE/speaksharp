"use strict";
// Nightly AHT suite: the selected adapters' inspection may be reused at a newer served release only when every inspected input
// is byte-identical there (Sam, 16 Nov). Hermetic: the deriver and the revalidation run against a small synthetic git
// repository built here, so no test needs this checkout's history. The committed manifest's match with the deriver at the
// real sealed source is checked by `node derive-adapter-inputs.cjs --check` (it needs that history).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { describe, it } = require('node:test');
const { expect } = require('./expect-lite.cjs');
const { caseAdmission, gitBlob, revalidate } = require('../adapter-revalidation.cjs');
const { CONFIG_FILES, derive } = require('../derive-adapter-inputs.cjs');
const manifest = require('../adapter-inputs.json');

const ADAPTER = `"use strict";
const KNOWN_UI_COPY = Object.freeze({ start: 'Start recording' });
async function run(page) { await page.getByTestId('mic-card').click(); return page.locator('[data-session-state]'); }
module.exports = { run };
`;
const SELECTOR = 'frontend/src/components/MicCard.tsx';
const DEPENDENCY = 'frontend/src/components/micHelpers.ts';
const COPY = 'frontend/src/lib/copy.ts';
const UNRELATED = 'frontend/src/unrelated.ts';
const BUILD_SCRIPT = 'scripts/build.config.js';
const WORKLET = 'frontend/public/audio/proc.worklet.js';
const SOURCE_FILES = {
    [SELECTOR]: `import React from 'react';\nimport { helper } from './micHelpers';\nimport { START } from '@/lib/copy';\nconst WORKLET_URL = '/audio/proc.worklet.js';\nexport const MicCard = () => <div data-testid="mic-card" data-session-state="idle">{START}{helper()}{WORKLET_URL}</div>;\n`,
    [DEPENDENCY]: 'export const helper = () => 1;\n',
    [COPY]: "export const START = 'Start recording';\n",
    [UNRELATED]: 'export const other = 2;\n',
    ...Object.fromEntries(CONFIG_FILES.map((p) => [p, `config ${p}\n`])),
    // The build configuration imports a script outside frontend/ (as the real vite config imports scripts/build.config.js).
    'frontend/vite.config.mjs': "import { meta } from '../scripts/build.config.js';\nexport default { define: { meta } };\n",
    [BUILD_SCRIPT]: 'export const meta = 1;\n',
    // A file the page loads at runtime by URL, not by import.
    [WORKLET]: 'registerProcessor("proc", class {});\n',
};

/** A throwaway repository: commits are made in order and each one's full sha is returned. */
function fixtureRepo() {
    const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'adapter-reval-'));
    const git = (...args) => execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
        { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', HOME: root } }).toString().trim();
    git('init', '-q');
    const commit = (files, removed = []) => {
        for (const [p, body] of Object.entries(files)) {
            fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
            fs.writeFileSync(path.join(root, p), body);
        }
        for (const p of removed) fs.rmSync(path.join(root, p));
        git('add', '-A');
        git('commit', '-q', '--allow-empty', '-m', 'fixture');
        return git('rev-parse', 'HEAD');
    };
    const adapterDir = path.join(root, 'adapters');
    fs.mkdirSync(adapterDir);
    fs.writeFileSync(path.join(adapterDir, 'fixture.cjs'), ADAPTER);
    const source = commit(SOURCE_FILES);
    const shas = {
        source,
        unrelatedChanged: commit({ [UNRELATED]: 'export const other = 3;\n' }),
        dependencyChanged: commit({ [DEPENDENCY]: 'export const helper = () => 2;\n' }),
        lockfileChanged: commit({ 'pnpm-lock.yaml': 'changed lockfile\n' }),
        buildScriptChanged: commit({ [BUILD_SCRIPT]: 'export const meta = 2;\n' }),
        workletChanged: commit({ [WORKLET]: 'registerProcessor("proc", class { changed() {} });\n' }),
        selectorRemoved: commit({}, [SELECTOR]),
        missingAsset: commit({ [SELECTOR]: "const URL = '/audio/missing.worklet.js';\nexport const MicCard = () => <div data-testid=\"mic-card\" data-session-state=\"idle\">Start recording{URL}</div>;\n" }),
    };
    return { root, adapterDir, shas, read: (sha, p) => gitBlob(sha, p, root) };
}
const repo = fixtureRepo();
const fixtureManifest = derive({ sha: repo.shas.source, adapterDir: repo.adapterDir, repoRoot: repo.root });
const verdict = (servedSha, opts = {}) => revalidate({ servedSha, readBlob: repo.read, manifest: fixtureManifest, ...opts });
const paths = (m) => m.inputs.map((i) => i.path);

describe('deriving the inspected inputs (synthetic repository)', () => {
    it('binds the selector file, the dependency it imports, the file defining the adapter\'s copy, and the build configuration', () => {
        expect(fixtureManifest.sourceSha).toBe(repo.shas.source);
        expect(fixtureManifest.unresolved).toEqual([]);
        for (const p of [SELECTOR, DEPENDENCY, COPY, ...CONFIG_FILES, BUILD_SCRIPT, WORKLET]) expect(paths(fixtureManifest).includes(p)).toBe(true);
        expect(paths(fixtureManifest).includes(UNRELATED)).toBe(false);
        expect(fixtureManifest.packages).toEqual(['react']);
    });
    it('CONTROL: a test id no product file defines is recorded as unresolved, never dropped', () => {
        const dir = fs.mkdtempSync(path.join(repo.root, 'adapters-missing-'));
        fs.writeFileSync(path.join(dir, 'missing.cjs'), "async function run(page) { await page.getByTestId('no-such-id').click(); }\n");
        const m = derive({ sha: repo.shas.source, adapterDir: dir, repoRoot: repo.root });
        expect(m.unresolved).toEqual([{ kind: 'test-id', token: 'no-such-id' }]);
        expect(revalidate({ servedSha: repo.shas.source, readBlob: repo.read, manifest: m }).admissible).toBe(false);
    });
});

describe('reusing the inspection at a newer served release (synthetic repository)', () => {
    it('the inspected source itself, and a release that changed only an uninspected file, are admissible', () => {
        expect(verdict(repo.shas.source).admissible).toBe(true);
        expect(verdict(repo.shas.unrelatedChanged)).toMatchObject({ admissible: true, refused: [] });
    });
    it('CONTROL (Sam): the selector file is unchanged but a dependency it imports changed: refused, naming the dependency', () => {
        const v = verdict(repo.shas.dependencyChanged);
        expect(v.admissible).toBe(false);
        expect(v.refused).toEqual([{ path: DEPENDENCY, reason: 'changed since the inspected source' }]);
    });
    it('CONTROL: a changed lockfile is refused', () => {
        expect(verdict(repo.shas.lockfileChanged).refused.map((r) => r.path)).toEqual([DEPENDENCY, 'pnpm-lock.yaml']);
    });
    // Codex P2s on ddc27975: an input the build configuration imports, and a file the page loads at runtime by URL.
    it('CONTROL: a changed script the build configuration imports is refused, though no listed configuration file changed', () => {
        expect(verdict(repo.shas.buildScriptChanged).refused.some((r) => r.path === BUILD_SCRIPT && r.reason === 'changed since the inspected source')).toBe(true);
    });
    it('CONTROL: a changed runtime-loaded asset (an audio worklet loaded by URL) is refused', () => {
        expect(verdict(repo.shas.workletChanged).refused.some((r) => r.path === WORKLET && r.reason === 'changed since the inspected source')).toBe(true);
    });
    it('CONTROL: a code-like asset referenced by URL but absent from the public directory is unresolved, never dropped', () => {
        const m = derive({ sha: repo.shas.missingAsset, adapterDir: repo.adapterDir, repoRoot: repo.root });
        expect(m.unresolved).toEqual([{ kind: 'runtime-asset', file: SELECTOR, detail: '/audio/missing.worklet.js' }]);
        expect(revalidate({ servedSha: repo.shas.missingAsset, readBlob: repo.read, manifest: m }).admissible).toBe(false);
    });
    it('CONTROL: a missing or unreadable input is refused, never skipped', () => {
        const v = verdict(repo.shas.selectorRemoved);
        expect(v.admissible).toBe(false);
        expect(v.refused.find((r) => r.path === SELECTOR)).toEqual({ path: SELECTOR, reason: 'missing or unreadable at the served release' });
        const nulls = (sha, p) => (p === DEPENDENCY ? null : repo.read(sha, p));
        expect(verdict(repo.shas.unrelatedChanged, { readBlob: nulls }).refused).toEqual([{ path: DEPENDENCY, reason: 'missing at the served release' }]);
    });
    it('CONTROL: an unresolved dependency in the manifest refuses every case, whatever the served release', () => {
        const broken = { ...fixtureManifest, unresolved: [{ kind: 'import', file: 'frontend/src/x.ts', detail: './gone' }] };
        for (const servedSha of [repo.shas.source, repo.shas.unrelatedChanged]) expect(verdict(servedSha, { manifest: broken }).admissible).toBe(false);
    });
    it('CONTROL: an abbreviated, uppercase or missing served SHA is refused, even by a reader that would serve its blobs', () => {
        // A permissive reader resolves any spelling to the inspected bytes, so only the exact-SHA guard can refuse these.
        const anySpelling = (_sha, p) => repo.read(repo.shas.source, p);
        const source = repo.shas.source;
        for (const servedSha of [source.slice(0, 12), source.toUpperCase(), '', undefined]) expect(verdict(servedSha, { readBlob: anySpelling }).admissible).toBe(false);
        expect(verdict(repo.shas.unrelatedChanged, { readBlob: anySpelling }).admissible).toBe(true);
    });
    it('a refused verdict makes the case NOT RUN and names what changed; an admissible one never claims a product PASS', () => {
        const refused = caseAdmission('AHT-05', verdict(repo.shas.dependencyChanged));
        expect(refused.outcome).toBe('NOT RUN');
        expect(refused.detail).toContain(DEPENDENCY);
        expect(caseAdmission('AHT-05', verdict(repo.shas.source)).outcome).toBe('ADMISSIBLE');
    });
});

describe('the committed manifest for the sealed adapters', () => {
    it('is bound to the sealed source, with nothing unresolved, the build configuration included, and well-formed entries', () => {
        expect(manifest.sourceSha).toBe('5a7bf6a1cbd0fb2f4a1c2b363d891c8fcc462bd2');
        expect(manifest.unresolved).toEqual([]);
        expect(manifest.inputs.length > 100).toBe(true);
        for (const p of CONFIG_FILES) expect(paths(manifest).includes(p)).toBe(true);
        const sorted = [...paths(manifest)].sort((a, b) => a.localeCompare(b));
        expect(paths(manifest)).toEqual(sorted);
        expect(new Set(paths(manifest)).size).toBe(manifest.inputs.length);
        expect(manifest.inputs.every((i) => /^[0-9a-f]{64}$/.test(i.sha256))).toBe(true);
        expect(manifest.tokens.testIds > 50).toBe(true);
    });
});
