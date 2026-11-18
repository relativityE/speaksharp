-- #1835: absence means no recorded choice. Do not backfill, delete, or rewrite existing saved data.
CREATE TABLE public.practice_privacy_choices (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    transcript_save boolean NOT NULL,
    ai_coaching boolean NOT NULL,
    consent_version smallint NOT NULL DEFAULT 1 CHECK (consent_version = 1),
    choice_revision integer NOT NULL DEFAULT 1 CHECK (choice_revision > 0),
    changed_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    CHECK (NOT ai_coaching OR transcript_save)
);

ALTER TABLE public.practice_privacy_choices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.practice_privacy_choices FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.practice_privacy_choices TO authenticated, service_role;
GRANT INSERT (user_id, transcript_save, ai_coaching) ON public.practice_privacy_choices TO authenticated;
GRANT UPDATE (transcript_save, ai_coaching) ON public.practice_privacy_choices TO authenticated;

CREATE POLICY practice_privacy_owner_read ON public.practice_privacy_choices
    FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY practice_privacy_owner_insert ON public.practice_privacy_choices
    FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY practice_privacy_owner_update ON public.practice_privacy_choices
    FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid()))
    WITH CHECK (user_id = (SELECT auth.uid()));

CREATE FUNCTION public.bump_practice_privacy_choice_revision_v1() RETURNS trigger
    LANGUAGE plpgsql SET search_path = ''
    AS $$
BEGIN
    IF (NEW.transcript_save, NEW.ai_coaching) IS DISTINCT FROM (OLD.transcript_save, OLD.ai_coaching) THEN
        NEW.choice_revision := OLD.choice_revision + 1;
        NEW.changed_at := statement_timestamp();
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bump_practice_privacy_choice_revision_v1() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER practice_privacy_choice_revision
    BEFORE UPDATE ON public.practice_privacy_choices
    FOR EACH ROW EXECUTE FUNCTION public.bump_practice_privacy_choice_revision_v1();

-- A first choice can only insert an absent row. An existing choice can only update the exact
-- revision the caller saw; the row lock/recheck or unique index decides concurrent writers.
CREATE FUNCTION public.set_practice_privacy_choices_v1(
    p_transcript_save boolean, p_ai_coaching boolean, p_expected_revision integer)
    RETURNS TABLE (transcript_save boolean, ai_coaching boolean, consent_version smallint, choice_revision integer)
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
    AS $$
BEGIN
    IF p_expected_revision IS NULL THEN
        RETURN QUERY INSERT INTO public.practice_privacy_choices AS choice (user_id, transcript_save, ai_coaching)
        VALUES ((SELECT auth.uid()), p_transcript_save, p_ai_coaching)
        ON CONFLICT (user_id) DO NOTHING
        RETURNING choice.transcript_save, choice.ai_coaching, choice.consent_version, choice.choice_revision;
    ELSE
        IF p_expected_revision < 1 THEN
            RAISE EXCEPTION 'invalid_privacy_choice_revision' USING ERRCODE = '22023';
        END IF;
        RETURN QUERY UPDATE public.practice_privacy_choices AS choice
        SET transcript_save = p_transcript_save, ai_coaching = p_ai_coaching
        WHERE choice.user_id = (SELECT auth.uid()) AND choice.choice_revision = p_expected_revision
        RETURNING choice.transcript_save, choice.ai_coaching, choice.consent_version, choice.choice_revision;
    END IF;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'privacy_choices_changed' USING ERRCODE = 'P0001';
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.set_practice_privacy_choices_v1(boolean, boolean, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_practice_privacy_choices_v1(boolean, boolean, integer) TO authenticated;

-- Cover current and legacy session-write routes. Replays of the same stored text do not change it.
-- Leaving this value null remains a normal metrics-only completion and does not discard the session.
CREATE FUNCTION public.require_session_transcript_opt_in_v1() RETURNS trigger
    LANGUAGE plpgsql SET search_path = ''
    AS $$
DECLARE allowed boolean;
BEGIN
    IF NEW.transcript IS NULL OR (TG_OP = 'UPDATE' AND NEW.transcript IS NOT DISTINCT FROM OLD.transcript) THEN
        RETURN NEW;
    END IF;
    SELECT transcript_save AND consent_version = 1 INTO allowed
      FROM public.practice_privacy_choices WHERE user_id = NEW.user_id FOR SHARE;
    IF allowed IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'transcript_consent_required' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.require_session_transcript_opt_in_v1() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER require_session_transcript_opt_in
    BEFORE INSERT OR UPDATE OF transcript ON public.sessions
    FOR EACH ROW EXECUTE FUNCTION public.require_session_transcript_opt_in_v1();

-- Close the interval between the Edge recheck and the existing atomic coaching save. Lock the profile
-- before the consent row, as session completion also locks the profile before writing. Old client code
-- cannot call either privileged RPC. Roll out with the updated Edge handler; the previous Edge is not compatible.
CREATE FUNCTION public.persist_account_coaching_with_consent_v1(
  p_operation_id uuid,p_provider_settled boolean,p_session_id uuid,p_user_id uuid,p_suggestions jsonb,
  p_provider text,p_model text,p_quota_scope text,p_quota_utc_date date,p_quota_limit integer,p_quota_request_number integer,
  p_choice_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE allowed boolean;
BEGIN
    PERFORM 1 FROM public.user_profiles WHERE id=p_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'account unavailable' USING ERRCODE = '42501'; END IF;
    SELECT transcript_save AND ai_coaching AND consent_version = 1 AND choice_revision = p_choice_revision
      INTO allowed FROM public.practice_privacy_choices WHERE user_id = p_user_id FOR SHARE;
    IF allowed IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'coaching_consent_required' USING ERRCODE = '42501';
    END IF;
    RETURN public.persist_account_coaching_v1(
      p_operation_id,p_provider_settled,p_session_id,p_user_id,p_suggestions,
      p_provider,p_model,p_quota_scope,p_quota_utc_date,p_quota_limit,p_quota_request_number);
END;
$$;
REVOKE ALL ON FUNCTION public.persist_account_coaching_with_consent_v1(uuid,boolean,uuid,uuid,jsonb,text,text,text,date,integer,integer,integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.persist_account_coaching_with_consent_v1(uuid,boolean,uuid,uuid,jsonb,text,text,text,date,integer,integer,integer)
  TO service_role;
REVOKE EXECUTE ON FUNCTION public.persist_account_coaching_v1(uuid,boolean,uuid,uuid,jsonb,text,text,text,date,integer,integer)
  FROM PUBLIC, anon, authenticated, service_role;
