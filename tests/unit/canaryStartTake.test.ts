// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
    startTake,
    type TakeAssertions,
    CONTROL_WAIT_MS,
    COLD_START_RPC_TIMEOUT_MS,
    COLD_START_TOTAL_BUDGET_MS,
} from '../canary/canaryStartTake';
import {
    canaryTestTimeoutMs,
    withPhaseDeadline,
    parseJobTimeoutMs,
    CanaryPhaseTimeout,
    PHASE_BUDGETS_MS,
    PRODUCT_PHASES,
    PRODUCT_SMOKE_BUDGET_MS,
    DEPLOY_WAIT_MS,
    DEPLOY_VERDICT_SLACK_MS,
    INTER_PHASE_HEADROOM_MS,
} from '../canary/canaryBudget';

/**
 * #1306 — THE COLD ACCOUNT PATH, REPRODUCED IN MILLISECONDS.
 *
 * The canary went red on `594e95ac` while Production worked perfectly: the page read `RECORDING 01:55`
 * with no `mic-start` in the DOM, because the setup press now records (#1415) and the retired helper was
 * still waiting for a control the recorder had correctly replaced. Four attempts across two paid
 * Production runs to observe what this file states in a few milliseconds.
 *
 * WHY THE FAKE IS A STATE MACHINE AND NOT CANNED ANSWERS. A stub with fixed replies answers the same
 * way whether or not the control was pressed, so it passes for a helper that presses nothing. This fake
 * renders controls by the product's rules — `mic-download` only while the model is absent, `mic-start`
 * only when the recorder is not up — and every click mutates it. It also records the ORDER of clicks
 * and of listener arming, because the two defects this file exists to prevent are both ordering bugs.
 */

interface FakeOptions { cold?: boolean }

const makePage = ({ cold = true }: FakeOptions = {}) => {
    const events: string[] = [];
    const state = { recording: false };

    const present = (testId: string) => {
        if (testId === 'mic-download') return cold && !state.recording;
        if (testId === 'mic-start') return !cold && !state.recording;
        return false;
    };

    /** One Production session row per click of a start-bearing control. */
    const sessions: string[] = [];

    const locator = (testId: string): Locator => ({
        testId,
        count: async () => (present(testId) ? 1 : 0),
        first() { return this; },
        or(other: Locator) { return present(testId) ? this : other; },
        click: async () => {
            events.push(`click:${testId}`);
            sessions.push(testId);
            state.recording = true;
        },
    });
    type Locator = {
        testId: string;
        count(): Promise<number>;
        first(): Locator;
        or(other: Locator): Locator;
        click(): Promise<void>;
    };

    const page = {
        getByTestId: (testId: string) => locator(testId),
        waitForResponse: async (
            predicate: (r: { url(): string; request(): { method(): string } }) => boolean,
            options?: { timeout?: number },
        ) => {
            events.push(`arm:${options?.timeout ?? 'none'}`);
            const response = {
                url: () => 'https://x.supabase.co/rest/v1/rpc/create_session_and_update_usage',
                request: () => ({ method: () => 'POST' }),
            };
            if (!predicate(response)) throw new Error('the armed predicate did not match the start RPC');
            return response;
        },
    };

    const assertions: TakeAssertions<Locator> = {
        visible: async (l) => { events.push(`visible:${l.testId}`); },
        enabled: async (l) => { events.push(`enabled:${l.testId}`); },
    };

    return { page, assertions, events, sessions };
};

