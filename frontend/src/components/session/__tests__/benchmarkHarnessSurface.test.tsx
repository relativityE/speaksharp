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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '../../../../tests/support/test-utils';
import { SessionDuringState } from '../SessionDuringState';
import { SessionOverhaulView } from '../SessionOverhaulView';
import { computeProgressVsBaseline } from '@/utils/progressVsBaseline';
import {
    DURING_STATE_LANDMARKS, RETIRED_TRANSCRIPT_IDS, LIVE_TRANSCRIPT, TRANSCRIPT_HEADER_META,
    parseHeaderMetaWords, RETIRED_COMBINED_CONTROL,
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
    expectFinalizedTranscriptOutput, logBenchmarkPhase, attachPrivateBenchmarkEvidence,
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

    it('header meta showing ZERO words is a HEALTHY interim-only state and must PASS', async () => {
        // Production derives the header from `wordCount(transcriptContent)` (COMMITTED) while
        // live-transcript renders committed PLUS interim tokens. Requiring the header to be positive
        // would reject a genuinely transcribing interim-only session — the attempt-6 defect again.
        renderDuring(0, [{ text: 'So' }, { text: 'basically', interim: true }]);
        const d = await captureTranscriptSurfaceDiagnostics(page);
        expect(d.headerMeta.words, 'header legitimately reads zero here').toBe(0);
        expect(d.liveTranscript.wordLikeCount).toBeGreaterThan(0);
        await expect(expectBenchmarkDraftActivity(page, 'r1', 1_500)).resolves.toBeUndefined();
    });

    it('FALSIFICATION: a positive tally with EMPTY live text still fails', async () => {
        // Two independent signals are required precisely so a stale tally cannot carry the assertion.
        renderDuring(184, []);
        const d = await captureTranscriptSurfaceDiagnostics(page);
        expect(d.headerMeta.words).toBe(184);
        expect(d.liveTranscript.textContentLength).toBe(0);
        await expect(expectBenchmarkDraftActivity(page, 'r1', 800))
            .rejects.toThrow(/live-transcript has no recognized words/);
    });

    it('an unreadable header meta is reported as null and does NOT block a healthy session', async () => {
        // Header is diagnostic during recording, so an unparseable tally must not fail the run — but it
        // must be reported as `null` rather than coerced to 0, which would read as "said nothing".
        renderDuring(184, [{ text: 'So' }, { text: 'basically' }]);
        screen.getByTestId(TRANSCRIPT_HEADER_META).textContent = 'live';
        const d = await captureTranscriptSurfaceDiagnostics(page);
        expect(d.headerMeta.found).toBe(true);
        expect(d.headerMeta.words, 'unreadable is null, never a flattering zero').toBeNull();
        await expect(expectBenchmarkDraftActivity(page, 'r1', 1_500)).resolves.toBeUndefined();
    });

    it('the zero-width caret cannot satisfy the text check', async () => {
        renderDuring(184, []);
        const live = screen.getByTestId(LIVE_TRANSCRIPT);
        live.insertAdjacentHTML('beforeend', '<span data-testid="live-caret"></span>');
        const d = await captureTranscriptSurfaceDiagnostics(page);
        expect(d.liveTranscript.caretPresent).toBe(true);
        expect(d.liveTranscript.textContentLength, 'caret contributes no characters').toBe(0);
        await expect(expectBenchmarkDraftActivity(page, 'r1', 800)).rejects.toThrow(/no recognized words/);
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

    it('the draft-activity failure path emits no recognized content', async () => {
        renderDuring(0, []);
        screen.getByTestId('transcript-content').insertAdjacentHTML('beforeend', `<span>${SECRET}</span>`);
        const err = await expectBenchmarkDraftActivity(page, 'r1', 500).catch((e: Error) => e.message);
        expect(err).not.toContain('Basically');
        expect(err).not.toContain('literally');
    });
});


describe('the parent derivation, and evidence that never carries recognized speech', () => {
    const SECRET = 'Basically we should literally like wait um';

    const overhaul = (transcriptContent: string, interimTranscript: string) =>
        render(
            <SessionOverhaulView
                authUserId="u1" isListening sttStatus={'ready' as never} elapsedTime={42} micLevel={0.4}
                transcriptContent={transcriptContent} interimTranscript={interimTranscript}
                showAnalyticsPrompt={false} metricsFillerCount={0} onStartStop={vi.fn()} history={[]}
            />,
        );

    it('REQUIRED: interim-only through the REAL parent passes — committed empty, header zero', async () => {
        // The state #1350 previously rejected. Driven through SessionOverhaulView so the header count
        // and the live tokens come from the parent's own derivation rather than independent props.
        overhaul('', SECRET);
        const d = await captureTranscriptSurfaceDiagnostics(page);
        expect(d.headerMeta.words, 'committed is empty so the header reads zero').toBe(0);
        expect(d.liveTranscript.wordLikeCount, 'but interim text IS recognized speech').toBeGreaterThan(0);
        await expect(expectBenchmarkDraftActivity(page, 'r1', 1_500)).resolves.toBeUndefined();
    });

    it('a genuinely silent parent state still fails', async () => {
        overhaul('', '');
        await expect(expectBenchmarkDraftActivity(page, 'r1', 800))
            .rejects.toThrow(/live-transcript has no recognized words/);
    });

    it('SUCCESSFUL phase logs contain no recognized speech', async () => {
        // logBenchmarkPhase serialises the snapshot to the Actions log on SUCCESS paths, not only on
        // failure. While the selector was dead this was accidentally empty; pointing it at the real
        // surface would have published recognized speech on every healthy run.
        overhaul(SECRET, SECRET);
        const logged: string[] = [];
        vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { logged.push(a.join(' ')); });
        await logBenchmarkPhase(page, 'PROOF_TEST_PHASE');
        const out = logged.join('\n');
        expect(out, 'the phase log must be emitted at all').toMatch(/STT_BENCHMARK_PHASE/);
        expect(out, 'no recognized speech in a published log').not.toContain('Basically');
        expect(out).not.toContain('literally');
        // ...but the SHAPE must still be there, or the diagnostic is worthless.
        expect(out).toMatch(/transcriptChars/);
        expect(out).toMatch(/transcriptWords/);
        expect(out).toMatch(/bodyTextChars/);
    });

    it('ATTACHED benchmark evidence contains no recognized speech either', async () => {
        // The attachment ships with the run artifacts. `transcriptText` there was accidentally empty
        // only because the selector was dead; correcting the selector would have written real speech
        // into a downloadable file. Read the artifact back off disk rather than mocking fs, so this
        // tests what is actually persisted.
        overhaul(SECRET, SECRET);
        const { mkdtempSync, readFileSync, existsSync } = await import('node:fs');
        const { tmpdir } = await import('node:os');
        const { join } = await import('node:path');
        const dir = mkdtempSync(join(tmpdir(), 'ss-evidence-'));
        const paths: string[] = [];
        const testInfo = {
            outputPath: (n: string) => { const f = join(dir, n); paths.push(f); return f; },
            attach: async () => undefined,
        } as unknown as Parameters<typeof attachPrivateBenchmarkEvidence>[1];

        await attachPrivateBenchmarkEvidence(page, testInfo, 'r1');

        const written = paths.filter((f) => existsSync(f)).map((f) => readFileSync(f, 'utf8')).join('\n');
        expect(written.length, 'evidence must actually be written for this to mean anything').toBeGreaterThan(10);
        expect(written, 'no recognized speech in an attached artifact').not.toContain('Basically');
        expect(written).not.toContain('literally');
        expect(written, 'the shape must still be recorded').toMatch(/transcriptChars|transcriptWords/);
    });

    it('the snapshot is content-free AT SOURCE — no raw transcript or bodyText field exists', async () => {
        overhaul(SECRET, SECRET);
        const snap = await logBenchmarkPhase(page, 'PROOF_TEST_PHASE');
        const ui = (snap as unknown as { ui: Record<string, unknown> }).ui;
        expect('transcript' in ui, 'the raw field must not exist to be forgotten').toBe(false);
        expect('bodyText' in ui, 'the raw field must not exist to be forgotten').toBe(false);
        expect(typeof ui.transcriptChars).toBe('number');
        expect(typeof ui.transcriptWords).toBe('number');
    });
});


