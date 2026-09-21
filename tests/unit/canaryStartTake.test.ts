// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { startTake, type TakeAssertions } from '../canary/canaryStartTake';

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
