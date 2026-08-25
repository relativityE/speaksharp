// #1306 — THE authoritative desktop recording-journey control map.
//
// WHY THIS FILE EXISTS. Attempt 5 spent 40 production minutes clicking `session-start-stop-button` to
// start a first-run model download. No component renders that id: MicCard renders a DIFFERENT testid
// per model state, and MobileActionBar renders the SUFFIXED `session-start-stop-button-mobile`. The
// bare id resolves on no viewport at all. Acquisition was therefore never invoked, and the run reported
// the model as stuck — a harness defect that looked exactly like a product defect.
//
// The static selector contract passed it, because `SESSION_START_STOP_BUTTON` is referenced from a
// .tsx. That is what makes a source scan advisory rather than load-bearing: it can only see that a name
// appears somewhere, never that the right control renders in the state under test.
//
// So this map is DATA, deliberately dependency-free, and it is pinned to reality from two directions:
//   - the rendered-component tests (MicCard / RecorderBar) render each state and assert the control
//     named here is the one that actually appears, and that clicking it invokes the named callback;
//   - the live Playwright helpers build every locator FROM this map instead of literal strings.
// Changing an entry without changing the component fails the component test; changing the component
// without changing this map fails it too.
export const RETIRED_COMBINED_CONTROL = 'session-start-stop-button';

/** Product state (`document.documentElement[data-model-status]`) -> the control MicCard renders. */
export const MIC_CONTROL_BY_STATUS = {
    'download-required': 'mic-download',
    'init-failed': 'mic-retry',
    error: 'mic-retry',
    ready: 'mic-start',
    idle: 'mic-start',
} as const;

/** The one state with NO actionable primary control: the mic is disabled for the whole download. */
export const NON_ACTIONABLE_STATUS = 'loading';

/** The `during` (recording) slot. RecorderBar REPLACES MicCard; it does not toggle it. */
export const RECORDER_BAR = 'recorder-bar';
export const RECORDER_STOP = 'recorder-stop';

/**
 * A control that is absent is a harness/product mismatch, not slow work. It must fail in seconds so it
 * can never consume the 40-minute model budget the way attempt 5 did.
 */
export const MISSING_CONTROL_TIMEOUT_MS = 8_000;

export type MicModelStatus = keyof typeof MIC_CONTROL_BY_STATUS;

/** The control expected in `status`, or null when the state is legitimately non-actionable. */
export function micControlFor(status: string | null | undefined): string | null {
    if (status === NON_ACTIONABLE_STATUS) return null;
    return MIC_CONTROL_BY_STATUS[status as MicModelStatus] ?? null;
}

/**
 * THE CURRENT during-state transcript surface.
 *
 * WHY THIS REPLACES THE PREVIOUS MAP. Attempt 7 inspected `transcript-panel`, `transcript-container`,
 * `transcript-text-only`, `live-transcript-current-line` and `live-transcript-settled`, found all five
 * absent, and I read that as "the panel unmounted". It did not. Those ids belong to
 * `LiveTranscriptPanel`, which has NO production render or import — it survives only as dead code plus
 * its own tests. All five zeroes were the expected result of asking about a component the product does
 * not mount, and they said nothing whatever about transcription.
 *
 * The real chain is:
 *   SessionPage -> SessionOverhaulView -> SessionDuringState -> TranscriptCard + LiveTranscript
 *
 * The visible words "Live Transcript 0 words" that I cited as proof the panel was mounted come from
 * TranscriptCard's own header, not from LiveTranscriptPanel. That is the third time in this ticket a
 * check has passed or failed on a surface adjacent to the claim, and the reason the helper tests must
 * render the REAL component rather than hand-written markup that matches the helper's assumptions.
 */
export const SESSION_SHELL = 'session-shell';
export const SESSION_STATE_ATTR = 'data-session-state';
export const SESSION_SLOT_B = 'session-slot-b';
export const TRANSCRIPT_CARD = 'transcript-card';
export const TRANSCRIPT_LIVE_INDICATOR = 'transcript-live-indicator';
export const TRANSCRIPT_FINALIZING_BANNER = 'transcript-finalizing-banner';
export const TRANSCRIPT_HEADER_META = 'transcript-header-meta';
export const TRANSCRIPT_CONTENT = 'transcript-content';
export const LIVE_TRANSCRIPT = 'live-transcript';
export const LIVE_INTERIM = 'live-interim';
/** Zero-width: an empty styled span. It cannot contribute text, and must never satisfy a text check. */
export const LIVE_CARET = 'live-caret';

/** Landmarks that MUST all be present while the during state is recording. */
export const DURING_STATE_LANDMARKS = [
    SESSION_SHELL, TRANSCRIPT_CARD, TRANSCRIPT_LIVE_INDICATOR, TRANSCRIPT_CONTENT, LIVE_TRANSCRIPT,
] as const;

/**
 * Rendered by NOTHING in production. Kept only so a regression back to them fails loudly rather than
 * returning a confident row of zeroes that reads like a product defect.
 */
export const RETIRED_TRANSCRIPT_IDS = [
    'transcript-panel', 'transcript-container', 'transcript-text-only',
    'live-transcript-current-line', 'live-transcript-settled',
] as const;

/** `transcript-header-meta` renders "<n> words · <x.x> fillers/min" (or "<n> words"). */
export function parseHeaderMetaWords(text: string | null | undefined): number | null {
    const m = /(\d+)\s+words/.exec(text ?? '');
    return m ? Number(m[1]) : null;
}
