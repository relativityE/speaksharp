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
// `apt-bundle` is a CI-only cache the runner creates with restrictive permissions; it holds no source.
const SKIP_DIRS = new Set([
    'node_modules', '.git', 'dist', 'coverage', 'playwright-report', 'test-results', '.next', 'build',
    'apt-bundle',
]);
const SOURCE_EXT = /\.(ts|tsx|mts|mjs|js|jsx|yml|yaml|json)$/;

function walk(dir: string, out: string[] = []): string[] {
    // A directory this process cannot read is skipped, not fatal. CI produces a few (EACCES on the
    // runner's apt cache), and refusing to walk the repository because of one of them would turn a
    // wiring guard into an environment-dependent failure. Nothing is masked: the assertions below name
    // the exact path they require, so an unreadable directory can only ever make this test FAIL, never
    // pass by omission.
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return out; }
    for (const entry of entries) {
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

    it('CASUALTY: the caller RUNS in a credentialed workflow, and its exit status governs', () => {
        // A command nobody executes is the same defect one directory further out. It has to run where
        // the credentials exist, and — this is the part that makes it a gate rather than a report — its
        // failure has to fail the job. A step marked `continue-on-error`, or guarded by `if: always()`
        // so it is recorded beside a green result, cannot hold anything.
        const wf = readFileSync(join(REPO, '.github/workflows/service-level-evidence.yml'), 'utf8');
        const raw = wf.split('- name:').find((s) => s.includes('telemetry:readback-qualification'));
        expect({ stepExists: Boolean(raw) }).toEqual({ stepExists: true });

        // COMMENTS STRIPPED FIRST. The step's own comment explains why it carries neither
        // `continue-on-error` nor `if: always()`, and a substring check that reads prose as
        // configuration matched exactly those words — this assertion failed on its own explanation.
        const step = raw!.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n');
        expect({
            hasApiKey: step!.includes('POSTHOG_PERSONAL_API_KEY'),
            hasProject: step!.includes('POSTHOG_PROJECT_ID'),
            pinnedToTheRelease: step!.includes('RELEASE_SHA'),
            scopedToOneJourney: step!.includes('TELEMETRY_QUALIFICATION_JOURNEY_ID'),
            // Both of these would stop the step from governing anything.
            swallowsFailure: step!.includes('continue-on-error'),
            runsRegardlessOfOutcome: step!.includes('if: always()'),
        }).toEqual({
            hasApiKey: true, hasProject: true, pinnedToTheRelease: true, scopedToOneJourney: true,
            swallowsFailure: false, runsRegardlessOfOutcome: false,
        });
    });

    it('CASUALTY: qualification is scoped to ONE journey — never a union across a time window', () => {
        // A window unions everything inside it: several users, several tabs, several attempts. Ten
        // people each producing a different third of the required families would union to a complete
        // set, and the gate would report QUALIFIED for a run in which nobody's session was complete.
        const src = readFileSync(join(REPO, 'scripts/telemetry-readback-qualification.mts'), 'utf8');
        expect({
            filtersByJourney: src.includes('properties.journey_id'),
            filtersByTraffic: src.includes('properties.traffic_type'),
            // Required, not defaulted: a missing journey must HOLD rather than silently widen the query.
            holdsWithoutAJourney: src.includes('no --journey-id supplied'),
        }).toEqual({ filtersByJourney: true, filtersByTraffic: true, holdsWithoutAJourney: true });
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
