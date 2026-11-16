"use strict";
// Nightly AHT suite: the selected adapters' inspection may be reused at a newer served release only when every inspected input
// is byte-identical there (Sam, 16 Nov). Offline: blobs come from this checkout's git objects or from injected readers.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { describe, it } = require('node:test');
const { expect } = require('./expect-lite.cjs');
const { caseAdmission, gitBlob, revalidate } = require('../adapter-revalidation.cjs');
const { derive } = require('../derive-adapter-inputs.cjs');
const manifest = require('../adapter-inputs.json');

const SOURCE = manifest.sourceSha;
const SERVED = 'c'.repeat(40);
/** A served release whose blobs are the inspected source's, except the overrides (path -> bytes, or null for missing). */
const servedLike = (overrides = {}) => (sha, p) => {
    if (sha !== SERVED) throw new Error('unexpected sha');
    if (Object.prototype.hasOwnProperty.call(overrides, p)) return overrides[p];
    return gitBlob(SOURCE, p);
};
const has = (p) => manifest.inputs.some((i) => i.path === p);
const text = (p) => gitBlob(SOURCE, p).toString('utf8');
// A selector file (defines a test id) and a dependency it imports that defines none: Sam's "selector unchanged, dependency changed".
const selectorFile = manifest.inputs.map((i) => i.path).find((p) => p.endsWith('.tsx') && text(p).includes('data-testid="mic-card"'));
const dependency = (() => {
    const src = text(selectorFile);
    for (const m of src.matchAll(/from\s*['"](@\/[^'"]+|\.{1,2}\/[^'"]+)['"]/g)) {
        const spec = m[1];
        const base = spec.startsWith('@/') ? path.posix.join('frontend/src', spec.slice(2)) : path.posix.join(path.posix.dirname(selectorFile), spec);
        const hit = ['.ts', '.tsx', '/index.ts', '/index.tsx'].map((e) => base + e).find((c) => has(c) && !text(c).includes('data-testid'));
        if (hit) return hit;
    }
    return null;
})();

describe('the inspected-input manifest', () => {
    it('binds the adapters\' product dependencies at the sealed source, with nothing unresolved', () => {
        expect(SOURCE).toBe('5a7bf6a1cbd0fb2f4a1c2b363d891c8fcc462bd2');
        expect(manifest.unresolved).toEqual([]);
        expect(manifest.inputs.length > 100).toBe(true);
        for (const p of ['pnpm-lock.yaml', 'frontend/package.json', 'frontend/vite.config.mjs']) expect(has(p)).toBe(true);
        expect(manifest.tokens.testIds > 50).toBe(true);
    });
    it('is exactly what the deriver produces at the sealed source (no hand edits, no drift)', () => {
        expect(JSON.stringify(derive())).toBe(JSON.stringify(manifest));
    });
});

describe('reusing the inspection at a newer served release', () => {
    it('the inspected source itself is admissible', () => {
        expect(revalidate({ servedSha: SOURCE }).admissible).toBe(true);
    });
    it('a release whose every inspected input is unchanged is admissible', () => {
        expect(revalidate({ servedSha: SERVED, readBlob: servedLike() })).toMatchObject({ admissible: true, refused: [] });
    });
    it('CONTROL (Sam): the selector file is unchanged but a dependency it imports changed: refused, naming the dependency', () => {
        expect(typeof selectorFile).toBe('string');
        expect(typeof dependency).toBe('string');
        const v = revalidate({ servedSha: SERVED, readBlob: servedLike({ [dependency]: Buffer.from(`${text(dependency)}\n// changed`) }) });
        expect(v.admissible).toBe(false);
        expect(v.refused).toEqual([{ path: dependency, reason: 'changed since the inspected source' }]);
    });
    it('CONTROL: a changed selector file, lockfile or build config is refused', () => {
        for (const p of [selectorFile, 'pnpm-lock.yaml', 'frontend/vite.config.mjs']) {
            const v = revalidate({ servedSha: SERVED, readBlob: servedLike({ [p]: Buffer.from('changed') }) });
            expect(v.refused.map((r) => r.path)).toEqual([p]);
        }
    });
    it('CONTROL: a missing or unreadable input is refused, never skipped', () => {
        expect(revalidate({ servedSha: SERVED, readBlob: servedLike({ [dependency]: null }) }).refused[0].reason).toContain('missing');
        const throwing = (sha, p) => { if (p === dependency) throw new Error('no object'); return servedLike()(sha, p); };
        expect(revalidate({ servedSha: SERVED, readBlob: throwing }).refused[0]).toEqual({ path: dependency, reason: 'missing or unreadable at the served release' });
    });
    it('CONTROL: an unresolved dependency in the manifest refuses every case, whatever the served release', () => {
        const broken = { ...manifest, unresolved: [{ kind: 'import', file: 'frontend/src/x.ts', detail: './gone' }] };
        for (const servedSha of [SOURCE, SERVED]) expect(revalidate({ servedSha, readBlob: servedLike(), manifest: broken }).admissible).toBe(false);
    });
    it('CONTROL: an abbreviated, uppercase or missing served SHA is refused, even by a reader that would serve its blobs', () => {
        // A permissive reader resolves any spelling to the inspected bytes, so only the exact-SHA guard can refuse these.
        const anySpelling = (_sha, p) => gitBlob(SOURCE, p);
        for (const servedSha of [SOURCE.slice(0, 12), SOURCE.toUpperCase(), '', undefined]) expect(revalidate({ servedSha, readBlob: anySpelling }).admissible).toBe(false);
        expect(revalidate({ servedSha: SERVED, readBlob: anySpelling }).admissible).toBe(true);
    });
    it('a refused verdict makes the case NOT RUN and names what changed; an admissible one never claims a product PASS', () => {
        const refused = caseAdmission('AHT-05', revalidate({ servedSha: SERVED, readBlob: servedLike({ [dependency]: Buffer.from('x') }) }));
        expect(refused.outcome).toBe('NOT RUN');
        expect(refused.detail).toContain(dependency);
        expect(caseAdmission('AHT-05', revalidate({ servedSha: SOURCE })).outcome).toBe('ADMISSIBLE');
    });
    it('today\'s main is not admissible: its changed inputs are named for re-inspection', () => {
        const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.resolve(__dirname, '../../../..') }).toString().trim();
        if (head === SOURCE) return;
        const v = revalidate({ servedSha: head });
        expect(v.admissible).toBe(false);
        expect(v.refused.every((r) => typeof r.path === 'string' && r.reason.length > 0)).toBe(true);
    });
});
