-- Disposable provider-hook isolation on the actual118 baseline. Same service
-- role, transaction and PL/pgSQL exception shape as the later119 denial check.
-- No account mutation or application-function body participates in this call.
BEGIN;
SELECT 'CLOSURE_STAGE denial-control:start';
CREATE FUNCTION public.closure_proof_revoked_function() RETURNS void
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'revoked function body executed'; END $$;
REVOKE ALL ON FUNCTION public.closure_proof_revoked_function() FROM PUBLIC,anon,authenticated,service_role;
SET LOCAL ROLE service_role;
DO $$ BEGIN
  RAISE NOTICE 'CLOSURE_STAGE denial-control:service-role:start';
  BEGIN
    PERFORM public.closure_proof_revoked_function();
    RAISE EXCEPTION 'revoked function admitted service role';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'CLOSURE_STAGE denial-control:service-role:refused';
END $$;
RESET ROLE;
--117 already revokes this role's access to the real issuer;119 adds the
-- service-role denial. This reads no production state and must stay disposable.
SET LOCAL ROLE anon;
DO $$ BEGIN
  RAISE NOTICE 'CLOSURE_STAGE denial-control:baseline-anon:start';
  BEGIN
    PERFORM public.issue_account_closure_token('c1111111-1111-4111-8111-111111111111',repeat('9',64));
    RAISE EXCEPTION 'legacy issue admitted anonymous role';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'CLOSURE_STAGE denial-control:baseline-anon:refused';
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'ACCOUNT CLOSURE DISPOSABLE DENIAL CONTROL PASSED';