/**
 * #1304 Task 2 — the AUTHORITATIVE benchmark specs may not name a retired control or surface.
 *
 * These three produce the rows a model down-select is decided on. They previously clicked
 * `session-start-stop-button` (a combined toggle the session overhaul retired) and read
 * `transcript-container` (rendered by nothing), so their measurements came from controls that could
 * not resolve and a surface that was never there — a confident number computed from an empty string.
 *
 * A regression back to either must fail HERE, in seconds, rather than after a 40-minute live run.
 * Scope is deliberately the three authoritative specs: legacy diagnostic specs are out of scope and
 * are not evidence producers.
 */
const AUTHORITATIVE_BENCHMARK_SPECS = [
    'tests/live/private-decode-params-ab.live.spec.ts',
    'tests/live/private-longform-timing.live.spec.ts',
    'tests/live/benchmark-webgpu.live.spec.ts',
] as const;

/** Strip comments so a prose mention of the retired id in a WHY-note is not a false positive. */
function sourceWithoutComments(relPath: string): string {
    const raw = readFileSync(resolve(process.cwd(), relPath), 'utf8');
    return raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n');
}

describe('#1304 the authoritative benchmark specs use CURRENT controls only', () => {
    /**
     * `expectBenchmarkTranscriptOutput` is DEPRECATED and prohibited here: it asserts COMMITTED output
     * (empty by design while recording), still reaches the dead `transcript-container`, and its
     * `.catch(() => '')` turns a READ ERROR into "no words". An authoritative spec calling it is
     * measuring through the same blind surface these ids were removed for.
     */
    const PROHIBITED_HELPERS = ['expectBenchmarkTranscriptOutput'] as const;

    it.each(AUTHORITATIVE_BENCHMARK_SPECS)('%s names no retired control, surface or helper', (relPath) => {
        const source = sourceWithoutComments(relPath);
        for (const retired of [RETIRED_COMBINED_CONTROL, ...RETIRED_TRANSCRIPT_IDS, ...PROHIBITED_HELPERS]) {
            expect(source, `${relPath} must not reference the retired '${retired}'`).not.toContain(retired);
        }
    });

    /**
     * The LEGACY SCORER is prohibited by PATH as well as by name.
     *
     * `frontend/src/lib/wer`'s `calculateWordErrorRate` is the uncertified ruler #1356 replaced: it
     * charges 71% WER for `five dollars and fifty cents` vs `$5.50`, 50% for `21.4%`, 33% for
     * `colour`/`color`. A spec can be certified-clean on surface and ordering and still emit a number
     * produced by the wrong ruler — the same vacuous-check shape, one layer in.
     *
     * `wordErrorRate` is required positively, so deleting the scoring call is a failure too rather
     * than a spec that silently stops measuring.
     */
    it.each(AUTHORITATIVE_BENCHMARK_SPECS)('%s scores with the CERTIFIED scorer only', (relPath) => {
        const source = sourceWithoutComments(relPath);
        expect(source, `${relPath} must not import the legacy scorer by path`).not.toMatch(/from ['"][^'"]*\/lib\/wer['"]/);
        expect(source, `${relPath} must not call calculateWordErrorRate`).not.toMatch(/\bcalculateWordErrorRate\b/);
        expect(source, `${relPath} must score through the certified wordErrorRate`).toMatch(/\bwordErrorRate\b/);
        // A spec-local normalizer is a SECOND ruler, free to drift from the certified one.
        expect(source, `${relPath} must not define its own normalizer`).not.toMatch(/\bnormalizeForWer\b/);
    });

    it('POSITIVE CONTROL: the guard can actually see a retired id', () => {
        // Without this the assertion above would also pass if the files could not be read at all.
        expect(sourceWithoutComments(AUTHORITATIVE_BENCHMARK_SPECS[0]).length).toBeGreaterThan(500);
        expect(`x ${RETIRED_COMBINED_CONTROL} y`).toContain(RETIRED_COMBINED_CONTROL);
    });
});


