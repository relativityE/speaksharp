\set ON_ERROR_STOP on
DO $verify$
BEGIN
    IF EXISTS (
        (SELECT session_id, cohort_key, baseline_session_id, previous_comparable_session_id FROM public.session_progress_evaluations
         EXCEPT SELECT session_id, cohort_key, baseline_session_id, previous_comparable_session_id FROM public.progress_mode_before)
        UNION ALL
        (SELECT session_id, cohort_key, baseline_session_id, previous_comparable_session_id FROM public.progress_mode_before
         EXCEPT SELECT session_id, cohort_key, baseline_session_id, previous_comparable_session_id FROM public.session_progress_evaluations)
    ) THEN RAISE EXCEPTION 'malformed migration attempt partially mutated suffixes or pointers'; END IF;
END;
$verify$;
\echo 'MALFORMED HOLD PRESERVED ALL ROWS'
