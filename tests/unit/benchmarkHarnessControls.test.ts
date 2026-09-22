/* @vitest-environment jsdom */
// #1306 — BEHAVIORAL contract for the live desktop-journey helpers.
//
// WHY THIS EXISTS. The previous guard for this defect was a source scan: it checked that a selector
// string appeared somewhere in the repository. `session-start-stop-button` DOES appear — as a constant,
// referenced from MobileActionBar, which renders the SUFFIXED `-mobile` id. So the scan passed while
// the harness clicked a control that renders on no viewport, and attempt 5 spent 40 production minutes
// waiting for it without ever invoking model acquisition.
//
// A scan cannot qualify this proof. So these tests EXECUTE the real helper functions against a real
// (jsdom) DOM containing only the controls the product actually renders. If a helper asks for a
// control that does not exist in the state under test, it fails here — in milliseconds, for free —
// instead of during a production dispatch.
//
// Playwright's assertion library is replaced with a shim that understands the same matchers, because
// the subject under test is the helpers' SELECTOR CHOICE and CONTROL FLOW, not Playwright itself.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MIC_CONTROL_BY_STATUS, RECORDER_BAR, RECORDER_STOP, RETIRED_COMBINED_CONTROL } from '../helpers/micControls';

vi.mock('@playwright/test', () => {
    const isLocator = (v: unknown): v is FakeLocator =>
        !!v && typeof v === 'object' && (v as { __locator?: boolean }).__locator === true;

    const pwExpect = (actual: unknown, message?: string) => {
        if (isLocator(actual)) {
            const fail = (why: string) => { throw new Error(`${message ?? ''} ${why}`.trim()); };
            const node = () => document.querySelector(actual.selector);
            return {
                // A REAL `toBeVisible` WAITS. The synchronous check could only ever see the first
                // instant, so an asynchronous transition (`mic-start` disabled, then RecorderBar) was
                // untestable here and any fix for it would have been validated against a fake that
                // cannot express it. Polls on real timers, like Playwright, with a short deadline.
                toBeVisible: async () => {
                    const deadline = Date.now() + 1_000;
                    while (!node()) {
                        if (Date.now() > deadline) fail(`expected ${actual.selector} to be visible`);
                        await new Promise((r) => setTimeout(r, 5));
                    }
                },
                toBeEnabled: async () => {
                    const el = node();
                    if (!el) fail(`expected ${actual.selector} to exist`);
                    if (el!.hasAttribute('disabled')) fail(`expected ${actual.selector} to be enabled`);
                },
                toHaveCount: async (n: number) => {
                    const c = document.querySelectorAll(actual.selector).length;
                    if (c !== n) fail(`expected ${actual.selector} count ${n}, got ${c}`);
                },
                toHaveAttribute: async (attr: string, value: string) => {
                    const el = node();
                    if (!el) fail(`expected ${actual.selector} to exist to read ${attr}`);
                    if (el!.getAttribute(attr) !== value) fail(`expected ${attr}=${value}`);
                },
            };
        }
        if (typeof actual === 'function') {
            return {
                toPass: async () => {
                    // The fake DOM is deterministic, so one attempt is decisive.
                    await (actual as () => Promise<void>)();
                },
            };
        }
        // Value matchers are implemented here rather than delegated, because the matcher is chosen by
        // the CALLER: returning vitest's `expect(...)` from this position is indistinguishable from an
        // assertion with no matcher. These are the only forms the helpers under test use.
        const fail = (why: string) => { throw new Error(`${message ?? ''} ${why}`.trim()); };
        const shown = () => JSON.stringify(actual);
        return {
            toBe: (v: unknown) => { if (actual !== v) fail(`expected ${shown()} to be ${JSON.stringify(v)}`); },
            toMatch: (re: RegExp) => { if (!(typeof actual === 'string' && re.test(actual))) fail(`expected ${shown()} to match ${String(re)}`); },
            toContain: (v: unknown) => {
                const has = Array.isArray(actual) ? actual.includes(v)
                    : typeof actual === 'string' && typeof v === 'string' ? actual.includes(v) : false;
                if (!has) fail(`expected ${shown()} to contain ${JSON.stringify(v)}`);
            },
            toBeGreaterThan: (v: number) => {
                if (!(typeof actual === 'number' && actual > v)) fail(`expected ${shown()} > ${v}`);
            },
            toBeGreaterThanOrEqual: (v: number) => {
                if (!(typeof actual === 'number' && actual >= v)) fail(`expected ${shown()} >= ${v}`);
            },
            not: {
                toBe: (v: unknown) => { if (actual === v) fail(`expected ${shown()} not to be ${JSON.stringify(v)}`); },
                toContain: (v: unknown) => {
                    const has = Array.isArray(actual) && actual.includes(v);
                    if (has) fail(`expected ${shown()} not to contain ${JSON.stringify(v)}`);
                },
            },
        };
    };
    return { expect: pwExpect };
});

