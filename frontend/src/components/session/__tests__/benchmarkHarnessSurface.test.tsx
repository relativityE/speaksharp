/* @vitest-environment jsdom */
// #1306 — the live-proof transcript helpers, exercised against the REAL rendered during state.
//
// WHY THIS FILE REPLACES THE FAKE-DOM VERSION. The previous test hand-wrote markup shaped like
// `LiveTranscriptPanel` and called it "the real LiveTranscriptPanel shape". The product does not mount
// that component at all — it has no production import. So the helper was validated against a fiction
// that happened to match its own assumptions, and attempt 7 then reported five zero counts which I
// misread as "the transcript panel unmounted". Nothing had unmounted; I had asked about a component
// that is never rendered.
//
// The only way a harness test can be evidence is if it drives the component the product actually
// renders. This mounts SessionDuringState — SessionPage -> SessionOverhaulView -> SessionDuringState —
// and runs the real helper functions against that DOM.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '../../../../tests/support/test-utils';
import { SessionDuringState } from '../SessionDuringState';
import { computeProgressVsBaseline } from '@/utils/progressVsBaseline';
import {
    DURING_STATE_LANDMARKS, RETIRED_TRANSCRIPT_IDS, LIVE_TRANSCRIPT, TRANSCRIPT_HEADER_META,
    parseHeaderMetaWords,
} from '../../../../../tests/helpers/micControls';

vi.mock('@playwright/test', () => {
    const pwExpect = (actual: unknown, message?: string) => {
        const fail = (why: string) => { throw new Error(`${message ?? ''} ${why}`.trim()); };
        // `expect(async () => {...}).toPass({...})` — the retry form the helpers use. The DOM is static
        // per test, so one attempt is decisive; omitting this made every call throw a TypeError that the
        // helper's own catch flattened into a generic message, hiding what actually failed.
        if (typeof actual === 'function') {
            return { toPass: async () => { await (actual as () => Promise<void>)(); } } as never;
        }
        const shown = () => JSON.stringify(actual);
        return {
            toBe: (v: unknown) => { if (actual !== v) fail(`expected ${shown()} to be ${JSON.stringify(v)}`); },
            toEqual: (v: unknown) => {
                if (JSON.stringify(actual) !== JSON.stringify(v)) fail(`expected ${shown()} to equal ${JSON.stringify(v)}`);
            },
            toBeGreaterThan: (v: number) => {
                if (!(typeof actual === 'number' && actual > v)) fail(`expected ${shown()} > ${v}`);
            },
            toBeGreaterThanOrEqual: (v: number) => {
                if (!(typeof actual === 'number' && actual >= v)) fail(`expected ${shown()} >= ${v}`);
            },
            toContain: (v: unknown) => {
                const has = Array.isArray(actual) ? actual.includes(v)
                    : typeof actual === 'string' && typeof v === 'string' ? actual.includes(v) : false;
                if (!has) fail(`expected ${shown()} to contain ${JSON.stringify(v)}`);
            },
            not: {
                toBe: (v: unknown) => { if (actual === v) fail(`expected ${shown()} not to be ${JSON.stringify(v)}`); },
                toBeNull: () => { if (actual === null) fail('expected not null'); },
                toContain: (v: unknown) => {
                    if (Array.isArray(actual) && actual.includes(v)) fail(`expected ${shown()} not to contain`);
                },
            },
        };
    };
    return { expect: pwExpect };
});

const {
    captureTranscriptSurfaceDiagnostics, expectBenchmarkDraftActivity,
    expectFinalizedTranscriptOutput, redactTranscriptText,
} = await import('../../../../../tests/live/helpers/benchmark-utils');

/** Minimal Playwright-shaped page over the real jsdom document. */
const page = {
    url: () => 'https://example.test/session',
    evaluate: async (fn: (arg?: unknown) => unknown, arg?: unknown) => fn(arg),
    locator: (sel: string) => locatorFor(sel),
    getByTestId: (id: string) => locatorFor(`[data-testid="${id}"]`),
    getByLabel: () => locatorFor('[data-never]'),
} as unknown as Parameters<typeof expectBenchmarkDraftActivity>[0];

const locatorFor = (selector: string) => ({
    __locator: true as const,
    selector,
    count: async () => document.querySelectorAll(selector).length,
    isVisible: async () => !!document.querySelector(selector),
    textContent: async () => document.querySelector(selector)?.textContent ?? null,
    getAttribute: async (n: string) => document.querySelector(selector)?.getAttribute(n) ?? null,
    or: () => locatorFor(selector),
    first: () => locatorFor(selector),
});