describe('#1304 an unobserved transcript surface yields an INVALID run, never an empty measurement', () => {
    // The retired `transcript-container` rendered nowhere, so `textContent()` was null and the callers
    // turned it into `''`. A model that produced nothing and a surface that was never there became
    // indistinguishable — and a WER computed against `''` still looked like a number.
    const fakePage = (surfaces: Record<string, string>) => ({
        getByTestId: (id: string) => ({
            count: async () => (id in surfaces ? 1 : 0),
            first: () => ({ textContent: async () => surfaces[id] }),
        }),
    });

    it('an ABSENT surface is named, not silently empty', async () => {
        const { readBenchmarkTranscript } = await import('../../../../../tests/live/helpers/benchmark-utils');
        const read = await readBenchmarkTranscript(fakePage({}) as never);
        expect(read.ok).toBe(false);
        expect(read.ok ? null : read.invalidReason).toBe('transcript_surface_absent');
    });

    it('a PRESENT but empty surface is distinguished from an absent one', async () => {
        const { readBenchmarkTranscript } = await import('../../../../../tests/live/helpers/benchmark-utils');
        const read = await readBenchmarkTranscript(fakePage({ 'transcript-content': '   ' }) as never);
        expect(read.ok).toBe(false);
        expect(read.ok ? null : read.invalidReason).toBe('transcript_surface_empty');
    });

    it('INTERIM-ONLY: live text counts even when the committed surface is blank', async () => {
        // The committed surface is legitimately empty MID-RECORDING. Reporting `empty` as soon as
        // `transcript-content` existed-but-was-blank declared "no speech" while `live-transcript` was
        // carrying healthy interim text — recreating the very false negative this helper removes.
        const { readBenchmarkTranscript } = await import('../../../../../tests/live/helpers/benchmark-utils');
        const read = await readBenchmarkTranscript(
            fakePage({ 'transcript-content': '', 'live-transcript': 'the quick brown fox' }) as never,
        );
        expect(read).toEqual({ ok: true, text: 'the quick brown fox' });
    });

    it('BOTH surfaces blank is still empty, not absent', async () => {
        const { readBenchmarkTranscript } = await import('../../../../../tests/live/helpers/benchmark-utils');
        const read = await readBenchmarkTranscript(
            fakePage({ 'transcript-content': '', 'live-transcript': '  ' }) as never,
        );
        expect(read.ok ? null : read.invalidReason).toBe('transcript_surface_empty');
    });

    it('the CURRENT surface is read when it is actually rendered', async () => {
        const { readBenchmarkTranscript } = await import('../../../../../tests/live/helpers/benchmark-utils');
        const read = await readBenchmarkTranscript(fakePage({ 'transcript-content': 'hello   world' }) as never);
        expect(read).toEqual({ ok: true, text: 'hello world' });
    });
});