// Transcript-surface helpers are exercised in benchmarkHarnessSurface.test.tsx, which mounts the REAL
// SessionDuringState rather than hand-written markup. This file covers the mic/recorder controls.
const { preparePrivateModelIfPrompted, expectMicControlForState, expectBenchmarkRecordingStarted, stopBenchmarkRecording, startBenchmarkRecording, assertPreStartMode } =
    await import('../live/helpers/benchmark-utils');

interface FakeLocator {
    __locator: true;
    selector: string;
    count(): Promise<number>;
    isVisible(): Promise<boolean>;
    click(): Promise<void>;
    scrollIntoViewIfNeeded(): Promise<void>;
    textContent(): Promise<string | null>;
    getAttribute(name: string): Promise<string | null>;
    /** Playwright's locator union / index, as the helpers use them. */
    or(other: FakeLocator): FakeLocator;
    first(): FakeLocator;
}

/** Every testid the helper asked for, and every one it clicked — the two things that broke. */
const asked: string[] = [];
const clicked: string[] = [];
/** Applied to `data-model-status` when the acquisition CTA is clicked; null = the CTA does nothing. */
let onDownloadClick: string | null = 'ready';
/**
 * #1416 — THE COLD PRESS RECORDS, AND THIS FAKE USED TO DENY IT.
 *
 * `onDownloadClick = 'ready'` alone models the PRE-#1416 product: press the gate, get a ready
 * `mic-start`. That is not what ships. The cold press is one activation that consents, downloads AND
 * records, so acquisition completing resumes the held intent, `SessionDuringState` replaces `MicCard`,
 * and `mic-start` stops existing.
 *
 * Because the fake denied it, the helper's assertion that `mic-start` is rendered after setup passed
 * here and failed on Production — the same shape as `useSessionLifecycle.test.tsx` pinning the
 * cold-start defect as correct behaviour. A fix validated against this fake would have been validated
 * against a product that no longer exists.
 */
let coldPressRecords = true;
/**
 * Consultant condition on `76876df3` — THE GAP BETWEEN `ready` AND THE RECORDER.
 *
 * `'sync'` renders the recorder inside the click handler, so any snapshot taken afterwards always sees
 * it: the timing gap cannot exist. The canary artifact showed the other shape — `mic-start` RENDERED
 * BUT DISABLED while the engine starts, replaced by `SessionDuringState` a tick later. `'disabled-then-
 * recording'` models that, which is the only way a snapshot-based setup can be shown to break and a
 * terminal-outcome wait to hold.
 */
let coldPressTiming: 'sync' | 'disabled-then-recording' = 'sync';

const locatorFor = (selector: string): FakeLocator => ({
    __locator: true,
    selector,
    count: async () => document.querySelectorAll(selector).length,
    isVisible: async () => !!document.querySelector(selector),
    scrollIntoViewIfNeeded: async () => undefined,
    textContent: async () => document.querySelector(selector)?.textContent ?? null,
    getAttribute: async (name) => document.querySelector(selector)?.getAttribute(name) ?? null,
    // A CSS union matches either shape, and `querySelector` returns the first in document order —
    // which is what `.or(...).first()` means for these helpers.
    or: (other: FakeLocator) => locatorFor(`${selector}, ${other.selector}`),
    first: () => locatorFor(selector),
    click: async () => {
        const el = document.querySelector(selector);
        if (!el) throw new Error(`click on a control that does not exist: ${selector}`);
        clicked.push(selector);
        el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        if (selector.includes(MIC_CONTROL_BY_STATUS['download-required']) && onDownloadClick) {
            // Acquisition completing re-renders the card into the next state's control, as in the app.
            renderState(onDownloadClick);
            // ...and then the held recording intent resumes, replacing the card entirely (#1416).
            if (coldPressRecords && onDownloadClick === 'ready') {
                if (coldPressTiming === 'sync') {
                    renderRecording();
                } else {
                    // `ready` is reached with the start control present but DISABLED, and the recorder
                    // replaces it only on a later tick.
                    document.body.innerHTML =
                        `<button data-testid="${MIC_CONTROL_BY_STATUS.ready}" disabled>c</button>`;
                    setTimeout(renderRecording, 25);
                }
            }
        }
    },
});

