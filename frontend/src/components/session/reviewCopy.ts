/**
 * #1258 Rev 2 §2 — the review band's approved strings, shared by the live review (`AISuggestions`) and the restored
 * session's explicit Try again (`RestoredReviewRetry`) so both say exactly the same thing.
 */
/**
 * PO-approved correction (6175213749): disclose the authoritative saved inputs that
 * `get-ai-suggestions` sends. Open Mic includes filler counts and pace; Focus Points
 * includes its saved topic, points/results and relevant speaking measurements. Audio is not sent.
 *
 * PO 2026-11-11 (#1820): the card says "an AI service" so the wording survives a provider change, and links to
 * the Privacy Policy's Service Providers section, the one maintained place that names the current provider.
 * Do not hard-code the provider here. Exact PO wording: do not edit without PO approval.
 */
export const OPEN_MIC_DISCLOSURE =
  'Your transcript is sent to an AI service for coaching. Your filler counts and pace go with it; audio is never sent.';
export const FOCUS_POINTS_DISCLOSURE =
  'Your transcript is sent to an AI service for coaching. Your Focus Points topic, points and results and relevant speaking measurements go with it; audio is never sent.';

/** The maintained privacy detail that names the current AI provider. */
export const PROVIDER_DETAIL_HREF = '/privacy#service-providers';
export const PROVIDER_DETAIL_LABEL = 'Who provides it';

// #1258 punch list D3 (Rev 2 §2.1).
export const UNAVAILABLE_MESSAGE = "The review didn't load. Your session is saved.";
/** Fixed assurance appended only to a validated closed coaching failure. */
export const COACHING_ERROR_SESSION_ASSURANCE = 'Your session is saved.';

/** PO 2026-10-09: a reopened session whose transcript is no longer kept cannot be reviewed — terminal, no button. */
export const NOT_AVAILABLE_FOR_SESSION_MESSAGE = "Review isn't available for this session.";
