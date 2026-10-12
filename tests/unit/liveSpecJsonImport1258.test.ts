// @vitest-environment node
/**
 * #1258 alpha run 38288222695 — every RWT live spec that reached `tests/live/helpers/rwtCoachingEvidence.ts` failed to
 * LOAD in Playwright: the repo is `"type": "module"`, and Node 22 refuses a bare ESM `.json` import without an import
 * attribute ("needs an import attribute of type: json" → "No tests found"). Vitest accepts the same import, so the unit
 * suite stayed green and only a Production dispatch found it. Live code must read JSON at runtime (readFileSync +
 * JSON.parse) instead; this guard fails on any bare JSON import under tests/live.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIVE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../live');

/** An ESM import whose specifier ends in `.json` and carries no `with { type: 'json' }` attribute. */
const BARE_JSON_IMPORT = /^\s*import\s[^;]*?from\s*['"][^'"]+\.json['"](?![^;\n]*\bwith\s*\{\s*type\s*:\s*['"]json['"]\s*\})/m;

function liveSourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return liveSourceFiles(full);
        return /\.(ts|mts|js|mjs)$/.test(entry.name) ? [full] : [];
    });
}

describe('#1258 live specs load under Playwright: no bare ESM JSON imports in tests/live', () => {
    it('the pattern detects the exact import that broke run 38288222695 (positive control)', () => {
        expect(BARE_JSON_IMPORT.test("import fixtureManifest from '../../fixtures/rwt/rwt-fixtures.manifest.json';")).toBe(true);
    });

    it('allows runtime reads and attributed JSON imports (negative controls)', () => {
        expect(BARE_JSON_IMPORT.test("const m = JSON.parse(readFileSync(path.join(dir, 'rwt-fixtures.manifest.json'), 'utf8'));")).toBe(false);
        expect(BARE_JSON_IMPORT.test("import m from './x.json' with { type: 'json' };")).toBe(false);
        expect(BARE_JSON_IMPORT.test("import { a } from './helpers/rwtJourney';")).toBe(false);
    });

    it('no file under tests/live imports JSON as a bare ESM module', () => {
        const files = liveSourceFiles(LIVE_DIR);
        expect(files.length).toBeGreaterThan(10);
        const offenders = files
            .filter((file) => BARE_JSON_IMPORT.test(readFileSync(file, 'utf8')))
            .map((file) => path.relative(LIVE_DIR, file));
        expect(offenders).toEqual([]);
    });
});
