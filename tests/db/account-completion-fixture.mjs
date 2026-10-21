// Actual migration chain. Fixture Auth/signup/storage/usage are explicitly bounded.
import assert from 'node:assert/strict';
import { pendingBootstrap, closureMigration } from './account-closure-pending-fixture.mjs';

export const recordingChain = [
  '20260801000000_sessions_transcript_state.sql',
  '20260803000000_transcript_retention_newest_two.sql',
  '20260731120000_session_progress_evaluations.sql',
  '20260804000000_transcript_retention_converge_on_save.sql',
  '20260805000000_transcript_retention_preflight.sql',
  '20260819120000_complete_session_v2_atomic_retention_1314.sql',
  '20260908120000_transcript_retention_newest_one.sql',
  '20260607040000_active_recording_lease.sql',
  '20260923120000_one_active_engine_per_account_1476.sql',
  '20260926190000_session_product_marker_1258.sql',
  '20261019055102_account_pending_recording_admission_1643.sql',
  '20260530170000_ai_suggestion_daily_quota.sql',
  '20260910193000_ai_suggestion_authority_receipt.sql',
  '20261019202856_account_coaching_admission_1643.sql',
];

export function completionBootstrap() {
  const statements=[];
  const sql=text=>statements.push(text);
  sql(pendingBootstrap());
  const entitlement=closureMigration('20260812040000_thirty_day_trial_lifecycle_1282.sql')
    .match(/CREATE OR REPLACE FUNCTION public\.effective_subscription_tier\([\s\S]*?\$\$;/g);
  assert.equal(entitlement?.length,2);sql(`SET ROLE closure_owner; ${entitlement.join('\n')}`);
  // Same declared signup/storage/usage fixture boundaries as the accepted native recording proof.
  sql(`SET ROLE closure_owner;
    ALTER TABLE sessions ALTER COLUMN id SET DEFAULT gen_random_uuid(),
      ADD COLUMN created_at timestamptz DEFAULT now(),ADD COLUMN updated_at timestamptz,
      ADD COLUMN title text,ADD COLUMN transcript text,ADD COLUMN total_words int,ADD COLUMN duration int,
      ADD COLUMN filler_counts jsonb,ADD COLUMN filler_words jsonb,ADD COLUMN accuracy double precision,
      ADD COLUMN ground_truth text,ADD COLUMN engine text,ADD COLUMN idempotency_key uuid,
      ADD COLUMN engine_version text,ADD COLUMN model_name text,ADD COLUMN device_type text,
      ADD COLUMN expires_at timestamptz,ADD COLUMN status text,ADD COLUMN next_action_signal jsonb,
      ADD COLUMN status_reason text,ADD COLUMN clarity_score double precision,ADD COLUMN wpm double precision,
      ADD COLUMN pause_metrics jsonb,ADD COLUMN ai_suggestions jsonb,ADD COLUMN custom_words jsonb;
    CREATE TABLE tier_configs(tier_name text PRIMARY KEY,max_concurrent_sessions int);
    INSERT INTO tier_configs VALUES('pro',50),('free',1);
    CREATE TABLE usage_checkpoints(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),session_id uuid,user_id uuid,
      incremental_seconds int,engine_type text,created_at timestamptz DEFAULT now());
    CREATE FUNCTION update_user_usage(int,text,uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"success":true}'::jsonb $$;`);
  for(const file of recordingChain)sql(`SET ROLE closure_owner; ${closureMigration(file)}`);
  sql('SET ROLE closure_owner; SELECT activate_transcript_retention_newest_one();');
  return statements.join('\nRESET ROLE;\n')+'\nRESET ROLE;';
}