describe('#1306 canary start — one control, one click, one session', () => {
    it('CASUALTY: a cold account starts the take on the setup control, and the listener is armed FIRST', async () => {
        const { page, assertions, events, sessions } = makePage({ cold: true });

        const { path } = await startTake(page, assertions);

        expect(path).toBe('cold');
        expect(sessions, 'exactly one Production session may be created').toEqual(['mic-download']);
        // MUTATION 1 — arming after the click. On a cold account the RPC fires FROM this press, so a
        // listener armed afterwards misses it and the canary loses its session binding.
        expect(events.indexOf('arm:150000'), 'the listener must be armed before the click')
            .toBeLessThan(events.indexOf('click:mic-download'));
        // The cold budget must cover the one-time model download that precedes the recording start.
        expect(events).toContain('arm:150000');
    });

    it('CASUALTY: the cold path clicks the setup control ONCE and never also clicks start', async () => {
        // MUTATION 2 — the two-session regression, and the defect in the design this one replaced.
        // A cold press invokes startRecording -> create_session_and_update_usage. Pressing mic-download
        // and then also mic-start writes TWO rows to Production and can bind the capture to the wrong
        // one. This is the property the comment used to carry alone.
        const { page, assertions, sessions, events } = makePage({ cold: true });
        await startTake(page, assertions);
        expect(sessions).toHaveLength(1);
        expect(events.filter((e) => e.startsWith('click:')), 'exactly one click on exactly one control')
            .toEqual(['click:mic-download']);
    });

    it('CASUALTY: a warm account uses mic-start, with the short budget', async () => {
        const { page, assertions, events, sessions } = makePage({ cold: false });
        const { path } = await startTake(page, assertions);
        expect(path).toBe('warm');
        expect(sessions).toEqual(['mic-start']);
        expect(events).toContain('arm:20000');
        expect(events.indexOf('arm:20000')).toBeLessThan(events.indexOf('click:mic-start'));
    });

    it('CASUALTY: the reported path matches the control actually pressed', async () => {
        // MUTATION 3 — reporting `warm` on a cold run. The attachment is how a warm pass is prevented
        // from silently standing in for the first-run journey, so a lying label defeats its purpose.
        for (const cold of [true, false]) {
            const { page, assertions, events } = makePage({ cold });
            const { path } = await startTake(page, assertions);
            const clicked = events.find((e) => e.startsWith('click:'));
            expect(clicked, `path=${path}`).toBe(path === 'cold' ? 'click:mic-download' : 'click:mic-start');
        }
    });

    it('the armed predicate matches the start RPC by method AND path, not by either alone', async () => {
        const { page, assertions } = makePage();
        const { authoritativeStart } = await startTake(page, assertions);
        await expect(authoritativeStart).resolves.toBeDefined();
    });
});

describe('#1306 no retired start behaviour survives, in either file', () => {
    /**
     * A GUARD MUST DISTINGUISH MENTIONING A THING FROM DOING IT (Consultant, 2026-09-21).
     *
     * The first version of this guard forbade the bare name `ensurePrivateReady` in the spec. That is
     * the wrong shape twice over: it would reject a comment that RECORDS what was retired — which the
     * reviewed doc comment deliberately does — while ignoring a real call in the extracted module,
     * which it never read. It passed only because of how I happened to word the doc.
     *
     * So it now forbids the CALL FORM, in BOTH files. Documenting the retired helper is allowed;
     * invoking it is not. Same discipline as the credential guard that never names the literal it
     * forbids.
     */
    const FILES = ['tests/canary/smoke.canary.spec.ts', 'tests/canary/canaryStartTake.ts'] as const;
    const RETIRED = [
        'ensurePrivateReady(',              // the call, not the name
        'ready Start control',              // the retired two-click description
        'toBeEnabled({ timeout: 120000 })', // the wait for a control the recorder replaces
    ] as const;

    it.each(FILES)('%s invokes and describes nothing retired', async (file) => {
        const { readFileSync } = await import('node:fs');
        const source = readFileSync(file, 'utf8');
        for (const retired of RETIRED) {
            expect(source, `retired in ${file}: ${retired}`).not.toContain(retired);
        }
    });

    it('the spec starts the take through the extracted module', async () => {
        const { readFileSync } = await import('node:fs');
        expect(readFileSync('tests/canary/smoke.canary.spec.ts', 'utf8')).toContain("from './canaryStartTake'");
    });

    it('GUARD DISCRIMINATION: the call form is caught, a doc mention is not', () => {
        const documentsIt = ' * The retired `ensurePrivateReady` clicked `mic-download` to "ready" the recorder.';
        const callsIt = '    await ensurePrivateReady(page);';
        const forbidden = (source: string) => RETIRED.some((r) => source.includes(r));
        expect(forbidden(callsIt), 'a real call must be caught').toBe(true);
        expect(forbidden(documentsIt), 'a doc comment naming it must be allowed').toBe(false);
    });
});

