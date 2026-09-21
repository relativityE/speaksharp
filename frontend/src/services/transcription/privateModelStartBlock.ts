import type { TranscriptionMode } from './TranscriptionPolicy';

/**
 * #1306 — WHICH PRIVATE MODEL STATES MAY BLOCK THE START CONTROL.
 *
 * WHY THIS IS A NAMED MODULE RATHER THAN AN INLINE LIST. This predicate lived as an anonymous array
 * literal inside `useSessionLifecycle`, and its result flows through `SessionOverhaulView`'s
 * `disabled` prop into the control `MicCard` renders for that same state. Nothing named the
 * relationship, so when #1415 changed what the cold control DOES, nothing failed to point out that
 * the list still disabled it. Every surface now reads this one function, and the reasoning lives
 * beside the data.
 *
 * `download-required` IS NOT HERE, AND THAT IS THE WHOLE POINT.
 *
 * Before #1415 the cold control was a setup-only action that bypassed the recording gate: it
 * downloaded, and a SECOND press recorded. Blocking "start" while the model was absent was therefore
 * coherent — the download button was not a start button.
 *
 * #1415 made the cold press ONE activation that consents, prepares and records, and
 * `SpeechRuntimeController.startRecording` implements exactly that: it sees `DOWNLOAD_REQUIRED`,
 * drives the download, and resumes the held recording intent. The state's only exit is that press.
 * Keeping `download-required` in this list therefore disabled the sole control that can leave it —
 * a dead end on every first-run account, showing "One-time download needed" above a button that
 * cannot be pressed.
 *
 * The states that remain are the ones with another way out, or no user action to offer:
 *   - `loading`   — the download is already in flight; the mic is deliberately greyed for its duration.
 *   - `init-failed` / `error` — setup failed. These render `mic-retry`, which `MicCard` keeps
 *     unconditionally enabled (#1258), so this never strands the user.
 *
 * This is a MODEL-READINESS question only. The durable Progress start gate (#1354) is a separate,
 * still-enforced input to the same `disabled` prop, and `startRecording` re-reads the durable queue
 * on every attempt regardless of what is rendered.
 */
export const PRIVATE_MODEL_STATUSES_BLOCKING_START = ['loading', 'init-failed', 'error'] as const;

/** The one control that must never be disabled by model readiness, because pressing it is the fix. */
export const PRIVATE_MODEL_STATUS_STARTED_BY_THE_USER = 'download-required';

export function isPrivateModelBlockingStart(
    effectiveMode: TranscriptionMode | null | undefined,
    privateModelStatus: string | null | undefined,
): boolean {
    if (effectiveMode !== 'private') return false;
    return (PRIVATE_MODEL_STATUSES_BLOCKING_START as readonly string[])
        .includes(privateModelStatus ?? '');
}
