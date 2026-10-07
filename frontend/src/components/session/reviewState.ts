/**
 * #1258 (RWT run 37514078995, F4) — the card's published review state, as a pure function of everything that decides it,
 * so every combination is tested. Only a RETURNED request settles the card (`ready` / `error`), or a stated reason that no
 * review can be requested (`blocked`). Anything else — still saving, eligible but not yet requested, or the committed
 * render between eligibility and the automatic request's effect — is `pending`, never a settled-looking `empty`.
 */
export type ReviewState = 'loading' | 'error' | 'ready' | 'blocked' | 'pending';
export function deriveReviewState(s: {
  isLoading: boolean; retrying: boolean; error: boolean; hasSuggestions: boolean; reviewReady: boolean; blocked: boolean;
}): ReviewState {
  if (s.isLoading || s.retrying) return 'loading';
  if (s.error) return 'error';
  if (s.hasSuggestions) return 'ready';
  if (!s.reviewReady && s.blocked) return 'blocked';
  return 'pending';
}
