-- #1306 deletion closure — content-free, idempotent, owner-scoped session + account deletion RPCs.
--
-- SECURITY DEFINER with a fixed search_path and an explicit auth.uid() guard (RLS does not apply inside a
-- SECURITY DEFINER body, so ownership is enforced in-function). Every result is COUNTS/booleans only — no row
-- content is ever read into the return value, an error, or a log. Both RPCs are idempotent: deleting a missing
-- / already-deleted / another user's row is a successful no-op, never an error.

-- ── Single session delete ────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_my_session(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_deleted int;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: you can only delete your own sessions.' USING ERRCODE = '42501';
    END IF;
    -- Owner-scoped: another user's (or a non-existent) id deletes zero rows and returns deleted=false (no-op).
    DELETE FROM public.sessions WHERE id = p_session_id AND user_id = v_uid;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN jsonb_build_object('deleted', v_deleted > 0);
END;
$$;

-- ── Full account data purge ──────────────────────────────────────────────────────────────────────────────
-- Cascade-safe by CLEARING every user_id-scoped public table FIRST (so no inline RESTRICT FK can block the
-- delete — see the usage_checkpoints partial-delete incident), then the profile row. Enumerated dynamically
-- so a newly-added user-owned table is covered automatically. Removing the auth.users identity itself is a
-- separate privileged admin step (outside this owner-callable RPC) and is intentionally NOT done here.
CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid uuid := auth.uid();
    r record;
    v_n int;
    v_total int := 0;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: you can only delete your own account.' USING ERRCODE = '42501';
    END IF;
    FOR r IN
        SELECT c.table_name
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = 'public'
          AND c.column_name = 'user_id'
          AND t.table_type = 'BASE TABLE'
    LOOP
        EXECUTE format('DELETE FROM public.%I WHERE user_id = $1', r.table_name) USING v_uid;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_total := v_total + v_n;
    END LOOP;
    -- The profile row is keyed by id (not user_id); clear it last.
    DELETE FROM public.user_profiles WHERE id = v_uid;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_total := v_total + v_n;
    -- Content-free: a count only, never any deleted row's content.
    RETURN jsonb_build_object('ok', true, 'rows_deleted', v_total);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_my_session(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_my_session(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.delete_my_session(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.delete_my_account() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_my_account() FROM anon;
GRANT  EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;
