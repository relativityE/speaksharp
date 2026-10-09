/**
 * #1258 Rev 2 §2 — the review band's approved strings, shared by the live review (`AISuggestions`) and the restored
 * session's explicit Try again (`RestoredReviewRetry`) so both say exactly the same thing.
 */
/**
 * #1538 (PO-approved wording, Codex P1 r4117696897) — the disclosure names everything `get-ai-suggestions` sends.
 * A Focus Points take's prompt also carries its saved topic and point labels, so its line says so; Open Mic sends the
 * transcript only and keeps the transcript-only line. Exact PO wording: do not edit without PO approval.
 */
export const OPEN_MIC_DISCLOSURE = "Sends this session's transcript to Google Gemini to create AI coaching. Audio is never sent.";
export const FOCUS_POINTS_DISCLOSURE =
  "Sends this session's transcript and your Focus Points topic and points to Google Gemini to create AI coaching. Audio is never sent.";

// #1258 punch list D3 (Rev 2 §2.1).
export const UNAVAILABLE_MESSAGE = "The review didn't load. Your session is saved.";

/** PO 2026-10-09: a reopened session whose transcript is no longer kept cannot be reviewed — terminal, no button. */
export const NOT_AVAILABLE_FOR_SESSION_MESSAGE = "Review isn't available for this session.";