const progress = computeProgressVsBaseline([
    { fillerCount: 34, durationSeconds: 600 },
    { fillerCount: 26, durationSeconds: 600 },
]);

const renderDuring = (words: number, tokens: Array<{ text: string; filler?: boolean; interim?: boolean }>) =>
    render(
        <SessionDuringState
            recorder={{ elapsedSeconds: 60, amplitudes: [0.4, 0.6], recordedCount: 2, onStop: vi.fn() }}
            transcript={{ tokens, words, fillersPerMin: 2.6 }}
            progress={progress}
        />,
    );

beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => undefined); });

describe('the during-state surface the product really renders', () => {
    it('every landmark the helper requires is actually present', () => {
        renderDuring(184, [{ text: 'So' }, { text: 'um', filler: true }]);
        for (const tid of DURING_STATE_LANDMARKS) {
            expect(screen.queryAllByTestId(tid), `${tid} must render in the during state`).toHaveLength(1);
        }
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'during');
    });

    it('NONE of the retired ids render — attempt 7 read five zeroes and I misread them', () => {
        renderDuring(184, [{ text: 'So' }]);
        for (const tid of RETIRED_TRANSCRIPT_IDS) {
            expect(screen.queryAllByTestId(tid), `${tid} is dead code and must not render`).toHaveLength(0);
        }
    });

    it('diagnostics read the real surface: landmarks found, retired all zero', async () => {
        renderDuring(184, [{ text: 'So' }, { text: 'um', filler: true }]);
        const d = await captureTranscriptSurfaceDiagnostics(page);
        expect(d.shell.sessionState).toBe('during');
        expect(d.card.found).toBe(true);
        expect(d.liveTranscript.found).toBe(true);
        expect(d.liveTranscript.textContentLength).toBeGreaterThan(0);
        expect(d.headerMeta.words).toBe(184);
        for (const tid of RETIRED_TRANSCRIPT_IDS) expect(d.retiredCounts[tid]).toBe(0);
        for (const tid of DURING_STATE_LANDMARKS) expect(d.counts[tid]).toBe(1);
    });

    it('draft activity PASSES on a genuinely transcribing during state', async () => {
        renderDuring(184, [{ text: 'So' }, { text: 'um', filler: true }]);
        await expect(expectBenchmarkDraftActivity(page, 'r1', 1_500)).resolves.toBeUndefined();
    });

    it('FALSIFICATION: zero words in the header meta FAILS even though every landmark renders', async () => {
        // The exact state attempt 7 could not distinguish: surface healthy, nothing recognized.
        renderDuring(0, []);
        const d = await captureTranscriptSurfaceDiagnostics(page);
        expect(d.card.found, 'the surface is present').toBe(true);
        expect(d.headerMeta.words).toBe(0);
        await expect(expectBenchmarkDraftActivity(page, 'r1', 800)).rejects.toThrow(/header meta words=0/);
    });

    it('FALSIFICATION: a positive tally with EMPTY live text still fails', async () => {
        // Two independent signals are required precisely so a stale tally cannot carry the assertion.
        renderDuring(184, []);
        const d = await captureTranscriptSurfaceDiagnostics(page);
        expect(d.headerMeta.words).toBe(184);
        expect(d.liveTranscript.textContentLength).toBe(0);
        await expect(expectBenchmarkDraftActivity(page, 'r1', 800))
            .rejects.toThrow(/live-transcript has no recognized text/);
    });

    it('an UNPARSEABLE header meta is named as such, not reported as zero words', async () => {
        // The null guard is redundant for pass/fail — the next check catches null via `?? 0`. Its value
        // is diagnostic: "the tally could not be read" and "the tally says zero" are different faults
        // and must not collapse into one message. This pins that distinction.
        renderDuring(184, [{ text: 'So' }]);
        const meta = screen.getByTestId(TRANSCRIPT_HEADER_META);
        meta.textContent = 'live';
        const d = await captureTranscriptSurfaceDiagnostics(page);
        expect(d.headerMeta.found, 'the element is present').toBe(true);
        expect(d.headerMeta.words, 'but no number can be parsed from it').toBeNull();
        await expect(expectBenchmarkDraftActivity(page, 'r1', 800))
            .rejects.toThrow(/header meta reports no numeric word count/);
    });

    it('the zero-width caret cannot satisfy the text check', async () => {
        renderDuring(184, []);
        const live = screen.getByTestId(LIVE_TRANSCRIPT);
        live.insertAdjacentHTML('beforeend', '<span data-testid="live-caret"></span>');
        const d = await captureTranscriptSurfaceDiagnostics(page);
        expect(d.liveTranscript.caretPresent).toBe(true);
        expect(d.liveTranscript.textContentLength, 'caret contributes no characters').toBe(0);
        await expect(expectBenchmarkDraftActivity(page, 'r1', 800)).rejects.toThrow(/no recognized text/);
    });

    it('FALSIFICATION: a page missing the during landmarks names them, not "no transcription"', async () => {
        cleanup();
        document.body.innerHTML = '<div data-testid="transcript-panel"><div data-testid="transcript-container">x</div></div>';
        const err = await expectBenchmarkDraftActivity(page, 'r1', 800).catch((e: Error) => e.message);
        // The distinction attempt 7 lacked: "the surface is not the one we think" vs "nothing was said".
        expect(err).toMatch(/during-state landmarks missing/);
        expect(err).toMatch(/transcript-card|live-transcript|session-shell/);
    });

    it('diagnostics carry no recognized content — shapes only', async () => {
        renderDuring(184, [{ text: 'Basically' }, { text: 'literally' }]);
        const serialized = JSON.stringify(await captureTranscriptSurfaceDiagnostics(page));
        expect(serialized).not.toContain('Basically');
        expect(serialized).not.toContain('literally');
        expect(serialized).toMatch(/textContentLength/);
    });

    it('header-meta parsing matches the product format', () => {
        renderDuring(184, [{ text: 'So' }]);
        const meta = screen.getByTestId(TRANSCRIPT_HEADER_META).textContent;
        expect(meta).toMatch(/184 words · 2\.6 fillers\/min/);
        expect(parseHeaderMetaWords(meta)).toBe(184);
        expect(parseHeaderMetaWords('no numbers here')).toBeNull();
        expect(parseHeaderMetaWords(null)).toBeNull();
    });
});


