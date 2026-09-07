import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * #1259 P1 — THE GATE MUST HAVE A CALLER.
 *
 * The original defect was not a wrong branch. Every branch of `evaluateTelemetryCompleteness` was
 * tested and correct, and the gate still could not fail, because nothing outside the module and its own
 * unit tests ever called it. That is invisible to ordinary tests by construction: a module with no
 * consumer passes its own suite perfectly.
 *
 * So the wiring itself is the thing under test. This walks the repository and requires a caller that is
 * neither the module nor a test — the exact search Codex ran by hand, made permanent.
 */
const REPO = resolve(__dirname, '../../../../..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', 'playwright-report', 'test-results', '.next', 'build']);
const SOURCE_EXT = /\.(ts|tsx|mts|mjs|js|jsx|yml|yaml|json)$/;

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (SKIP_DIRS.has(entry)) continue;
        const full = join(dir, entry);
        let st;
        try { st = statSync(full); } catch { continue; }
        if (st.isDirectory()) walk(full, out);
        else if (SOURCE_EXT.test(entry)) out.push(full);
    }
    return out;
}

const isOwnModule = (f: string) => f.endsWith(join('telemetry', 'completenessGate.ts'));
const isTest = (f: string) => /__tests__|\.test\.|\.spec\./.test(f);

describe('#1259 completeness gate wiring', () => {
    const files = walk(REPO);

    it('has a PRODUCTION caller — not only the module and its tests', () => {
        const callers = files
            .filter((f) => !isOwnModule(f) && !isTest(f))
            .filter((f) => /evaluateTelemetryCompleteness|currentRunCompleteness/.test(readFileSync(f, 'utf8')))
            .map((f) => f.slice(REPO.length + 1));

        // Reported by path, because "there is no caller" and "the caller moved" need different fixes.
        expect({ callerCount: callers.length, callers }).toEqual({
            callerCount: callers.length,
            callers: expect.arrayContaining(['scripts/telemetry-readback-qualification.mts']),
        });
        expect(callers.length).toBeGreaterThan(0);
    });

    it('that caller is reachable as a command', () => {
        const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
        const wired = Object.entries(pkg.scripts)
            .filter(([, cmd]) => cmd.includes('telemetry-readback-qualification'))
            .map(([name]) => name);
        // A script nobody can invoke is the same defect one directory further out.
        expect({ commands: wired }).toEqual({ commands: ['telemetry:readback-qualification'] });
    });

    it('the caller fails CLOSED when it cannot read back', () => {
        const src = readFileSync(join(REPO, 'scripts/telemetry-readback-qualification.mts'), 'utf8');
        // Absent credentials, a transport failure, a non-OK status, unparseable JSON and an unexpected
        // shape must every one of them HOLD. A qualification step that skips when it cannot run reports
        // "we looked and it was fine" for "we did not look".
        for (const refusal of [
            'POSTHOG_PROJECT_ID is not set',
            'POSTHOG_PERSONAL_API_KEY is not set',
            'the readback request failed',
            'the readback returned HTTP',
            'the readback response was not JSON',
            'the readback response had no results array',
        ]) {
            expect({ refusal, present: src.includes(refusal) }).toEqual({ refusal, present: true });
        }
        expect(src).not.toMatch(/process\.exit\(0\)/);
    });
});
