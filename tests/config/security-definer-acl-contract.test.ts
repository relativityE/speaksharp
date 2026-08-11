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

describe('#1261 source-only SECURITY DEFINER remediation', () => {
  it('revokes inherited and explicit API execution from all 16 exposed functions', () => {
    for (const signature of signatures) {
      expect(migration).toContain(
        `REVOKE EXECUTE ON FUNCTION public.${signature} FROM PUBLIC, anon, authenticated, service_role;`,
      );
    }
    expect(migration.match(/^REVOKE EXECUTE ON FUNCTION public\./gm)).toHaveLength(16);
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
    expect(alters).toHaveLength(10);
    for (const alter of alters) expect(alter).toMatch(/pg_temp;$/);
    expect(migration).toContain(
      'ALTER FUNCTION public.handle_new_user() SET search_path = public, auth, pg_temp;',
    );
  });

  it('ships an explicit incident rollback for every grant and path change', () => {
    expect(rollback).toContain('intentionally restores the insecure PUBLIC/anon exposure');
    expect(rollback.match(/^GRANT EXECUTE ON FUNCTION public\./gm)).toHaveLength(16);
    expect(rollback.match(/^ALTER FUNCTION public\./gm)).toHaveLength(10);
    for (const signature of signatures) {
      expect(rollback).toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO PUBLIC, anon, authenticated, service_role;`);
    }
  });

  it('runs falsification, positive/negative, rollback, and convergence proofs on PG 15/16/17', () => {
    expect(workflow).toContain("pg: ['15', '16', '17']");
    expect(workflow).toContain('FALSIFICATION — matrix must reject the exposed state');
    expect(workflow).toContain('Run positive and negative ACL/path proofs');
    expect(workflow).toContain('Apply rollback and prove restoration');
    expect(workflow).toContain('Reapply remediation and prove convergence');
    expect(workflow).toContain('retention-days: 30');
    expect(workflow).not.toContain('${{ secrets.');
    expect(workflow).not.toContain('SUPABASE_URL:');
  });
});
