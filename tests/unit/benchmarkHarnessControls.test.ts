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
import {
    MIC_CONTROL_BY_STATUS, RECORDER_BAR, RECORDER_STOP, RETIRED_COMBINED_CONTROL,
    TRANSCRIPT_CONTAINER, TRANSCRIPT_TEXT_ONLY, DRAFT_CURRENT_LINE, DRAFT_SETTLED,
} from '../helpers/micControls';

vi.mock('@playwright/test', () => {
    const isLocator = (v: unknown): v is FakeLocator =>
        !!v && typeof v === 'object' && (v as { __locator?: boolean }).__locator === true;

    const pwExpect = (actual: unknown, message?: string) => {
        if (isLocator(actual)) {
            const fail = (why: string) => { throw new Error(`${message ?? ''} ${why}`.trim()); };
            const node = () => document.querySelector(actual.selector);
            return {
                toBeVisible: async () => { if (!node()) fail(`expected ${actual.selector} to be visible`); },
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

const {
    preparePrivateModelIfPrompted, expectMicControlForState, expectBenchmarkRecordingStarted,
    stopBenchmarkRecording, expectBenchmarkDraftActivity, expectFinalizedTranscriptOutput,
    captureTranscriptSurfaceDiagnostics,
} = await import('../live/helpers/benchmark-utils');

interface FakeLocator {
    __locator: true;
    selector: string;
    count(): Promise<number>;
    isVisible(): Promise<boolean>;
    click(): Promise<void>;
    scrollIntoViewIfNeeded(): Promise<void>;
    textContent(): Promise<string | null>;
    getAttribute(name: string): Promise<string | null>;
}

/** Every testid the helper asked for, and every one it clicked — the two things that broke. */
const asked: string[] = [];
const clicked: string[] = [];
/** Applied to `data-model-status` when the acquisition CTA is clicked; null = the CTA does nothing. */
let onDownloadClick: string | null = 'ready';

const locatorFor = (selector: string): FakeLocator => ({
    __locator: true,
    selector,
    count: async () => document.querySelectorAll(selector).length,
    isVisible: async () => !!document.querySelector(selector),
    scrollIntoViewIfNeeded: async () => undefined,
    textContent: async () => document.querySelector(selector)?.textContent ?? null,
    getAttribute: async (name) => document.querySelector(selector)?.getAttribute(name) ?? null,
    click: async () => {
        const el = document.querySelector(selector);
        if (!el) throw new Error(`click on a control that does not exist: ${selector}`);
        clicked.push(selector);
        el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        if (selector.includes(MIC_CONTROL_BY_STATUS['download-required']) && onDownloadClick) {
            // Acquisition completing re-renders the card into the next state's control, as in the app.
            renderState(onDownloadClick);
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
    asked.length = 0; clicked.length = 0; onDownloadClick = 'ready';
    document.documentElement.removeAttribute('data-recording-state');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('acquisition drives the state-specific CTA', () => {
    it('clicks mic-download in download-required and never the retired combined control', async () => {
        renderState('download-required');
        await preparePrivateModelIfPrompted(page, 5_000);
        expect(clicked).toContain(`[data-testid="${MIC_CONTROL_BY_STATUS['download-required']}"]`);
        expect(asked.join(' '), 'the retired control must never be requested')
            .not.toContain(RETIRED_COMBINED_CONTROL);
        expect(document.documentElement.getAttribute('data-model-status')).toBe('ready');
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

    it('a warm cache skips setup without clicking anything', async () => {
        renderState('ready');
        await preparePrivateModelIfPrompted(page, 5_000);
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
 * THE TRANSCRIPT PHASE CONTRACT.
 *
 * Attempt 6 failed with a live page showing 122 draft words, because the proof demanded COMMITTED
 * output while recording. The UI says "Draft text in progress — finalized when you stop": committed
 * text is empty by design until Stop. These render the real LiveTranscriptPanel shape and prove the
 * assertion is now split by lifecycle phase.
 */
function renderLiveTranscript({ draft = '', settled = '', committed = '', state = 'listening' } = {}) {
    document.body.innerHTML = `
        <div data-testid="transcript-panel">
          <span data-testid="${TRANSCRIPT_TEXT_ONLY}" data-transcript-text-only="${committed}">${committed}</span>
          <div data-testid="${TRANSCRIPT_CONTAINER}" data-transcript-state="${state}">
            ${settled ? `<span data-testid="${DRAFT_SETTLED}" data-transcript-settled="true">${settled}</span>` : ''}
            ${draft ? `<span data-testid="${DRAFT_CURRENT_LINE}" data-transcript-draft="true">${draft}</span>` : ''}
          </div>
        </div>`;
}

const DRAFT_TEXT = 'Basically we should literally like wait um';

describe('transcript phase contract — draft during recording, finalized after stop', () => {
    it('interim-only draft text on the visible surface SATISFIES the during-recording assertion', async () => {
        // Committed is deliberately EMPTY — exactly the state attempt 6 hit.
        renderLiveTranscript({ draft: DRAFT_TEXT, committed: '' });
        await expectBenchmarkDraftActivity(page, 'r1', 2_000);
        const d = await captureTranscriptSurfaceDiagnostics(page);
        expect(d.committed.textOnlyLength, 'committed must be empty in this state').toBe(0);
        expect(d.draft.currentLineLength).toBeGreaterThan(0);
    });

    it('committed output is NOT required before Stop — an empty committed surface still passes', async () => {
        renderLiveTranscript({ settled: DRAFT_TEXT, committed: '' });
        await expect(expectBenchmarkDraftActivity(page, 'r1', 2_000)).resolves.toBeUndefined();
    });

    it('FALSIFICATION: a genuinely silent surface fails, so the assertion is not vacuous', async () => {
        renderLiveTranscript({ draft: '', settled: '', committed: '' });
        await expect(expectBenchmarkDraftActivity(page, 'r1', 1_000))
            .rejects.toThrow(/Draft-activity precondition failed/);
    });

    it('FALSIFICATION: reading the COMMITTED surface mid-recording would fail — the retracted fix', async () => {
        // Swapping transcript-container for transcript-text-only was the change I proposed and it
        // would have asserted on a surface that is empty by design. This pins that it is wrong.
        renderLiveTranscript({ draft: DRAFT_TEXT, committed: '' });
        const d = await captureTranscriptSurfaceDiagnostics(page);
        expect(d.committed.textOnlyLength).toBe(0);
        expect(d.container.textContentLength).toBeGreaterThan(0);
    });

    it('finalized output IS required after Stop', async () => {
        renderLiveTranscript({ committed: DRAFT_TEXT, state: 'final' });
        await expect(expectFinalizedTranscriptOutput(page, 'r1', { meaningfulWordCount: 42, selectedForSaveLength: 210 }, 3))
            .resolves.toBeUndefined();
    });

    it('FALSIFICATION: a finalized transcript with too few words fails after Stop', async () => {
        renderLiveTranscript({ committed: '', state: 'final' });
        await expect(expectFinalizedTranscriptOutput(page, 'r1', { meaningfulWordCount: 1, selectedForSaveLength: 6 }, 3))
            .rejects.toThrow(/selected-for-save transcript has 1 meaningful words/);
    });

    it('FAILS CLOSED: a save candidate exposing neither count nor length is unverifiable, not a pass', async () => {
        renderLiveTranscript({ committed: '', state: 'final' });
        await expect(expectFinalizedTranscriptOutput(page, 'r1', {}, 3))
            .rejects.toThrow(/NEITHER a word count NOR a length/);
    });

    it('FAILS CLOSED: an unreadable surface propagates instead of reporting zeros', async () => {
        const broken = { ...page, evaluate: async () => { throw new Error('surface unreadable'); } } as typeof page;
        await expect(captureTranscriptSurfaceDiagnostics(broken)).rejects.toThrow(/surface unreadable/);
    });

    it('diagnostics are PRIVACY-SAFE — shapes only, never transcript content', async () => {
        const secret = 'Basically we should literally like wait um';
        renderLiveTranscript({ draft: secret, committed: secret });
        const serialized = JSON.stringify(await captureTranscriptSurfaceDiagnostics(page));
        expect(serialized, 'no transcript content may appear in diagnostics').not.toContain('Basically');
        expect(serialized).not.toContain('literally');
        // ...while still carrying the shape needed to diagnose the empty-read defect.
        for (const key of ['counts', 'isConnected', 'childElementCount', 'textContentLength',
                           'innerTextLength', 'transcriptState', 'currentLineLength', 'textOnlyLength']) {
            expect(serialized, `${key} must be recorded`).toContain(key);
        }
    });

    it('duplicate-or-missing container is visible in the counts, not silently collapsed', async () => {
        renderLiveTranscript({ draft: DRAFT_TEXT });
        expect((await captureTranscriptSurfaceDiagnostics(page)).counts[TRANSCRIPT_CONTAINER]).toBe(1);
        document.body.innerHTML = '';
        const empty = await captureTranscriptSurfaceDiagnostics(page);
        expect(empty.counts[TRANSCRIPT_CONTAINER]).toBe(0);
        expect(empty.container.found).toBe(false);
        // Absent is reported as null, never as a flattering 0.
        expect(empty.container.textContentLength).toBeNull();
    });
});
