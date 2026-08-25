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
