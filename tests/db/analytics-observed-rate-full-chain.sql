-- Disposable full-schema postflight only. Own transaction always rolls fixtures back.
-- Expected rate comes from independently declared 2 fillers / 120 observed seconds = 1/min.
BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at)
VALUES('a1472000-0000-4000-8000-000000000001','full-chain-analytics@example.test',now());
INSERT INTO public.sessions(id,user_id,duration,total_words,filler_counts,status,engine,product)
VALUES
('a1472000-0000-4000-8000-000000000011','a1472000-0000-4000-8000-000000000001',60,12,'{}','completed','private','open_mic'),
('a1472000-0000-4000-8000-000000000012','a1472000-0000-4000-8000-000000000001',120,24,'{"um":2}','completed','private','open_mic');
SELECT set_config('request.jwt.claim.sub','a1472000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE got jsonb;
BEGIN
  got:=public.get_analytics_summary('a1472000-0000-4000-8000-000000000001');
  IF (got#>>'{overallStats,avgFillerWordsPerMin}')::numeric IS DISTINCT FROM 1
    OR (got#>>'{overallStats,fillerRateContributorCount}')::integer IS DISTINCT FROM 1
    OR (got#>>'{overallStats,totalSessions}')::integer IS DISTINCT FROM 2
    THEN RAISE EXCEPTION 'observed filler rate denominator/contributor mismatch'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(got#>'{overallStats,chartData}') row
      WHERE row->>'FW/min' IS NOT NULL)<>1 THEN
    RAISE EXCEPTION 'unmeasured empty map became measured zero chart evidence'; END IF;
  BEGIN
    PERFORM public.get_analytics_summary('a1472000-0000-4000-8000-000000000099');
    RAISE EXCEPTION 'other-account Analytics call unexpectedly authorized';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'Unauthorized: You can only access your own analytics.' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'ANALYTICS OBSERVED RATE FULL-CHAIN INVARIANTS PASSED';
