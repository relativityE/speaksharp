import type { FeedbackType } from '@/services/issueReportService';

export type FeedbackSeverity = 'minor' | 'slowed' | 'blocked';

export interface FeedbackDraft {
  ownerId: string | null;
  type: FeedbackType | null;
  body: string;
  severity: FeedbackSeverity | null;
  savedAt: number;
  idempotencyKey: string;
}

export const FEEDBACK_DRAFT_KEY = 'feedback.draft';
export const FEEDBACK_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const FEEDBACK_TYPES: readonly FeedbackType[] = ['broke', 'confused', 'idea', 'praise'];
const FEEDBACK_SEVERITIES: readonly FeedbackSeverity[] = ['minor', 'slowed', 'blocked'];

/**
 * #1416 — the draft lives here, not in the dialog, because the dialog is not always mounted.
 *
 * `Navigation` renders Share Feedback only while a session exists. When Supabase emits SIGNED_OUT —
 * an explicit sign-out, a revoked session, or a refresh that failed — the component is unmounted by
 * that same render, so an effect inside it can never observe the transition and can never erase the
 * text. Rejecting a mismatched owner at read time stops the previous account's draft from being
 * RESTORED, but it does not stop it from being RETAINED: the free-form body sits in this tab's
 * storage for up to 24 hours, after the user believes their session ended.
 *
 * So the authority that knows about auth transitions does the erasing. `AuthProvider` calls
 * `clearFeedbackDraft()` on sign-out and on any change of signed-in account, and it stays mounted
 * across exactly the transitions the dialog cannot see.
 */

export const readFeedbackDraft = (ownerId: string | null): FeedbackDraft | null => {
  try {
    const raw = sessionStorage.getItem(FEEDBACK_DRAFT_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<FeedbackDraft>;
    if ((value.ownerId ?? null) !== ownerId) {
      sessionStorage.removeItem(FEEDBACK_DRAFT_KEY);
      return null;
    }
    if (typeof value.savedAt !== 'number' || Date.now() - value.savedAt > FEEDBACK_DRAFT_MAX_AGE_MS) {
      sessionStorage.removeItem(FEEDBACK_DRAFT_KEY);
      return null;
    }
    return {
      ownerId,
      type: FEEDBACK_TYPES.includes(value.type as FeedbackType) ? (value.type as FeedbackType) : null,
      body: typeof value.body === 'string' ? value.body : '',
      severity: FEEDBACK_SEVERITIES.includes(value.severity as FeedbackSeverity)
        ? (value.severity as FeedbackSeverity)
        : null,
      savedAt: value.savedAt,
      idempotencyKey:
        typeof value.idempotencyKey === 'string' && value.idempotencyKey !== '' ? value.idempotencyKey : '',
    };
  } catch {
    return null;
  }
};

export const writeFeedbackDraft = (draft: FeedbackDraft): void => {
  try {
    sessionStorage.setItem(FEEDBACK_DRAFT_KEY, JSON.stringify(draft));
  } catch { /* draft persistence degrades safely */ }
};

export const clearFeedbackDraft = (): void => {
  try {
    sessionStorage.removeItem(FEEDBACK_DRAFT_KEY);
  } catch { /* storage is optional */ }
};

/** A draft with nothing in it is not a draft. Erasing every field must erase the stored copy. */
export const isEmptyFeedbackDraft = (
  type: FeedbackType | null, body: string, severity: FeedbackSeverity | null,
): boolean => type === null && body === '' && severity === null;
