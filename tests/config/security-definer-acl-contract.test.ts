import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'backend/supabase/migrations/20260811143000_harden_exposed_security_definer_acl.sql',
  'utf8',
);
const rollback = readFileSync(
  'backend/supabase/rollbacks/20260811143000_harden_exposed_security_definer_acl.rollback.sql',
  'utf8',
);
const workflow = readFileSync('.github/workflows/security-definer-acl-matrix.yml', 'utf8');

const signatures = [
  'has_objective_capability()',
  'objective_start_session_v1(uuid, uuid, uuid, text, text, text)',
  'objective_finalize_evidence_v1(uuid, jsonb)',
  'objective_select_action_v1(uuid)',
  'objective_dispute_action_v1(uuid)',
  'objective_register_source_v1(uuid)',
  'acquire_recording_lease(uuid, text, boolean)',
  'heartbeat_recording_lease(uuid)',
  'release_recording_lease(uuid)',
  'update_user_usage(integer)',
  'cleanup_expired_sessions()',
  'expire_stale_sessions()',
  'redeem_promo(text, uuid)',
  'purge_derived_content_on_expire()',
  'handle_new_user()',
  'ensure_trial_profile_for_new_user()',
];

const hostedOnlySignatures = [
  {
    signature: 'redeem_promo(text, uuid)',
    regprocedure: 'public.redeem_promo(text,uuid)',
    safePath: 'public, pg_temp',
    rollbackPath: 'RESET search_path',
  },
  {
    signature: 'handle_new_user()',
    regprocedure: 'public.handle_new_user()',
    safePath: 'public, auth, pg_temp',
    rollbackPath: 'SET search_path = public, auth',
  },
];

const repositoryOwnedSignatures = signatures.filter(
  (signature) => !hostedOnlySignatures.some((hosted) => hosted.signature === signature),
);

describe('#1261 source-only SECURITY DEFINER remediation', () => {
  it('revokes inherited and explicit API execution from all 16 exposed functions', () => {
    for (const signature of repositoryOwnedSignatures) {
      const statement = `REVOKE EXECUTE ON FUNCTION public.${signature} FROM PUBLIC, anon, authenticated, service_role`;
      expect(migration).toContain(`${statement};`);
    }
    for (const hosted of hostedOnlySignatures) {
      const statement = `REVOKE EXECUTE ON FUNCTION public.${hosted.signature} FROM PUBLIC, anon, authenticated, service_role`;
      expect(migration).toContain(`EXECUTE '${statement}';`);
    }
    expect(migration.match(/^REVOKE EXECUTE ON FUNCTION public\./gm)).toHaveLength(14);
    expect(migration.match(/^ {4}EXECUTE 'REVOKE EXECUTE ON FUNCTION public\./gm)).toHaveLength(2);
    for (const hosted of hostedOnlySignatures) {
      expect(migration).toContain(`to_regprocedure('${hosted.regprocedure}') IS NOT NULL`);
    }
  });

  it('regrants only the evidenced authenticated and service callers', () => {
    expect(migration.match(/^GRANT EXECUTE ON FUNCTION public\./gm)).toHaveLength(10);
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.objective_register_source_v1(uuid) TO service_role;',
    );
    expect(migration).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.(cleanup_expired_sessions|expire_stale_sessions|redeem_promo|purge_derived_content_on_expire|handle_new_user|ensure_trial_profile_for_new_user)/,
    );
    expect(migration.match(/ TO service_role;/g)).toHaveLength(1);
    expect(migration.match(/ TO authenticated;/g)).toHaveLength(9);
  });

  it('sets exactly the ten exposed unsafe paths with pg_temp last', () => {
    const alters = migration.match(/^ALTER FUNCTION public\..* SET search_path = .*;$/gm) ?? [];
    expect(alters).toHaveLength(8);
    for (const alter of alters) expect(alter).toMatch(/pg_temp;$/);
    for (const hosted of hostedOnlySignatures) {
      expect(migration).toContain(
        `EXECUTE 'ALTER FUNCTION public.${hosted.signature} SET search_path = ${hosted.safePath}';`,
      );
    }
  });

  it('ships an explicit incident rollback for every grant and path change', () => {
    expect(rollback).toContain('intentionally restores the insecure PUBLIC/anon exposure');
    expect(rollback.match(/^GRANT EXECUTE ON FUNCTION public\./gm)).toHaveLength(14);
    expect(rollback.match(/^ {4}EXECUTE 'GRANT EXECUTE ON FUNCTION public\./gm)).toHaveLength(2);
    expect(rollback.match(/^ALTER FUNCTION public\./gm)).toHaveLength(8);
    expect(rollback.match(/^ {4}EXECUTE 'ALTER FUNCTION public\./gm)).toHaveLength(2);
    for (const signature of repositoryOwnedSignatures) {
      const statement = `GRANT EXECUTE ON FUNCTION public.${signature} TO PUBLIC, anon, authenticated, service_role`;
      expect(rollback).toContain(`${statement};`);
    }
    for (const hosted of hostedOnlySignatures) {
      const statement = `GRANT EXECUTE ON FUNCTION public.${hosted.signature} TO PUBLIC, anon, authenticated, service_role`;
      expect(rollback).toContain(`EXECUTE '${statement}';`);
      expect(rollback).toContain(`to_regprocedure('${hosted.regprocedure}') IS NOT NULL`);
      expect(rollback).toContain(
        `EXECUTE 'ALTER FUNCTION public.${hosted.signature} ${hosted.rollbackPath}';`,
      );
    }
  });

  it('runs falsification, positive/negative, rollback, and convergence proofs on PG 15/16/17', () => {
    expect(workflow).toContain("pg: ['15', '16', '17']");
    expect(workflow).toContain('FALSIFICATION — matrix must reject the exposed state');
    expect(workflow).toContain('Run positive and negative ACL/path proofs');
    expect(workflow).toContain('Apply rollback and prove restoration');
    expect(workflow).toContain('Reapply remediation and prove convergence');
    expect(workflow).toContain('Prove fresh-chain replay without hosted-only functions');
    expect(workflow).toContain('include_hosted_drift=false');
    expect(workflow).toContain('security-definer-acl-fresh-chain-matrix.sql');
    expect(workflow).toContain('security-definer-acl-fresh-chain-rollback-matrix.sql');
    expect(workflow).toContain('FRESH-CHAIN SECURITY DEFINER ACL MATRIX COMPLETE');
    expect(workflow).toContain('retention-days: 30');
    expect(workflow).not.toContain('${{ secrets.');
    expect(workflow).not.toContain('SUPABASE_URL:');
  });
});
