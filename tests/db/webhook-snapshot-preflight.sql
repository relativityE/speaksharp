-- #1287 read-only production preflight contract.
-- Emits sanitized aggregate counts only and fails closed when durable billing identities are blank or
-- duplicated. It never prints identifiers and performs no writes or repairs.

WITH metrics AS (
  SELECT
    (SELECT count(*)::int
       FROM public.user_profiles
      WHERE stripe_subscription_id IS NOT NULL
        AND btrim(stripe_subscription_id) = '') AS blank_subscription_rows,
    (SELECT count(*)::int
       FROM (
         SELECT stripe_subscription_id
           FROM public.user_profiles
          WHERE stripe_subscription_id IS NOT NULL
          GROUP BY stripe_subscription_id
         HAVING count(*) > 1
       ) duplicate_groups) AS duplicate_subscription_groups,
    (SELECT count(*)::int
       FROM public.user_profiles
      WHERE stripe_customer_id IS NOT NULL
        AND btrim(stripe_customer_id) = '') AS blank_customer_rows,
    (SELECT count(*)::int
       FROM (
         SELECT stripe_customer_id
           FROM public.user_profiles
          WHERE stripe_customer_id IS NOT NULL
          GROUP BY stripe_customer_id
         HAVING count(*) > 1
       ) duplicate_groups) AS duplicate_customer_groups
)
SELECT json_build_object(
  'blank_subscription_rows', blank_subscription_rows,
  'duplicate_subscription_groups', duplicate_subscription_groups,
  'blank_customer_rows', blank_customer_rows,
  'duplicate_customer_groups', duplicate_customer_groups,
  'clean', blank_subscription_rows = 0
           AND duplicate_subscription_groups = 0
           AND blank_customer_rows = 0
           AND duplicate_customer_groups = 0
) AS sanitized_billing_identity_preflight
FROM metrics;

DO $$
DECLARE
  v_blank_subscriptions int;
  v_duplicate_subscriptions int;
  v_blank_customers int;
  v_duplicate_customers int;
BEGIN
  SELECT count(*)::int INTO v_blank_subscriptions
    FROM public.user_profiles
   WHERE stripe_subscription_id IS NOT NULL AND btrim(stripe_subscription_id) = '';

  SELECT count(*)::int INTO v_duplicate_subscriptions
    FROM (
      SELECT stripe_subscription_id
        FROM public.user_profiles
       WHERE stripe_subscription_id IS NOT NULL
       GROUP BY stripe_subscription_id
      HAVING count(*) > 1
    ) duplicate_groups;

  SELECT count(*)::int INTO v_blank_customers
    FROM public.user_profiles
   WHERE stripe_customer_id IS NOT NULL AND btrim(stripe_customer_id) = '';

  SELECT count(*)::int INTO v_duplicate_customers
    FROM (
      SELECT stripe_customer_id
        FROM public.user_profiles
       WHERE stripe_customer_id IS NOT NULL
       GROUP BY stripe_customer_id
      HAVING count(*) > 1
    ) duplicate_groups;

  IF v_blank_subscriptions > 0 OR v_duplicate_subscriptions > 0
     OR v_blank_customers > 0 OR v_duplicate_customers > 0 THEN
    RAISE EXCEPTION
      'billing identity preflight failed (blank_subscription_rows=%, duplicate_subscription_groups=%, blank_customer_rows=%, duplicate_customer_groups=%)',
      v_blank_subscriptions, v_duplicate_subscriptions, v_blank_customers, v_duplicate_customers;
  END IF;
END;
$$;

SELECT 'WEBHOOK SNAPSHOT IDENTITY PREFLIGHT PASSED' AS result;
