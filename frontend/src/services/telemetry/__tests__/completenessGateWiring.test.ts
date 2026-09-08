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

    it('CASUALTY: the traffic class is NAMED, never defaulted to one Production cannot emit', () => {
        // `resolveTrafficType()` reserves `internal` for a build Production users never receive, and emits
        // `canary` for the automated account and `internal_test` for a human dogfood session. Hard-coding
        // `internal` matched nothing on the deployment this gate qualifies: the readback returned no rows
        // and HELD even when the intended journey had been ingested perfectly. A gate that always fails
        // is as useless as one that always passes, and more expensive to ignore.
        const src = readFileSync(join(REPO, 'scripts/telemetry-readback-qualification.mts'), 'utf8');
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

        expect({
            noSilentDefault: !/TELEMETRY_QUALIFICATION_TRAFFIC_TYPE\s*\?\?\s*'/.test(code),
            holdsWhenUnnamed: src.includes('no --traffic-type supplied'),
            rejectsUnknownClasses: src.includes('is not a controlled evidence class'),
        }).toEqual({ noSilentDefault: true, holdsWhenUnnamed: true, rejectsUnknownClasses: true });

        const wf = readFileSync(join(REPO, '.github/workflows/service-level-evidence.yml'), 'utf8');
        const wfCode = wf.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
        expect({ hardCodedInternal: /TELEMETRY_QUALIFICATION_TRAFFIC_TYPE:\s*internal\s*$/m.test(wfCode) })
            .toEqual({ hardCodedInternal: false });
    });

    it('CASUALTY: the identity receipts are required but NOT journey-scoped', () => {
        // A controlled user signs in and only then enters the product, so `account_identified` and the
        // positive control carry the PRE-PRODUCT journey while the session receipts carry the one minted
        // on entry. Requiring both inside a single `journey_id` selects one set or the other and can
        // never see both — an ordinary complete run could not qualify. They stay required, and stay
        // pinned to the release and traffic class; they are simply not in the journey.
        const src = readFileSync(join(REPO, 'scripts/telemetry-readback-qualification.mts'), 'utf8');
        expect({
            scopesPreJourneyFamiliesSeparately: src.includes('PRE_JOURNEY_EVENT_FAMILIES'),
            stillJourneyScopedOtherwise: src.includes('properties.journey_id'),
            stillPinnedToTraffic: src.includes('properties.traffic_type'),
        }).toEqual({
            scopesPreJourneyFamiliesSeparately: true,
            stillJourneyScopedOtherwise: true,
            stillPinnedToTraffic: true,
        });
    });

    it('CASUALTY: only CONTROLLED traffic may qualify — customer activity cannot', () => {
        // Validating against every runtime classification accepted `user`, which is real customer
        // activity: a copied journey id would then certify release telemetry from someone's actual
        // session — evidence we did not produce and cannot reproduce. `internal` fails for the opposite
        // reason: it marks a build Production users never receive, so it cannot describe the deployment
        // being qualified.
        const src = readFileSync(join(REPO, 'scripts/telemetry-readback-qualification.mts'), 'utf8');
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

        expect({
            hasControlledSubset: /CONTROLLED_EVIDENCE_TRAFFIC[^=]*=\s*\['canary',\s*'internal_test'\]/.test(code),
            validatesAgainstSubset: code.includes('CONTROLLED_EVIDENCE_TRAFFIC as readonly string[]).includes(trafficType)'),
            // The old check accepted anything the product emits. Its absence is the correction.
            noLongerAcceptsEveryRuntimeClass: !/TRAFFIC_TYPES as readonly string\[\]\)\.includes\(trafficType\)/.test(code),
            holdsOnUncontrolled: src.includes('is not a controlled evidence class'),
        }).toEqual({
            hasControlledSubset: true,
            validatesAgainstSubset: true,
            noLongerAcceptsEveryRuntimeClass: true,
            holdsOnUncontrolled: true,
        });
    });

    it('CASUALTY: the pre-journey receipts are bound to the journey\'s own identity', () => {
        // Splitting them out of the journey scope was right — they are emitted before the product journey
        // exists — but leaving them scoped only by release and traffic class re-opened the union the
        // journey filter closed: any other run in the window carrying the same release and class would
        // satisfy them, so the selected journey could be missing BOTH its own identity receipts and still
        // qualify on somebody else's.
        const src = readFileSync(join(REPO, 'scripts/telemetry-readback-qualification.mts'), 'utf8');

        expect({
            // The identity is DERIVED from the journey rows, never supplied — it cannot be asserted
            // independently of the run being judged.
            derivesIdentityFromTheJourney: src.includes('SELECT DISTINCT distinct_id'),
            bindsTheReadbackToIt: src.includes('AND distinct_id = ${sql(qualifyingIdentity)}'),
            // No identity means nothing to bind to, and more than one means the journey id is not the
            // discriminator we believe it is. Both HOLD rather than fall back to an unbound match.
            holdsWhenNoIdentity: src.includes('there is no identity to bind its receipts to'),
            holdsWhenAmbiguous: src.includes('a journey belongs to exactly one'),
        }).toEqual({
            derivesIdentityFromTheJourney: true,
            bindsTheReadbackToIt: true,
            holdsWhenNoIdentity: true,
            holdsWhenAmbiguous: true,
        });
    });

    it('CASUALTY: every query fails closed, not just the first one', () => {
        // Two questions are asked now — the identity lookup and the family readback — and a transport
        // error on EITHER must HOLD. One shared transport is what makes that true without a second copy
        // of five refusal paths, which is where one of them goes missing.
        const src = readFileSync(join(REPO, 'scripts/telemetry-readback-qualification.mts'), 'utf8');
        const fetchCount = (src.match(/await fetch\(/g) ?? []).length;
        expect({ transports: fetchCount, sharedHelper: src.includes('async function runQuery(') })
            .toEqual({ transports: 1, sharedHelper: true });
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
        // The transport refusals are templated now that two queries share one helper — the label varies,
        // the refusal does not. Checking the template is checking the behaviour for BOTH callers.
        for (const refusal of [
            'POSTHOG_PROJECT_ID is not set',
            'POSTHOG_PERSONAL_API_KEY is not set',
            '${label} request failed',
            '${label} returned HTTP',
            '${label} response was not JSON',
            '${label} response had no results array',
        ]) {
            expect({ refusal, present: src.includes(refusal) }).toEqual({ refusal, present: true });
        }
        expect(src).not.toMatch(/process\.exit\(0\)/);
    });
});
