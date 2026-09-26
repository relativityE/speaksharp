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

const emit = (event: GovernedEvent, props: Record<string, string | boolean>): void => {
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

export const trackProductsMenuOpened = (surface: 'desktop' | 'mobile'): void =>
  emit('products_menu_opened', { surface });
