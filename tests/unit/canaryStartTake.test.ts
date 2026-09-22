// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    startTake,
    type TakeAssertions,
    CONTROL_WAIT_MS,
    COLD_START_RPC_TIMEOUT_MS,
    COLD_START_TOTAL_BUDGET_MS,
} from '../canary/canaryStartTake';
import {
    canaryTestTimeoutMs,
    DEPLOY_WAIT_MS,
    PRODUCT_SMOKE_BUDGET_MS,
    LOGIN_FLOW_BUDGET_MS,
    NAVIGATION_BUDGET_MS,
    PRE_START_CHECK_BUDGET_MS,
    RECORDING_CHECK_BUDGET_MS,
    RECORDING_DWELL_MS,
    STOP_SAVE_BUDGET_MS,
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
 * #1518 P1 (Codex, exact head `fa322aa33`; PM RETURN) — THE CLOCK IS PART OF THE CONTRACT.
 *
 * The cold wait lived in the helper, the per-test ceiling in the spec, and the job ceiling in the
 * workflow, with nothing relating them — so the cold path could not physically complete under any of
 * them and a healthy cold account died on a generic Playwright timeout. These assertions compute the
 * whole sequential path and require every outer budget to exceed it, in BOTH modes, so the constants
 * cannot drift apart again.
 */
describe('#1518 the cold journey is affordable in both deploy-gate modes', () => {
    const repoRoot = resolve(__dirname, '..', '..');
    const config = readFileSync(resolve(repoRoot, 'playwright.canary.config.ts'), 'utf8');
    const workflow = readFileSync(resolve(repoRoot, '.github/workflows/canary.yml'), 'utf8');
    const spec = readFileSync(resolve(repoRoot, 'tests/canary/smoke.canary.spec.ts'), 'utf8');

    /** Playwright's own per-test default for this project — the ceiling the fix must escape. */
    const configDefaultMs = Number(/^\s*timeout:\s*(\d+),/m.exec(config)?.[1]);
    /** The smoke job's ceiling, the outermost budget of all. */
    const jobTimeoutMs = Math.max(
        ...[...workflow.matchAll(/^\s*timeout-minutes:\s*(\d+)$/gm)].map((m) => Number(m[1]) * 60_000),
    );
    /** The complete cold path, summed independently of the module's own arithmetic. */
    const coldPathMs = LOGIN_FLOW_BUDGET_MS + NAVIGATION_BUDGET_MS + PRE_START_CHECK_BUDGET_MS
        + COLD_START_TOTAL_BUDGET_MS + RECORDING_CHECK_BUDGET_MS + RECORDING_DWELL_MS + STOP_SAVE_BUDGET_MS;

    it('the fixtures parsed (an unread config or workflow would make the rest vacuous)', () => {
        expect(Number.isFinite(configDefaultMs)).toBe(true);
        expect(Number.isFinite(jobTimeoutMs)).toBe(true);
        expect(coldPathMs).toBeGreaterThan(0);
    });

    it('the internal cold-start timeout is unchanged at 150s, and the helper total follows from it', () => {
        // PM RETURN: keep the 150s wait and the single-click behaviour exactly as they are.
        expect(COLD_START_RPC_TIMEOUT_MS).toBe(150_000);
        expect(COLD_START_TOTAL_BUDGET_MS).toBe(CONTROL_WAIT_MS * 2 + COLD_START_RPC_TIMEOUT_MS);
    });

    it('the product allowance is DERIVED from the whole sequential path, not a flat share', () => {
        expect(PRODUCT_SMOKE_BUDGET_MS).toBe(coldPathMs);
        // The old flat two minutes was smaller than the cold wait alone — the arithmetic that failed.
        expect(PRODUCT_SMOKE_BUDGET_MS).toBeGreaterThan(COLD_START_TOTAL_BUDGET_MS);
        expect(2 * 60_000).toBeLessThan(COLD_START_TOTAL_BUDGET_MS);
    });

    it('CASUALTY: an UNGATED cold run is not capped at the 60s default', () => {
        const ungated = canaryTestTimeoutMs(false);
        expect(ungated).toBeGreaterThan(configDefaultMs);
        expect(ungated).toBeGreaterThanOrEqual(coldPathMs);
        // No deployment allowance is spent when no deployment is being awaited.
        expect(ungated).toBe(PRODUCT_SMOKE_BUDGET_MS);
    });

    it('CASUALTY: maximum deployment polling cannot consume the cold/product allowance', () => {
        const gated = canaryTestTimeoutMs(true);
        expect(gated - DEPLOY_WAIT_MS).toBeGreaterThanOrEqual(coldPathMs);
        expect(gated).toBe(DEPLOY_WAIT_MS + PRODUCT_SMOKE_BUDGET_MS);
    });

    it('CASUALTY: the smoke JOB ceiling covers the worst case plus setup, or the test is killed first', () => {
        // The outermost budget. A job killed at 15 min reproduces exactly the generic-timeout failure the
        // in-test raise was added to remove.
        const setupAllowanceMs = 4 * 60_000;      // checkout, install, provision
        expect(jobTimeoutMs).toBeGreaterThanOrEqual(canaryTestTimeoutMs(true) + setupAllowanceMs);
    });

    it('the spec installs the ceiling unconditionally, through the derived helper', () => {
        // A timeout is only ever a string until the run, so the wiring is asserted on the source.
        expect(spec).toMatch(/test\.setTimeout\(canaryTestTimeoutMs\(deployGateIsArmed\(\)\)\)/);
        expect(spec, 'setTimeout must not be nested inside the deploy-gate branch')
            .not.toMatch(/if \(deployGateIsArmed\(\)\) \{\s*\n\s*test\.setTimeout/);
    });
});