const page = {
    url: () => 'https://example.test/session',
    evaluate: async (fn: (arg?: unknown) => unknown, arg?: unknown) => fn(arg),
    locator: (selector: string) => { asked.push(selector); return locatorFor(selector); },
    getByTestId: (id: string) => { asked.push(id); return locatorFor(`[data-testid="${id}"]`); },
    getByLabel: (re: RegExp) => locatorFor(`[aria-label-re="${String(re)}"]`),
} as unknown as Parameters<typeof preparePrivateModelIfPrompted>[0];

/** Render only what the product renders in `status`. Nothing else exists — as on a real page. */
function renderState(status: string) {
    document.documentElement.setAttribute('data-model-status', status);
    const control = status === 'loading' ? 'mic-start' : MIC_CONTROL_BY_STATUS[status as keyof typeof MIC_CONTROL_BY_STATUS];
    document.body.innerHTML = control
        ? `<button data-testid="${control}"${status === 'loading' ? ' disabled' : ''}>c</button>`
        : '';
}

function renderRecording() {
    document.documentElement.setAttribute('data-recording-state', 'recording');
    document.body.innerHTML =
        `<div data-testid="${RECORDER_BAR}"><button data-testid="${RECORDER_STOP}">Stop</button></div>`;
}

beforeEach(() => {
    asked.length = 0; clicked.length = 0; onDownloadClick = 'ready'; coldPressRecords = true;
    coldPressTiming = 'sync';
    document.documentElement.removeAttribute('data-recording-state');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('acquisition drives the state-specific CTA', () => {
    it('clicks mic-download in download-required and never the retired combined control', async () => {
        renderState('download-required');
        const { recordingAlreadyStarted } = await preparePrivateModelIfPrompted(page, 5_000);
        expect(clicked).toContain(`[data-testid="${MIC_CONTROL_BY_STATUS['download-required']}"]`);
        expect(asked.join(' '), 'the retired control must never be requested')
            .not.toContain(RETIRED_COMBINED_CONTROL);
        expect(document.documentElement.getAttribute('data-model-status')).toBe('ready');
        // #1416: that one press also started the take, and setup must SAY so rather than deny it.
        expect(recordingAlreadyStarted, 'the cold press starts the take').toBe(true);
    });

    /**
     * CASUALTY — the failure the retention proof would have spent a paid Production run to rediscover.
     * Setup must not assert a control that recording has correctly removed.
     */
    it('CASUALTY: setup SUCCEEDS when the cold press has already started the take', async () => {
        renderState('download-required');
        await expect(preparePrivateModelIfPrompted(page, 5_000)).resolves.toEqual({ recordingAlreadyStarted: true });
        expect(document.querySelector(`[data-testid="${RECORDER_STOP}"]`), 'the recorder is up').not.toBeNull();
        expect(document.querySelector(`[data-testid="mic-start"]`), 'mic-start is correctly gone').toBeNull();
    });

    /**
     * CASUALTY — Consultant condition on `76876df3`. THE SNAPSHOT VERSION FAILS HERE.
     *
     * Production reaches `ready` with `mic-start` rendered but DISABLED, and replaces it with the
     * recorder a tick later. A setup that takes ONE snapshot at `ready` sees no recorder, falls into
     * `expectMicControlForState`, and waits for a control that goes disabled and then disappears —
     * `CONTROL_NOT_RENDERED`, intermittent, discovered on the PAID proof. Waiting for a terminal
     * outcome (running take OR enabled start) settles it either way.
     */
    it('CASUALTY: setup waits through a disabled mic-start and reports the take that follows it', async () => {
        coldPressTiming = 'disabled-then-recording';
        renderState('download-required');
        await expect(preparePrivateModelIfPrompted(page, 5_000)).resolves.toEqual({ recordingAlreadyStarted: true });
        expect(document.querySelector(`[data-testid="${RECORDER_STOP}"]`), 'the recorder replaced the card').not.toBeNull();
        expect(document.querySelector('[data-testid="mic-start"]'), 'the disabled start control is gone').toBeNull();
    });

    /**
     * PM RETURN on `b0695d14a` (P1). This test used to PIN THE DEFECT: "a cold press that does NOT record
     * still ends setup on a rendered mic-start". The cold press is ONE activation that downloads AND
     * starts the take, so an enabled idle Start after it is a failed automatic resume — and reporting
     * `recordingAlreadyStarted: false` let the consumer press Start a second time and turn a product
     * regression into a passing paid proof.
     */
    it('CASUALTY: a cold press that reaches ready but never records FAILS — one download click, no Start click', async () => {
        coldPressRecords = false;
        renderState('download-required');
        await expect(preparePrivateModelIfPrompted(page, 5_000)).rejects.toThrow(/COLD_START_DID_NOT_RECORD/);
        const downloadClicks = clicked.filter((c) => c.includes(MIC_CONTROL_BY_STATUS['download-required']));
        const startClicks = clicked.filter((c) => c.includes(MIC_CONTROL_BY_STATUS.ready));
        expect({ downloadClicks: downloadClicks.length, startClicks: startClicks.length, total: clicked.length })
            .toEqual({ downloadClicks: 1, startClicks: 0, total: 1 });
    });

    it('CASUALTY: a consumer cannot reach a second press after a failed cold start (zero second session)', async () => {
        // The migrated consumer shape: setup, then the recording-aware start. The failed resume must stop
        // the journey inside setup, so the start helper never gets the chance to press an idle Start.
        coldPressRecords = false;
        renderState('download-required');
        const journey = async () => {
            await preparePrivateModelIfPrompted(page, 5_000);
            await startBenchmarkRecording(page, 'consumer');
        };
        await expect(journey()).rejects.toThrow(/COLD_START_DID_NOT_RECORD/);
        expect(clicked.filter((c) => c.includes(MIC_CONTROL_BY_STATUS.ready)), 'no session-starting press').toEqual([]);
        expect(document.querySelector(`[data-testid="${RECORDER_STOP}"]`), 'no take was started by the harness').toBeNull();
    });

    it('CONTROL: a cold auto-start succeeds with exactly one click', async () => {
        renderState('download-required');
        await expect(preparePrivateModelIfPrompted(page, 5_000)).resolves.toEqual({ recordingAlreadyStarted: true });
        expect(clicked.length, `one activation only, got ${JSON.stringify(clicked)}`).toBe(1);
        await startBenchmarkRecording(page, 'consumer');
        expect(clicked.length, 'the start helper leaves the running take alone').toBe(1);
    });

    it('CONTROL: a warm enabled Start is activated once, by the start helper', async () => {
        renderState('ready');
        await expect(preparePrivateModelIfPrompted(page, 5_000)).resolves.toEqual({ recordingAlreadyStarted: false });
        expect(clicked, 'warm setup clicks nothing').toEqual([]);
        await startBenchmarkRecording(page, 'consumer');
        expect(clicked.filter((c) => c.includes(MIC_CONTROL_BY_STATUS.ready)).length, 'exactly one Start press').toBe(1);
    });

    it('FALSIFICATION: a page rendering only the retired control fails in seconds, not minutes', async () => {
        // This is attempt 5 exactly: the state is download-required and the harness's control is absent.
        document.documentElement.setAttribute('data-model-status', 'download-required');
        document.body.innerHTML = `<button data-testid="${RETIRED_COMBINED_CONTROL}">c</button>`;
        await expect(preparePrivateModelIfPrompted(page, 5_000)).rejects.toThrow(/CTA_NOT_RENDERED/);
        expect(clicked, 'nothing may be clicked when the real CTA is absent').toEqual([]);
    });

    it('a CTA that does not move the state FAILS — the "button does nothing" outcome', async () => {
        renderState('download-required');
        onDownloadClick = null;
        await expect(preparePrivateModelIfPrompted(page, 5_000)).rejects.toThrow(/must leave download-required/);
    });

    it('a warm cache skips setup without clicking anything, and reports no take running', async () => {
        renderState('ready');
        await expect(preparePrivateModelIfPrompted(page, 5_000)).resolves.toEqual({ recordingAlreadyStarted: false });
        expect(clicked).toEqual([]);
    });
});

describe('every desktop state resolves to its own rendered control', () => {
    it.each(Object.entries(MIC_CONTROL_BY_STATUS))('%s -> %s', async (status, control) => {
        renderState(status);
        await expectMicControlForState(page, status);
        expect(asked).toContain(control);
    });

    it('FALSIFICATION: substituting the mobile control for the desktop journey fails', async () => {
        document.documentElement.setAttribute('data-model-status', 'ready');
        document.body.innerHTML = `<button data-testid="${RETIRED_COMBINED_CONTROL}-mobile">c</button>`;
        await expect(expectMicControlForState(page, 'ready')).rejects.toThrow(/CONTROL_NOT_RENDERED/);
    });
});

describe('recording is proven through rendered state, not a dead attribute', () => {
    it('accepts the recorder bar + stop control and rejects a still-showing start control', async () => {
        renderRecording();
        await expectBenchmarkRecordingStarted(page, 'r1');
        expect(asked).toContain(RECORDER_BAR);
        expect(asked).toContain(RECORDER_STOP);
    });

    it('FALSIFICATION: the old start control still on screen is NOT a recording page', async () => {
        renderRecording();
        document.body.insertAdjacentHTML('beforeend', '<button data-testid="mic-start">c</button>');
        await expect(expectBenchmarkRecordingStarted(page, 'r1')).rejects.toThrow(/recording precondition failed/);
    });

    it('FALSIFICATION: a page with only the retired control never counts as recording', async () => {
        document.body.innerHTML = `<button data-testid="${RETIRED_COMBINED_CONTROL}" data-recording="true">c</button>`;
        await expect(expectBenchmarkRecordingStarted(page, 'r1')).rejects.toThrow(/recording precondition failed/);
    });

    it('stop clicks recorder-stop and requires the recorder to DISAPPEAR', async () => {
        renderRecording();
        // Stopping unmounts the recorder, which is why asserting an attribute on it cannot work.
        document.querySelector(`[data-testid="${RECORDER_STOP}"]`)!
            .addEventListener('click', () => { document.body.innerHTML = '<button data-testid="mic-start">c</button>'; });
        await stopBenchmarkRecording(page, 'r1', 5_000);
        expect(clicked).toContain(`[data-testid="${RECORDER_STOP}"]`);
        expect(document.querySelector(`[data-testid="${RECORDER_BAR}"]`)).toBeNull();
    });

    it('FALSIFICATION: a recorder that never disappears fails the stop assertion', async () => {
        renderRecording();
        await expect(stopBenchmarkRecording(page, 'r1', 5_000)).rejects.toThrow(/stop precondition failed/);
    });
});

/**
 * #1416 — NO SECOND TAKE. A cold setup press already started the recording, so the shared start helper
 * must refuse to press anything. A second press writes a SECOND session row, which corrupts exactly the
 * count the three-session retention proof exists to measure — on a paid Production run.
 */
describe('startBenchmarkRecording never starts a second take', () => {
    it('CASUALTY: with the recorder already up it presses nothing and succeeds', async () => {
        renderRecording();
        await expect(startBenchmarkRecording(page, 'cold-take')).resolves.toBeUndefined();
        expect(clicked, 'no control may be pressed while a take is running').toEqual([]);
    });

    it('still starts the take normally when nothing is recording', async () => {
        renderState('ready');
        await startBenchmarkRecording(page, 'warm-take');
        expect(clicked).toEqual([`[data-testid="mic-start"]`]);
    });

    it('END TO END: cold setup starts the take, and the start helper leaves it alone', async () => {
        renderState('download-required');
        const { recordingAlreadyStarted } = await preparePrivateModelIfPrompted(page, 5_000);
        expect(recordingAlreadyStarted).toBe(true);
        const pressesAfterSetup = clicked.length;
        await startBenchmarkRecording(page, 'cold-take');
        expect(clicked.length, 'exactly one press across setup AND start').toBe(pressesAfterSetup);
        expect(clicked).toHaveLength(1);
    });
});

/**
 * #1519 P1 (Codex + PM RETURN on 85d30695) — THE HELPER BEING RIGHT IS NOT THE CALLERS BEING RIGHT.
 *
 * Every test above executes the helpers, because the question there is whether a control EXISTS in the
 * state under test, and a source scan cannot answer that (see this file's header). The question here is
 * different and genuinely structural: do the cold-setup consumers DELEGATE their start to the helper, or
 * do they resolve and press a control themselves? That is a property of the source, so the source is the
 * right instrument — the same reasoning as #1518's stale-behaviour guard.
 *
 * It matters because setup may return with the take already running. A caller that then demands a
 * ready-state control fails on a healthy cold account, and one that presses anyway writes a SECOND
 * session row — corrupting exactly the count the three-session retention proof exists to measure, on a
 * paid Production run.
 *
 * SCOPE IS DERIVED, NOT LISTED: every spec that imports `preparePrivateModelIfPrompted` is a consumer of
 * cold setup, so a consumer added later is covered without anyone remembering to add it here.
 *
 * KNOWN EXCLUSION, stated rather than silently skipped: `tester-b-private-native-stt.live.spec.ts` still
 * presses the retired combined control, as do the two analytics specs. That was declared out of scope by
 * the change under test and is tracked separately; it is excluded here by name so the gap stays visible
 * instead of being hidden by a guard that quietly passes.
 */
describe('#1519 Codex P1 on 1e5420e8: the pre-start mode check knows the cold press may be the take', () => {
    // `assertPreStartMode` demanded READY|IDLE unconditionally. Both production proofs call it right
    // after `preparePrivateModelIfPrompted`, which on a cold account returns with the take RECORDING —
    // so the proof polled for 15 s and failed before ever reaching the recording-aware start.
    const runtimeFor = (preferred: string) => {
        (window as unknown as { __SPEECH_RUNTIME_DEBUG__?: () => unknown }).__SPEECH_RUNTIME_DEBUG__ =
            () => ({ controllerPreferredMode: preferred, policy: { preferredMode: preferred } });
    };
    const at = (runtimeState: string, preferred = 'private') => {
        document.documentElement.setAttribute('data-runtime-state', runtimeState);
        runtimeFor(preferred);
    };

    it('CASUALTY: after a cold press that started the take, the running take passes the mode check', async () => {
        at('RECORDING');
        await expect(assertPreStartMode(page, 'private', { takeAlreadyRunning: true })).resolves.toBeUndefined();
    });

    it('END TO END: the setup result is what tells the check a take is running', async () => {
        renderState('download-required');
        document.documentElement.setAttribute('data-runtime-state', 'READY');
        runtimeFor('private');
        const setup = await preparePrivateModelIfPrompted(page, 5_000);
        document.documentElement.setAttribute('data-runtime-state', 'RECORDING');
        expect(setup.recordingAlreadyStarted).toBe(true);
        await expect(assertPreStartMode(page, 'private', { takeAlreadyRunning: setup.recordingAlreadyStarted })).resolves.toBeUndefined();
    });

    it('CONTROL: with no take running, only READY or IDLE is a pre-start state', async () => {
        at('READY');
        await expect(assertPreStartMode(page, 'private')).resolves.toBeUndefined();
        at('RECORDING');
        await expect(assertPreStartMode(page, 'private')).rejects.toThrow(/PRE_START_MODE_STATE failed/);
    });

    it('FALSIFICATION: a take that setup claims but the runtime does not show is refused', async () => {
        at('READY');
        await expect(assertPreStartMode(page, 'private', { takeAlreadyRunning: true })).rejects.toThrow(/PRE_START_MODE_STATE failed/);
    });

    it('FALSIFICATION: the mode is still enforced while the take runs', async () => {
        at('RECORDING', 'native');
        await expect(assertPreStartMode(page, 'private', { takeAlreadyRunning: true })).rejects.toThrow(/PRE_START_MODE_STATE failed/);
    });
});

describe('#1519 every cold-setup consumer delegates its start to the recording-aware helper', () => {
    const repoRoot = resolve(__dirname, '..', '..');
    const EXCLUDED = ['tester-b-private-native-stt.live.spec.ts'];

    const consumers = readdirSync(resolve(repoRoot, 'tests/live'))
        .filter((f) => f.endsWith('.spec.ts'))
        .filter((f) => !EXCLUDED.includes(f))
        .map((f) => ({ file: f, src: readFileSync(resolve(repoRoot, 'tests/live', f), 'utf8') }))
        .filter(({ src }) => src.includes('preparePrivateModelIfPrompted'));

    it('the scope actually resolved (an empty sweep would make every assertion below vacuous)', () => {
        expect(consumers.length).toBeGreaterThanOrEqual(6);
        expect(consumers.map((c) => c.file)).toContain('three-session-retention-proof.live.spec.ts');
        expect(consumers.map((c) => c.file)).toContain('benchmark-cpu.live.spec.ts');
        expect(consumers.map((c) => c.file)).toContain('benchmark-v4.live.spec.ts');
    });

    it('CASUALTY: none of them presses the retired combined control', () => {
        // FORBID THE CALL, PERMIT THE MENTION. A substring guard fails on the comments that explain WHY
        // the control is retired — which is how a guard teaches its next reader to delete the
        // explanation instead of the defect (Consultant, #1518). So this matches the SELECTOR FORMS a
        // press actually goes through, and says nothing about prose.
        const selectorForms = [
            new RegExp(`getByTestId\\(\\s*['"\`]${RETIRED_COMBINED_CONTROL}['"\`]`),
            new RegExp(`data-testid=\\\\?["']${RETIRED_COMBINED_CONTROL}`),
            new RegExp(`locator\\([^)]*${RETIRED_COMBINED_CONTROL}`),
        ];
        for (const { file, src } of consumers) {
            for (const form of selectorForms) {
                expect(form.test(src), `${file} selects ${RETIRED_COMBINED_CONTROL}, which renders on no viewport`).toBe(false);
            }
        }
    });

    it('the mention/press distinction holds in both directions', () => {
        // A doc comment naming the retired control passes; either press form fails. Without this, the
        // guard above could be satisfied by a regex that matches nothing at all.
        const pressForms = [
            `await page.getByTestId('${RETIRED_COMBINED_CONTROL}').click();`,
            `page.locator('[data-testid="${RETIRED_COMBINED_CONTROL}"]').first().click();`,
        ];
        const mention = `// ${RETIRED_COMBINED_CONTROL} is the retired combined toggle and renders nowhere.`;
        const forms = [
            new RegExp(`getByTestId\\(\\s*['"\`]${RETIRED_COMBINED_CONTROL}['"\`]`),
            new RegExp(`data-testid=\\\\?["']${RETIRED_COMBINED_CONTROL}`),
            new RegExp(`locator\\([^)]*${RETIRED_COMBINED_CONTROL}`),
        ];
        for (const press of pressForms) {
            expect(forms.some((f) => f.test(press)), `a press must be caught: ${press}`).toBe(true);
        }
        expect(forms.some((f) => f.test(mention)), 'a doc mention must be permitted').toBe(false);
    });

    it('CASUALTY: none of them resolves and clicks its own start control after setup', () => {
        // The exact shape that fails on a cold account: ask for the `ready` control, then click it.
        const selfResolvedStart = /expectMicControlForState\(\s*page\s*,\s*'ready'\s*\)/;
        for (const { file, src } of consumers) {
            expect(selfResolvedStart.test(src), `${file} must start through startBenchmarkRecording`).toBe(false);
        }
    });

    it('CASUALTY (Codex P1 on 1e5420e8): a pre-start check after setup is told whether the take is running', () => {
        const bareCheck = /assertPreStartMode\(\s*page\s*,\s*'private'\s*\)/;
        const checked = consumers.filter(({ src }) => src.includes('assertPreStartMode('));
        expect(checked.map((c) => c.file)).toContain('three-session-retention-proof.live.spec.ts');
        expect(checked.map((c) => c.file)).toContain('private-recording-proof.live.spec.ts');
        for (const { file, src } of checked) {
            expect(bareCheck.test(src), `${file} checks pre-start state after a cold setup without passing the setup result`).toBe(false);
        }
    });

    it('every consumer that starts a take does so through the helper', () => {
        for (const { file, src } of consumers) {
            const startsATake = src.includes('expectBenchmarkRecordingStarted') || src.includes('stopBenchmarkRecording');
            if (!startsATake) continue;
            expect(src, `${file} starts a take, so it must call startBenchmarkRecording`)
                .toContain('startBenchmarkRecording(');
        }
    });
});
