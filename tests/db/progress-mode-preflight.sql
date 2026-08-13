-- #1265 read-only, content-free pre-apply inventory. Returns sanitized counts only.
WITH evaluation_modes AS (
    SELECT e.session_id,
           e.cohort_key,
           e.baseline_session_id,
           e.previous_comparable_session_id,
           CASE WHEN EXISTS (
               SELECT 1 FROM public.objective_source_recording o WHERE o.session_id = e.session_id
           ) THEN 'objective' ELSE 'freeform' END AS practice_mode
    FROM public.session_progress_evaluations e
), pointer_modes AS (
    SELECT e.session_id, e.practice_mode, pointer.reference_session_id
    FROM evaluation_modes e
    CROSS JOIN LATERAL (
        VALUES (e.baseline_session_id), (e.previous_comparable_session_id)
    ) AS pointer(reference_session_id)
    WHERE pointer.reference_session_id IS NOT NULL
), cross_mode_pointers AS (
    SELECT p.session_id, p.reference_session_id
    FROM pointer_modes p
    JOIN evaluation_modes reference ON reference.session_id = p.reference_session_id
    WHERE p.practice_mode <> reference.practice_mode
)
SELECT
    count(*) FILTER (
        WHERE cohort_key IS NOT NULL AND array_length(string_to_array(cohort_key, '|'), 1) = 4
    )::int AS rows_to_suffix,
    (SELECT count(*)::int FROM cross_mode_pointers) AS cross_mode_pointers_to_replace,
    count(*) FILTER (
        WHERE cohort_key IS NULL
           OR array_length(string_to_array(cohort_key, '|'), 1) NOT IN (4, 5)
    )::int AS malformed_or_unknown_cohort_keys,
    0::int AS expected_post_apply_cross_mode_pointers
FROM evaluation_modes;