describe('#1304 the invalid-run guard is STRUCTURAL, not source-ordered', () => {
    /**
     * REPLACED A SOURCE-ORDERING ASSERTION. This block used to check
     * `source.indexOf('no_finalized_saved_transcript') < source.indexOf('wordErrorRate(')`.
     *
     * Two problems with that. It was fragile to comments and refactors — and it could not see the
     * OTHER half of the defect, which was an artifact and a log emitted BEFORE the guard ran. Source
     * order says nothing about what a function did.
     *
     * Task 3B moved the guard INSIDE `scoreBenchmarkRun`, so ordering is true by construction and
     * cannot be reordered. What remains here is an IMPORT BOUNDARY: an authoritative spec may not
     * reach a raw scorer directly, because doing so would bypass the guard entirely.
     *
     * The behavioural proof lives in `tests/evidence/__tests__/benchmarkScore.test.ts`.
     */
    it.each(AUTHORITATIVE_BENCHMARK_SPECS)('%s reaches no raw scorer', (relPath) => {
        const source = sourceWithoutComments(relPath);
        expect(source, `${relPath} must not import the legacy scorer by path`).not.toMatch(/from ['"][^'"]*\/lib\/wer['"]/);
        expect(source, `${relPath} must not call calculateWordErrorRate`).not.toMatch(/\bcalculateWordErrorRate\b/);
    });
});
