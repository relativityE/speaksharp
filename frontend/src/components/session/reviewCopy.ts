/**
 * #1258 Rev 2 §2 — the review band's approved strings, shared by the live review (`AISuggestions`) and the restored
 * session's explicit Try again (`RestoredReviewRetry`) so both say exactly the same thing.
 */
/**
 * PO-approved correction (6175213749): disclose the authoritative saved inputs that
 * `get-ai-suggestions` sends. Open Mic includes filler counts and pace; Focus Points
 * includes its saved topic, points/results and relevant speaking measurements.
 * Provider-specific Privacy/Legal details remain separate. Audio is not sent.
 * Exact PO wording: do not edit without PO approval.
 */
export const OPEN_MIC_DISCLOSURE = "Sends this session's transcript and speaking measurements (filler counts and pace) to the AI service provider to create AI coaching. Audio is never sent.";
export const FOCUS_POINTS_DISCLOSURE =
  "Sends this session's transcript, saved Focus Points topic, points and results, and relevant speaking measurements to the AI service provider to create AI coaching. Audio is never sent.";

// #1258 punch list D3 (Rev 2 §2.1).
export const UNAVAILABLE_MESSAGE = "The review didn't load. Your session is saved.";

/** PO 2026-10-09: a reopened session whose transcript is no longer kept cannot be reviewed — terminal, no button. */
export const NOT_AVAILABLE_FOR_SESSION_MESSAGE = "Review isn't available for this session.";
