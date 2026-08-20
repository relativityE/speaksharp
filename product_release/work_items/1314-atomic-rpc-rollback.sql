-- #1314 C1+C2 — PAIRED ROLLBACK for the atomic completion migration.
--
-- Restores the Stage-A state EXACTLY. This migration creates no column, constraint, trigger or grant beyond the
-- function itself, so the rollback is genuinely "drop the new function and restore the previous one" — there is
-- no data migration to reverse and no row is rewritten.
--
-- ROLLBACK SAFETY — read before running:
--   * Transcripts already persisted by the atomic RPC are NOT deleted by this rollback, and must not be. They
--     are legitimate retained user content under the retention contract; the newest-two sweep will expire them
--     on its normal schedule. Rolling back the code path does not make already-saved user data illegitimate.
--   * Roll back the CLIENT FIRST. A client that sends p_final_transcript against a database where this function
--     has been reverted gets PGRST202 and every completion fails. Order: revert/redeploy the frontend, then run
--     this. That is the mirror image of the apply order.
--   * The LEGACY overload is untouched by both the migration and this rollback.

BEGIN;

-- PURELY ADDITIVE MIGRATION -> the rollback removes EVERYTHING it created and restores nothing, because it
-- replaced nothing. The migration creates THREE functions, so the rollback drops all three: an earlier version
-- dropped only the RPC and claimed "exact restoration" while leaving two helpers installed. That claim was
-- false, and a rollback that quietly leaves objects behind is how drift starts.
DROP FUNCTION IF EXISTS public.complete_session_v2(
  UUID, TEXT, INT, TEXT, JSONB, INT, DOUBLE PRECISION, DOUBLE PRECISION, JSONB, JSONB, TEXT);
DROP FUNCTION IF EXISTS public.max_persisted_transcript_chars();
DROP FUNCTION IF EXISTS public.max_persisted_transcript_bytes();

COMMIT;

-- ORDER: if the client has adopted v2, revert/redeploy the CLIENT FIRST — otherwise its calls 404 (PGRST202).
-- Verify with product_release/work_items/1314-atomic-rpc-readback.sql: A2_V2 must read NONE, C_TRANSCRIPT_LIMIT
-- must read chars=ABSENT bytes=ABSENT, and A_OVERLOADS must still show the two untouched legacy-era overloads.
-- If PostgREST is in front of the database, also NOTIFY pgrst, 'reload schema' — otherwise it keeps serving a
-- cached signature that no longer exists and the rollback looks incomplete.
