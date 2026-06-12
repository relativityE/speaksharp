-- Codebase-audit index hygiene. No behavioral/data change; index-only DDL, idempotent.
--
-- (D) trial_entitlements.user_id is a foreign key (REFERENCES auth.users(id) ON DELETE SET NULL)
--     with no supporting index (the table's PRIMARY KEY is `email`). Without an index on the
--     referencing column, deleting an auth.users row forces Postgres to sequentially scan
--     trial_entitlements to find and NULL the matching references — an avoidable IO spike at scale.
--     Add the FK index.
CREATE INDEX IF NOT EXISTS idx_trial_entitlements_user_id
    ON public.trial_entitlements (user_id);

-- (E) custom_vocabulary was renamed to user_filler_words (20260103170500_rename_custom_vocabulary),
--     but its index kept the legacy name idx_custom_vocabulary_user_id. Postgres carries the index
--     across a table rename, so this is purely cosmetic — align the index name with the current
--     table. IF EXISTS keeps it a safe no-op if the index was already renamed/absent.
ALTER INDEX IF EXISTS public.idx_custom_vocabulary_user_id
    RENAME TO idx_user_filler_words_user_id;
