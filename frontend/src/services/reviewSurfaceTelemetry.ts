/**
 * #1258 — telemetry for the RWT runbook's review-surface and navigation controls (PM disposition 2026-09-25).
 *
 * Content-free: closed enums and booleans only — never a session id, transcript, coaching phrase, point text or
 * evidence line. `saved_review_revisited` is deliberately its OWN event: showing a SAVED review on Analytics is a
 * revisit, and it must never be counted as a generation (the `practice_loop_review_*` family, emitted only by the
 * Session page's newly generated review).
 */
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import type { GovernedEvent } from '@/services/telemetryAllowlist';

export type ReviewProduct = 'open_mic' | 'focus_points' | 'unknown';
export type PdfSurface = 'history_list' | 'history_list_mobile' | 'session_detail';
export type SavedReviewState = 'review' | 'none' | 'expired' | 'error';

const emit = (event: GovernedEvent, props: Record<string, string | boolean | number>): void => {
  try {
    analyticsBuffer.push(event, props, 'LOW');
  } catch {
    /* fail open — telemetry must never block a download, a navigation or a practice action */
  }
};

export const trackSessionPdfDownloaded = (surface: PdfSurface): void =>
  emit('session_pdf_downloaded', { surface });

export const trackSavedReviewRevisited = (product: ReviewProduct, reviewState: SavedReviewState, evidencePresent: boolean): void =>
  emit('saved_review_revisited', { product, review_state: reviewState, evidence_present: evidencePresent });

export const trackSavedReviewPracticeSelected = (product: ReviewProduct, linkedRepeat: boolean): void =>
  emit('saved_review_practice_selected', { product, linked_repeat: linkedRepeat });

export type PracticeLinkState = 'pending' | 'error' | 'blocked' | 'linked' | 'direct';
export type PracticeReviewState = 'loading' | 'loaded' | 'read_failed' | 'focus_read_failed';
export type PracticeProgressStatus = 'loading' | 'read_error' | 'insufficient' | 'ineligible' | 'unavailable' | 'error' | 'eligible' | 'unknown';
export type PracticeActionTaken = 'ignored' | 'reread_review' | 'refetch_progress' | 'accept_linked' | 'open_session' | 'open_focus_setup' | 'open_practice';
export type PracticeIntendedRoute = 'session' | 'focus_setup' | 'practice' | 'none';
export type PracticeBlockedReason = 'none' | 'review_loading' | 'progress_pending' | 'previous_attempt_pending' | 'linking' | 'retry_blocked' | 'progress_refetching';
export type LinkedAttemptOutcome = 'ok' | 'not_started' | 'readback_blocked' | 'server_failed' | 'handoff_failed_abandoned' | 'handoff_failed_unclosed' | 'threw';

/** #1258 — every press of the saved review's practice action: what the page knew, and which branch ran. */
export const trackSavedReviewPracticeAction = (input: {
  product: ReviewProduct; linkState: PracticeLinkState; reviewState: PracticeReviewState;
  progressStatus: PracticeProgressStatus; action: PracticeActionTaken; actionSeq: number; intendedRoute: PracticeIntendedRoute;
}): void =>
  emit('saved_review_practice_action', {
    product: input.product, link_state: input.linkState, review_state: input.reviewState,
    progress_status: input.progressStatus, action: input.action, action_seq: Math.min(100, Math.max(1, input.actionSeq)),
    intended_route: input.intendedRoute,
  });

/** #1258 — the practice action's availability, emitted by the caller only when it CHANGES. */
export const trackSavedReviewPracticeState = (input: {
  product: ReviewProduct; linkState: PracticeLinkState; reviewState: PracticeReviewState; enabled: boolean; blockedReason: PracticeBlockedReason;
}): void =>
  emit('saved_review_practice_state', {
    product: input.product, link_state: input.linkState, review_state: input.reviewState,
    enabled: input.enabled, blocked_reason: input.blockedReason,
  });

/** #1258 — the linked repeat attempt a press started, and how it ended. `action_seq` names the press. */
export const trackSavedReviewLinkedAttempt = (
  outcome: LinkedAttemptOutcome, elapsedMs: number, actionSeq: number, intendedRoute: PracticeIntendedRoute = 'none',
): void =>
  emit('saved_review_linked_attempt', {
    outcome, elapsed_ms: Math.max(0, Math.min(600_000, Math.round(elapsedMs))), action_seq: Math.min(100, Math.max(1, actionSeq)),
    intended_route: intendedRoute,
  });

export const trackProductsMenuOpened = (surface: 'desktop' | 'mobile'): void =>
  emit('products_menu_opened', { surface });

/** #1258 (Codex r4191751371): where a practice press actually ARRIVED. `route_class` is the closed class of the landed
 * location, with `other` for anywhere unexpected, so a redirect is visible. No path, id or query value is sent. */
export type PracticeArrivalRoute = 'session' | 'focus_setup' | 'practice' | 'other';
export function practiceArrivalRoute(pathname: string, search: string): PracticeArrivalRoute {
  if (pathname === '/session') return 'session';
  if (pathname === '/practice') return new URLSearchParams(search).get('product') === 'focus-points' ? 'focus_setup' : 'practice';
  return 'other';
}
export function trackSavedReviewPracticeArrived(actionSeq: number, routeClass: PracticeArrivalRoute): void {
  emit('saved_review_practice_arrived', { action_seq: actionSeq, route_class: routeClass });
}