describe('after Stop — finalized output, and evidence that carries no content', () => {
    const SECRET = 'Basically we should literally like wait um';

    it('finalized output IS required after Stop', async () => {
        renderDuring(184, [{ text: 'So' }]);
        await expect(expectFinalizedTranscriptOutput(page, 'r1', { meaningfulWordCount: 42, selectedForSaveLength: 210 }, 3))
            .resolves.toBeUndefined();
    });

    it('FALSIFICATION: too few finalized words fails', async () => {
        renderDuring(0, []);
        await expect(expectFinalizedTranscriptOutput(page, 'r1', { meaningfulWordCount: 1 }, 3))
            .rejects.toThrow(/selected-for-save transcript has 1 meaningful words/);
    });

    it('FAILS CLOSED: no numeric word count is unverifiable, and length cannot stand in', async () => {
        renderDuring(0, []);
        await expect(expectFinalizedTranscriptOutput(page, 'r1', { selectedForSaveLength: 400 }, 3))
            .rejects.toThrow(/NO numeric word count[\s\S]*cannot stand in/);
    });

    it('a non-finite word count is treated as ABSENT, not as zero', async () => {
        renderDuring(0, []);
        await expect(expectFinalizedTranscriptOutput(page, 'r1', { meaningfulWordCount: Number.NaN }, 3))
            .rejects.toThrow(/NO numeric word count/);
    });

    it('the redactor replaces transcript and bodyText with LENGTHS', () => {
        // Exercised directly: jsdom does not implement innerText, so ui.bodyText is always '' when
        // driven through the DOM and this contract would otherwise never be tested at all.
        const snapshot = { label: 'x', ui: { transcript: SECRET, bodyText: `page ${SECRET} chrome`, micStart: {} } };
        const out = JSON.stringify(redactTranscriptText(snapshot as never));
        expect(out).not.toContain('Basically');
        expect(out).not.toContain('literally');
        expect(out).toMatch(/"transcriptLength":42/);
        expect(out).toMatch(/"bodyTextLength":54/);
        expect(out, 'unrelated diagnostic fields survive').toContain('micStart');
    });

    it('the draft-activity failure path emits no recognized content', async () => {
        renderDuring(0, []);
        screen.getByTestId('transcript-content').insertAdjacentHTML('beforeend', `<span>${SECRET}</span>`);
        const err = await expectBenchmarkDraftActivity(page, 'r1', 500).catch((e: Error) => e.message);
        expect(err).not.toContain('Basically');
        expect(err).not.toContain('literally');
    });
});