/**
 * #1518 — THE CLOCK IS PART OF THE CONTRACT, AND CEILINGS MUST BE ENFORCED RATHER THAN ESTIMATED.
 *
 * Round 1 (Codex, `fa322aa33`): the 150s cold wait could not elapse under a 60s per-test ceiling that
 * was raised only when the deploy gate was armed.
 *
 * Round 2 (PM RETURN, `3492c5b9e`): my replacement summed what I BELIEVED each phase cost, and the
 * inventory was wrong — navigation alone hides an app-visible barrier plus `waitForURL` plus route-shell
 * waits, recording validation has four assertions not three, and stop/save omitted the stop-control
 * wait, the reload and the sessions-response validation. A sum of guessed internal waits cannot be
 * verified, so the phases are now BOUNDED and the total is the sum of ceilings that actually fire.
 */
describe('#1518 phase ceilings are enforced, and the outer budgets exceed their sum', () => {
    const repoRoot = resolve(__dirname, '..', '..');
    const config = readFileSync(resolve(repoRoot, 'playwright.canary.config.ts'), 'utf8');
    const workflow = readFileSync(resolve(repoRoot, '.github/workflows/canary.yml'), 'utf8');
    const spec = readFileSync(resolve(repoRoot, 'tests/canary/smoke.canary.spec.ts'), 'utf8');

    const configDefaultMs = Number(/^\s*timeout:\s*(\d+),/m.exec(config)?.[1]);
    const canaryCheckTimeoutMs = parseJobTimeoutMs(workflow, 'canary-check');

    it('the fixtures parsed (an unread config or workflow would make the rest vacuous)', () => {
        expect(Number.isFinite(configDefaultMs)).toBe(true);
        expect(canaryCheckTimeoutMs).not.toBeNull();
        expect(PRODUCT_PHASES.length).toBeGreaterThanOrEqual(7);
    });

    it('the internal cold-start timeout and the helper total are unchanged', () => {
        // PM RETURN: keep the 150s RPC wait and the one-click/one-session behaviour exactly as they are.
        expect(COLD_START_RPC_TIMEOUT_MS).toBe(150_000);
        expect(COLD_START_TOTAL_BUDGET_MS).toBe(CONTROL_WAIT_MS * 2 + COLD_START_RPC_TIMEOUT_MS);
        expect(PHASE_BUDGETS_MS.start_take).toBe(COLD_START_TOTAL_BUDGET_MS);
    });

    it('the product total is the sum of the ENFORCED phase ceilings plus inter-phase headroom', () => {
        const summed = PRODUCT_PHASES.reduce((t, phase) => t + PHASE_BUDGETS_MS[phase], 0);
        expect(PRODUCT_SMOKE_BUDGET_MS).toBe(summed + INTER_PHASE_HEADROOM_MS);
        expect(PRODUCT_PHASES).not.toContain('deploy_gate');
        // Every product phase the spec performs is bounded — no phase may run unbudgeted.
        for (const phase of PRODUCT_PHASES) {
            expect(spec, `phase ${phase} must run under withPhaseDeadline`).toContain(`withPhaseDeadline('${phase}'`);
        }
    });

    it('CASUALTY: the self-bounded deploy poll is NOT raced against a same-budget timer', () => {
        // Codex, exact head 90a1eceb8: wrapping the already-bounded poll in withPhaseDeadline let the outer
        // timer fire first and swallow DEPLOYMENT NOT LIVE plus its `deployed-release` evidence.
        expect(spec).not.toContain("withPhaseDeadline('deploy_gate'");
        expect(spec).toMatch(/^\s+await assertDeployedReleaseIsLive\(page\);$/m);
        // …and the outer budget pays for the verdict path after the poll's deadline.
        expect(DEPLOY_VERDICT_SLACK_MS).toBeGreaterThan(0);
    });

    it('CASUALTY: nothing between phases awaits the page — every wait lives inside a phase', () => {
        /*
         * Codex, exact head 90a1eceb8: a 15s control-visibility wait sat between `navigate_session` and
         * `pre_start_checks` with no budget; and on inspection the 150s cold RPC wait itself —
         * `await authoritativeStart` — ran AFTER `start_take` returned, outside every phase. A total that
         * is a sum of phase ceilings is only a bound if nothing waits outside them.
         *
         * So: from the timeout installation to the end of the test, every `await` that is not inside a
         * `withPhaseDeadline(...)` call must be an evidence attachment or the self-bounded deploy poll.
         */
        const start = spec.indexOf('test.setTimeout(canaryTestTimeoutMs');
        expect(start).toBeGreaterThan(0);
        const body = spec.slice(start);

        // Mark the source ranges covered by each withPhaseDeadline(...) call by balancing parentheses.
        const covered: Array<[number, number]> = [];
        for (const m of body.matchAll(/withPhaseDeadline\(/g)) {
            let depth = 0;
            for (let i = m.index! + 'withPhaseDeadline'.length; i < body.length; i += 1) {
                if (body[i] === '(') depth += 1;
                else if (body[i] === ')') { depth -= 1; if (depth === 0) { covered.push([m.index!, i]); break; } }
            }
        }
        const inside = (at: number) => covered.some(([a, b]) => at > a && at < b);
        const allowed = /^await (test\.info\(\)\.attach\(|assertDeployedReleaseIsLive\(|withPhaseDeadline\()/;

        const stray = [...body.matchAll(/await [^\n;]+/g)]
            .filter((m) => !inside(m.index!))
            .map((m) => m[0])
            .filter((text) => !allowed.test(text));
        expect(stray, 'waits outside any phase').toEqual([]);
        expect(covered.length).toBeGreaterThanOrEqual(PRODUCT_PHASES.length);
    });

    it('CASUALTY: start_take awaits the authoritative RPC inside its own phase', () => {
        // The largest wait in the journey. It must be bounded by the phase whose ceiling was sized for it.
        const phase = /withPhaseDeadline\('start_take', async \(\) => \{([\s\S]*?)\n {8}\}\);/.exec(spec);
        expect(phase, 'start_take must be an async phase body').not.toBeNull();
        expect(phase![1]).toMatch(/await authoritativeStart/);
    });

    it('CASUALTY: an UNGATED cold run is not capped at the config default', () => {
        const ungated = canaryTestTimeoutMs(false);
        expect(ungated).toBeGreaterThan(configDefaultMs);
        expect(ungated).toBe(PRODUCT_SMOKE_BUDGET_MS);
    });

    it('CASUALTY: maximum deployment polling cannot consume the product allowance', () => {
        const gated = canaryTestTimeoutMs(true);
        expect(gated - DEPLOY_WAIT_MS - DEPLOY_VERDICT_SLACK_MS).toBe(PRODUCT_SMOKE_BUDGET_MS);
        expect(gated).toBe(DEPLOY_WAIT_MS + DEPLOY_VERDICT_SLACK_MS + PRODUCT_SMOKE_BUDGET_MS);
    });

    it('CASUALTY: the deployment poll bounds its own navigation by the time remaining', () => {
        // PM RETURN finding 1: the elapsed check used to happen only AFTER an unbounded `page.goto`, so a
        // navigation begun near the ceiling could overrun it and spend the product allowance.
        expect(spec).toMatch(/page\.goto\(base, \{ waitUntil: 'domcontentloaded', timeout: Math\.max\(1, remainingMs\(\)\) \}\)/);
        expect(spec).toMatch(/while \(remainingMs\(\) > 0\)/);
        expect(spec, 'the poll sleep must be clamped to the remaining budget')
            .toMatch(/waitForTimeout\(Math\.max\(1, Math\.min\(DEPLOY_POLL_MS, remainingMs\(\)\)\)\)/);
        expect(spec, 'a deadline hit mid-navigation must still produce the deployment verdict')
            .toMatch(/if \(remainingMs\(\) > 0\) throw err;/);
    });

    it('CASUALTY: the canary-check JOB ceiling is read from that job, not the workflow maximum', () => {
        // PM RETURN finding 3: taking the max `timeout-minutes` anywhere let canary-check regress while an
        // unrelated job's larger ceiling kept the test green.
        const setupAllowanceMs = 4 * 60_000;   // checkout, install, provision
        expect(canaryCheckTimeoutMs).toBeGreaterThanOrEqual(canaryTestTimeoutMs(true) + setupAllowanceMs);
    });

    it('CASUALTY: the parser ignores a larger unrelated job, so a canary-check regression cannot hide', () => {
        const fixture = [
            'jobs:',
            '  migration-readiness:',
            '    timeout-minutes: 60',
            '  canary-check:',
            '    name: canary-check (lane)',
            '    timeout-minutes: 15',
            '  canary-result:',
            '    timeout-minutes: 90',
            '',
        ].join('\n');
        expect(parseJobTimeoutMs(fixture, 'canary-check')).toBe(15 * 60_000);
        expect(parseJobTimeoutMs(fixture, 'migration-readiness')).toBe(60 * 60_000);
        expect(parseJobTimeoutMs(fixture, 'no-such-job')).toBeNull();
        // The regression PM described, proven to fail the real assertion:
        expect(15 * 60_000).toBeLessThan(canaryTestTimeoutMs(true) + 4 * 60_000);
    });

    it('withPhaseDeadline fails with a NAMED phase error, and passes fast work through', async () => {
        await expect(withPhaseDeadline('recording_dwell', async () => 'done')).resolves.toBe('done');

        // Fake timers, so proving a 15s ceiling fires does not cost 15s of gate time on every run.
        vi.useFakeTimers();
        try {
            const budget = PHASE_BUDGETS_MS.recording_dwell;
            const slow = withPhaseDeadline('recording_dwell', () => new Promise((r) => setTimeout(r, budget + 5_000)));
            // Capture the settlement BEFORE advancing the clock, so the rejection is never unhandled.
            const settled = slow.then(() => null, (error: unknown) => error);
            await vi.advanceTimersByTimeAsync(budget + 1);
            const error = await settled;
            expect(error).toBeInstanceOf(CanaryPhaseTimeout);
            expect((error as CanaryPhaseTimeout).phase).toBe('recording_dwell');
            expect(String((error as Error).message)).toMatch(/CANARY_PHASE_TIMEOUT:recording_dwell/);
        } finally {
            vi.useRealTimers();
        }
    });

    it('withPhaseDeadline hands the phase its remaining time, which only decreases', async () => {
        await withPhaseDeadline('login', async ({ remainingMs }) => {
            const first = remainingMs();
            expect(first).toBeLessThanOrEqual(PHASE_BUDGETS_MS.login);
            await new Promise((r) => setTimeout(r, 25));
            expect(remainingMs()).toBeLessThan(first);
            expect(remainingMs()).toBeGreaterThan(0);
        });
    });

    it('the spec installs the ceiling unconditionally, through the derived helper', () => {
        expect(spec).toMatch(/test\.setTimeout\(canaryTestTimeoutMs\(deployGateIsArmed\(\)\)\)/);
        expect(spec, 'setTimeout must not be nested inside the deploy-gate branch')
            .not.toMatch(/if \(deployGateIsArmed\(\)\) \{\s*\n\s*test\.setTimeout/);
    });
});
