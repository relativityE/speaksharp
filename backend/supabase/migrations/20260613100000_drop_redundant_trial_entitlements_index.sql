-- Review follow-up (P3): trial_entitlements(user_id) had TWO indexes:
--   * idx_trial_entitlements_user_id      (full,    20260612120000 — the FK-cascade index)
--   * trial_entitlements_user_id_idx      (partial, 20260612205224 — WHERE user_id IS NOT NULL)
-- The full index already covers the FK ON DELETE SET NULL cascade and all user_id lookups, so the
-- partial index is redundant write overhead. Keep the full index; drop the partial one. Idempotent.
DROP INDEX IF EXISTS public.trial_entitlements_user_id_idx;
