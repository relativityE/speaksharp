/**
 * #1421 P2 — THE CONTROLLED-TRAFFIC SUBSET IS A COMPILE-TIME CLAIM, SO COMPILE IT.
 *
 * `scripts/telemetry-readback-qualification.mts` declares:
 *
 *     const CONTROLLED_EVIDENCE_TRAFFIC: readonly (typeof TRAFFIC_TYPES[number])[] = ['canary', 'internal_test'];
 *
 * with a comment saying a rename in the product vocabulary breaks it at compile time rather than
 * silently widening the gate. That was not true of anything the repository ran. No TypeScript project
 * included the file, and the script is executed with `tsx`, which ERASES types rather than checking
 * them — so the subset constraint was evaluated by nothing, and dropping `canary` from the product
 * vocabulary would have left this file compiling happily against a class that no longer exists.
 *
 * Two independent assertions here:
 *
 *   1. the script is inside a project `pnpm quality` actually typechecks — otherwise every claim below
 *      is about a compiler that never runs on it;
 *   2. the constraint BITES: a real `tsc` invocation over the same declaration, against a vocabulary
 *      missing `canary`, must fail. The fixture is generated from the shipping shape rather than
 *      hand-copied, so it cannot drift away from the thing it stands for.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve(__dirname, '..', '..');
const SCRIPT = 'scripts/telemetry-readback-qualification.mts';

/** Compile two files with the real compiler and report whether it accepted them. */
function typechecks(vocabulary, selection) {
    const dir = mkdtempSync(join(tmpdir(), 'controlled-traffic-'));
    try {
        writeFileSync(join(dir, 'trafficType.ts'),
            `export const TRAFFIC_TYPES = [${vocabulary.map((t) => `'${t}'`).join(', ')}] as const;\n`);
        writeFileSync(join(dir, 'use.ts'),
            "import { TRAFFIC_TYPES } from './trafficType';\n"
            + `const CONTROLLED_EVIDENCE_TRAFFIC: readonly (typeof TRAFFIC_TYPES[number])[] = `
            + `[${selection.map((t) => `'${t}'`).join(', ')}];\n`
            + 'export default CONTROLLED_EVIDENCE_TRAFFIC;\n');
        writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
            compilerOptions: {
                target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler',
                strict: true, noEmit: true, skipLibCheck: true, types: [],
            },
            include: ['*.ts'],
        }));
        execFileSync(join(repo, 'node_modules', '.bin', 'tsc'), ['--noEmit', '-p', dir],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return true;
    } catch {
        return false;
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

describe('#1421 — the controlled evidence traffic subset is checked by the real compiler', () => {
    it('the qualification script is inside a project pnpm quality typechecks', () => {
        // `typecheck:live` runs inside `pnpm quality`. Without this membership the compile-time claim
        // below describes a compiler that never sees the file.
        const live = readFileSync(join(repo, 'tsconfig.live.json'), 'utf8');
        expect(live, 'the script must be in the checked live project').toContain(SCRIPT);
        const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
        expect(pkg.scripts['quality:unguarded'], 'quality must run the project that checks it')
            .toContain('typecheck:live');
    });

    it('CONTROL: the shipping vocabulary accepts the shipping selection', () => {
        // Without this the casualty below would also pass if `tsc` never ran, or failed for an
        // unrelated reason like a broken fixture.
        expect(typechecks(['user', 'internal', 'canary', 'internal_test'], ['canary', 'internal_test']))
            .toBe(true);
    });

    it('CASUALTY: removing `canary` from the product vocabulary FAILS the typecheck', () => {
        expect(typechecks(['user', 'internal', 'internal_test'], ['canary', 'internal_test']))
            .toBe(false);
    });

    it('CASUALTY: renaming `internal_test` FAILS the typecheck', () => {
        expect(typechecks(['user', 'internal', 'canary', 'internal_qa'], ['canary', 'internal_test']))
            .toBe(false);
    });

    it('the selection this test compiles is the one the script actually declares', () => {
        // The fixture must not drift into proving a constraint the script does not carry.
        const script = readFileSync(join(repo, SCRIPT), 'utf8');
        expect(script).toContain(
            "const CONTROLLED_EVIDENCE_TRAFFIC: readonly (typeof TRAFFIC_TYPES[number])[] = ['canary', 'internal_test'];");
    });
});
