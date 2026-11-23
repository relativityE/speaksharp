// @vitest-environment node
/**
 * J7.c isolated build: the fixture refuses to build while a repo-root dotenv file the build's own config would read exists.
 * Controls use fake files in a temp directory; the real repo root is never touched.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import { assertNoRootDotenv, rootDotenvFiles } from '../e2e/helpers/isolatedBuildDotenv';

const MARKER = 'j7c-fake-dotenv-value-never-printed';
const dirs: string[] = [];
const fresh = () => { const dir = mkdtempSync(join(tmpdir(), 'j7c-dotenv-')); dirs.push(dir); return dir; };
afterEach(() => { while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true }); });

describe('J7.c isolated build: repo-root dotenv files', () => {
    it('names exactly the files Vite loadEnv reads for the mode, and no other', () => {
        expect(rootDotenvFiles('production')).toEqual(['.env', '.env.local', '.env.production', '.env.production.local']);
        // Tie the list to Vite itself: each listed file is read by loadEnv(mode, dir, ''); a file for another mode is not.
        for (const name of rootDotenvFiles('production')) {
            const dir = fresh();
            writeFileSync(join(dir, name), 'J7C_PROBE=read\n');
            expect({ name, read: loadEnv('production', dir, '').J7C_PROBE }).toEqual({ name, read: 'read' });
        }
        const other = fresh();
        writeFileSync(join(other, '.env.development'), 'J7C_PROBE=read\n');
        expect(loadEnv('production', other, '').J7C_PROBE).toBeUndefined();
        expect(() => rootDotenvFiles('../x')).toThrow(/unexpected Vite mode/);
    });

    it('passes with none of them present, including when unread files exist', () => {
        const dir = fresh();
        expect(() => assertNoRootDotenv(dir, 'production')).not.toThrow();
        writeFileSync(join(dir, '.env.development'), `SECRET=${MARKER}\n`);
        writeFileSync(join(dir, '.env.example'), `SECRET=${MARKER}\n`);
        mkdirSync(join(dir, 'frontend'));
        writeFileSync(join(dir, 'frontend', '.env'), `SECRET=${MARKER}\n`);
        expect(() => assertNoRootDotenv(dir, 'production')).not.toThrow();
    });

    it.each(['.env', '.env.local', '.env.production', '.env.production.local'])(
        'fails before the build when %s exists, naming the file and never its contents', (name) => {
            const dir = fresh();
            writeFileSync(join(dir, name), `VITE_SUPABASE_URL=${MARKER}\n`);
            let message = '';
            try { assertNoRootDotenv(dir, 'production'); } catch (error) { message = (error as Error).message; }
            expect(message).toContain(name);
            expect(message).toMatch(/^isolated build refused/);
            expect(message).not.toContain(MARKER);
        });

    it('the spec\'s build refuses before it spawns: the check runs first in buildIsolatedApp, with the build\'s own mode', () => {
        const spec = readFileSync(join(process.cwd(), 'tests', 'e2e', 'j7c-real-worker-isolated.e2e.spec.ts'), 'utf8');
        const start = spec.indexOf('async function buildIsolatedApp(');
        expect(start).toBeGreaterThan(-1);
        const body = spec.slice(start, spec.indexOf('\n}\n', start));
        const check = body.indexOf('assertNoRootDotenv(process.cwd(), BUILD_MODE)');
        expect(check, 'buildIsolatedApp checks the repo root').toBeGreaterThan(-1);
        expect(check, 'the check comes before the child build is spawned').toBeLessThan(body.indexOf('execFile('));
        expect(spec).toContain("mode: '${BUILD_MODE}'");
    });
});
