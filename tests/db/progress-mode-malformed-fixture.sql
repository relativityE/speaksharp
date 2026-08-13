\set ON_ERROR_STOP on
\ir progress-mode-realpg-seed.sql

UPDATE public.session_progress_evaluations SET cohort_key = CASE session_id
    WHEN '00000000-0000-4000-8000-0000000000a1' THEN 'private-v2|v2|base|clarity_v1|unknown'
    WHEN '00000000-0000-4000-8000-0000000000b1' THEN 'private-v2||base|clarity_v1'
    WHEN '00000000-0000-4000-8000-0000000000c1' THEN 'private-v2|v2|base'
    WHEN '00000000-0000-4000-8000-0000000000d1' THEN 'private-v2|v2|base|clarity_v1|freeform|extra'
END;

CREATE TABLE public.progress_mode_before AS
SELECT session_id, cohort_key, baseline_session_id, previous_comparable_session_id
FROM public.session_progress_evaluations;

DO $counts$
DECLARE v_count integer;
BEGIN
    SELECT count(*)::integer INTO v_count
    FROM public.session_progress_evaluations e
    WHERE e.eligible AND (
        e.cohort_key IS NULL
        OR cardinality(string_to_array(e.cohort_key, '|')) NOT IN (4, 5)
        OR EXISTS (
            SELECT 1 FROM unnest(string_to_array(e.cohort_key, '|')) AS part
            WHERE btrim(part) = ''
        )
        OR (
            cardinality(string_to_array(e.cohort_key, '|')) = 5
            AND (string_to_array(e.cohort_key, '|'))[5] NOT IN ('objective', 'freeform')
        )
    );
    IF v_count <> 4 THEN RAISE EXCEPTION 'dirty fixture expected sanitized malformed count 4, got %', v_count; END IF;
END;
$counts$;
