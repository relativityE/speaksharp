// Real Supabase-local schema proof in an isolated GitHub runner. No remote link,
// production credentials, provider call, baseline shim or skipped versioned migration.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { accountClosureEnforcementStages } from '../../scripts/lib/accountClosureEnforcementGate.mjs';
import { checkoutRejectionQuery, assertCheckoutRejection } from '../../scripts/lib/checkoutRejectionGate.mjs';
import { captureOwnedDatabaseDiagnostics, proofImageEvidence, proofPostgresImage, proofPostgresVersion, proofSubprocessFailure } from './account-closure-full-chain-diagnostics.mjs';

import { pathToFileURL } from 'node:url';
import { createNativeT2CatalogProof } from './t2-native-catalog-proof.mjs';
import { finalizeEditedTakeProof, runRequiredEditedTakeProof } from './retention-edited-take-full-chain.mjs';
import { T2_INVENTORY, T2_VERSIONS, t2CatalogQuery, t2ExpectedCatalog, assertT2Catalog,
  t2ReleaseLedgerQuery, t2ReleaseContract, t2ReleaseSnapshotQuery, assertT2ReleaseSnapshot } from '../../scripts/lib/t2MigrationPostflight.mjs';

// Separate post-C1 observations. The historical stage0..6 observer is unchanged.
// This uses the SAME contract/query/validator as the operational executable.
export function observeC1ReleaseCatalog({ sql, root, stage, retain }) {
  assert.ok([127, 128].includes(stage), 'unreviewed C1 release observation');
  const receipt = { stage, status: 'INCOMPLETE', negatives: [],
    scope: 'separate disposable native post-C1 release verification; no Production/apply/activation proof' };
  const save = () => retain(structuredClone(receipt));
  let contract;
  try {
  contract = t2ReleaseContract(root, sql(`BEGIN READ ONLY; ${t2ReleaseLedgerQuery()} COMMIT;`),
    { catalogContext: 'native-replay' });
  receipt.profile = contract.profile;
  receipt.sourcePins = contract.pins;
  receipt.knownAbsent = contract.knownAbsent;
  assert.equal(contract.profile, `post-${stage}`, 'native release stage/ledger differs');
  const rows = sql(t2ReleaseSnapshotQuery(contract)).trim().split('\n');
  receipt.rows = rows;
  save(); // Preserve the actual readback even when the next assertion fails.
  const verified = assertT2ReleaseSnapshot(contract, rows);
  const legacy = JSON.parse(sql(`BEGIN READ ONLY; SET LOCAL search_path=public,pg_temp;
    ${t2CatalogQuery(T2_INVENTORY)} COMMIT;`));
  assert.throws(() => assertT2Catalog(legacy, t2ExpectedCatalog('verify', 'release')),
    /T2 catalog mismatch: function:public.persist_ai_suggestion_with_authority_v1/,
    'the old126 verifier must reject the real127 permission tightening');
  const future = readFileSync(join(root, 'backend/supabase/migrations', contract.knownAbsent.file), 'utf8')
    .replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, '');
  const snapshotInTransaction = t2ReleaseSnapshotQuery(contract)
    .replace(/^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;/, '').replace(/COMMIT;\s*$/, '');
  receipt.absenceNegatives = [];
  for (const [name, mutation] of [
    ['actual129-without-ledger', future],
    ['known129-family-overload', 'CREATE FUNCTION public.settle_account_completion_billing_v1(text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;'],
  ]) {
    const changed = sql(`BEGIN; ${mutation}\n${snapshotInTransaction}\nROLLBACK;`).trim().split('\n');
    assert.throws(() => assertT2ReleaseSnapshot(contract, changed), /known129 function family/);
    receipt.absenceNegatives.push({ name, refused: true, rows: changed, rollback: true });
    save();
  }
  receipt.inheritedAclContexts = [];
  if (stage === 128) {
    const production = t2ReleaseContract(root, contract.ledger, { catalogContext: 'retained-production' });
    const progress = 'REVOKE EXECUTE ON FUNCTION public.record_progress_evaluation(uuid) FROM service_role;';
    const state = 'REVOKE EXECUTE ON FUNCTION public.sessions_set_transcript_state() FROM anon,authenticated,service_role;';
    // Fixture-only metadata reconstruction of the independently observed
    // retained ACLs. Never run against Production or alter migration sources.
    for (const [name, mutation, accepted] of [
      ['retained-production-pair', progress + state, true],
      ['mixed-progress-only', progress, false],
      ['mixed-state-only', state, false],
      ['retained-extra-role', progress + state + 'GRANT EXECUTE ON FUNCTION public.record_progress_evaluation(uuid) TO anon;', false],
      ['retained-grantable', progress + state + 'GRANT EXECUTE ON FUNCTION public.record_progress_evaluation(uuid) TO authenticated WITH GRANT OPTION;', false],
    ]) {
      const changed = sql(`BEGIN; ${mutation}\n${snapshotInTransaction}\nROLLBACK;`).trim().split('\n');
      let result;
      if (accepted) {
        result = assertT2ReleaseSnapshot(production, changed);
        assert.equal(result.catalogContext, 'retained-production');
      } else {
        assert.throws(() => assertT2ReleaseSnapshot(production, changed), /T2 catalog mismatch/);
      }
      assert.throws(() => assertT2ReleaseSnapshot(contract, changed), /T2 catalog mismatch/,
        'retained or mixed ACLs must not masquerade as the native profile');
      receipt.inheritedAclContexts.push({ name, accepted, result, rows: changed, rollback: true });
      save();
    }
    assert.throws(() => assertT2ReleaseSnapshot(production, rows), /T2 catalog mismatch/,
      'Production must not fall back to the complete native ACL pair');
  }
  const negatives = receipt.negatives;
  for (const [name, mutation] of [
    ['restored-service-execute', 'GRANT EXECUTE ON FUNCTION public.persist_ai_suggestion_with_authority_v1(uuid,uuid,jsonb,text,text,text,date,integer,integer) TO service_role'],
    ['changed-delete-guard-body', "CREATE OR REPLACE FUNCTION public.guard_unsettled_account_coaching_delete_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RETURN OLD; END $$"],
  ]) {
    // Mutation exists only inside this disposable rollback transaction. Retain
    // its actual readback, and assert refusal after the database has rolled back.
    const changed = JSON.parse(sql(`BEGIN; SET LOCAL search_path=public,pg_temp; ${mutation};
      ${t2CatalogQuery(contract.inventory)} ROLLBACK;`));
    assert.throws(() => assertT2Catalog(changed, contract.expected), /T2 catalog mismatch/);
    negatives.push({ name, refused: true, catalog: changed, rollback: true });
    save();
  }
  const restored = sql(t2ReleaseSnapshotQuery(contract)).trim().split('\n');
  assertT2ReleaseSnapshot(contract, restored);
  assert.deepEqual(restored, rows, 'disposable negative controls must restore the exact catalog/authority');
  Object.assign(receipt, { status: 'PASS', result: verified, legacy126Rejected: true, restored: true });
  save();
  return receipt;
  } catch (error) {
    receipt.status = 'FAIL'; receipt.reason = error.message;
    if (contract && receipt.rows && /^T2 catalog mismatch:/.test(error.message)) {
      try {
        receipt.expandedCatalog = JSON.parse(sql(`BEGIN READ ONLY; SET LOCAL search_path=public,pg_temp;
          ${t2ExpandedCatalogQuery(contract.inventory)} COMMIT;`));
      } catch (diagnosticError) { receipt.diagnosticError = diagnosticError.message; }
    }
    // Diagnostic/storage failure must not replace the original refusal.
    try { save(); } catch { console.warn('post-C1 failure receipt unavailable'); }
    throw error;
  }
}

// P5 diagnostic: the same catalog query with its three per-object md5 wrappers removed, so a mismatched pin can be
// compared field by field (names, types, constraints, policies, ACL roles; no rows). Diagnostic only — never a verdict.
export function t2ExpandedCatalogQuery(inventory) {
  const hashed = t2CatalogQuery(inventory);
  const wrappers = hashed.split('md5(').length - 1;
  assert.equal(wrappers, 3, `expected exactly 3 per-object md5 wrappers, found ${wrappers}`);
  return hashed.replaceAll('md5(', '(');
}

// Wraps the proof's record: on a pin mismatch, retain the un-hashed object for that key, then rethrow the ORIGINAL
// error. Neither a failing query nor a failing write may replace it (Sam RETURN on 40dfd6b7: the write sat outside
// the guard). Anything other than a pin mismatch is rethrown untouched, with no diagnostic.
export function withExpandedCatalogDiagnostic(record, { sql, write, inventory, warn = message => console.error(message) }) {
  return stage => {
    try {
      return record(stage);
    } catch (error) {
      const key = /^T2 catalog mismatch: (.+)$/.exec(error instanceof Error ? error.message : '')?.[1];
      if (key) {
        let diagnostic;
        try {
          const expanded = JSON.parse(sql(`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=public,pg_temp;
${t2ExpandedCatalogQuery(inventory)}
COMMIT;`));
          diagnostic = { stage, key, object: key in expanded ? JSON.parse(expanded[key]) : null };
        } catch (diagnosticError) {
          diagnostic = { stage, key, object: null, diagnosticError: String(diagnosticError?.message ?? diagnosticError).slice(0, 300) };
        }
        try {
          write(diagnostic);
        } catch (writeError) {
          try {
            warn(`T2 expanded catalog diagnostic not retained: ${String(writeError?.message ?? writeError).slice(0, 200)}`);
          } catch { /* A failing warning must not mask the mismatch either. */ }
        }
      }
      throw error;
    }
  };
}

/** Frozen independently reviewed main99585 + optional U1 bytes. No directory-driven profile selection. */
export const MAIN_MIGRATION_SNAPSHOT = Object.freeze([
  {
    "name": "20250811062708_initial_schema.sql",
    "version": "20250811062708",
    "sha256": "1b0d1e5b9ef7c56967072ed5ad5fdb0c9744e97a23570b02fc047ca9dc0c9d2b"
  },
  {
    "name": "20250812032300_update_usage_tracking.sql",
    "version": "20250812032300",
    "sha256": "acbb87455cb704382fed9b7dd1616a3cd79d441896a5257d2093cb3976f6e605"
  },
  {
    "name": "20250819072116_add_accuracy_to_sessions.sql",
    "version": "20250819072116",
    "sha256": "b9216a75eb301206fc5b16aa630690d4b4c017a6ddc90c0d6b9a983df0e59291"
  },
  {
    "name": "20250825065500_fix_rls_performance_issue.sql",
    "version": "20250825065500",
    "sha256": "c88c090c7ae0c620e1f6cf19e3a4d5f8809a6d7129e296093bf15b6287a8971b"
  },
  {
    "name": "20250825065700_add_index_to_sessions_user_id.sql",
    "version": "20250825065700",
    "sha256": "0b854508a939177efe2f315caf06b9e38a2bd89653d94b4178074eab5e944752"
  },
  {
    "name": "20250825101500_fix_rls_performance_on_user_profiles.sql",
    "version": "20250825101500",
    "sha256": "fe34b1606f46c4f9aa61f0972b32143e0fe5fe7658de8853249c14ae726ca756"
  },
  {
    "name": "20250825101501_set_search_path_for_update_user_usage.sql",
    "version": "20250825101501",
    "sha256": "2f29f151826d02b829b618c6e7fa791e4c9ebad061f9daf4a9081252b6131184"
  },
  {
    "name": "20250925071946_add_ground_truth_to_sessions.sql",
    "version": "20250925071946",
    "sha256": "d2fb7ec061099b78bd51408bca300e0ebd56cfd769b3283c423a5b9e43f9bbba"
  },
  {
    "name": "20251120004400_custom_vocabulary.sql",
    "version": "20251120004400",
    "sha256": "b022c6a96deedd1f91cbb4f8c8bf7391f21e3f6210cd37acb678d76943e20291"
  },
  {
    "name": "20251206000000_user_goals.sql",
    "version": "20251206000000",
    "sha256": "b1bbf88b65bf969040c6ea68c54f2f2ac36e8b9aab4a7d2e51600ba8695294c4"
  },
  {
    "name": "20251211000000_check_usage_limit.sql",
    "version": "20251211000000",
    "sha256": "e2a959c40785fef30414d6af1962bd918a14c2096ec887f36efa7787a874de98"
  },
  {
    "name": "20251217_add_webhook_idempotency.sql",
    "version": "20251217",
    "sha256": "35e385c16537dd4d157855e8e4362fee8ed15d8d104247a3d10b9b3354324ffb"
  },
  {
    "name": "20251219000000_sync_contract.sql",
    "version": "20251219000000",
    "sha256": "4a2a40e8e71a32c6ac62c22ed0e943ca86a3abb0f29f9e6c7d35a3403b3d37c3"
  },
  {
    "name": "20251219150000_fix_service_role_permissions.sql",
    "version": "20251219150000",
    "sha256": "aa2a7dfc068749292343d554913b25403f67d57d6f75c881fcf8e7fcbf780efb"
  },
  {
    "name": "20251231000000_reconcile_historical_entitlement_migration.sql",
    "version": "20251231000000",
    "sha256": "1860398b96a944e26e751cb2a5debcb33b4e18c3c30d9000040c9b2c0eb1a0d0"
  },
  {
    "name": "20251231010000_reconcile_historical_code_migration.sql",
    "version": "20251231010000",
    "sha256": "1860398b96a944e26e751cb2a5debcb33b4e18c3c30d9000040c9b2c0eb1a0d0"
  },
  {
    "name": "20260103170500_rename_custom_vocabulary.sql",
    "version": "20260103170500",
    "sha256": "f7f5473264396c6ccc859c8eb031f4c64b3275b426841207c683f0df9027a439"
  },
  {
    "name": "20260116000000_baseline.sql",
    "version": "20260116000000",
    "sha256": "d38171cb0390905feeab4d5a8bfee6a461cce6dcd20d7f3744743ca94d90f4ee"
  },
  {
    "name": "20260116123000_fix_user_goals_rls.sql",
    "version": "20260116123000",
    "sha256": "aaa8cbbb3716bb38d53ccc8bb2329aa959c27da7bee539d8c44f0beeb5fab4b8"
  },
  {
    "name": "20260126000000_reload_schema.sql",
    "version": "20260126000000",
    "sha256": "4c778244a95d19603d0b04370755fd83896858084c762bd80a3aeee57c99c868"
  },
  {
    "name": "20260131164947_reconcile_historical_redemption_migration.sql",
    "version": "20260131164947",
    "sha256": "1860398b96a944e26e751cb2a5debcb33b4e18c3c30d9000040c9b2c0eb1a0d0"
  },
  {
    "name": "20260131175500_get_user_id_by_email.sql",
    "version": "20260131175500",
    "sha256": "d0a183085193248368ab9709b3060297cc2fd4a44e636b279d73ece9dd3cf33b"
  },
  {
    "name": "20260212000000_database_hardening.sql",
    "version": "20260212000000",
    "sha256": "7c4c3872f207d725fc1d35a3407746d89daacbf7ca7524ad96570c78346b44d8"
  },
  {
    "name": "20260213000000_analytics_rpc.sql",
    "version": "20260213000000",
    "sha256": "0b485ca874665dee2545e3be209b74f1f516e98e30fac320033ee7ff596fc752"
  },
  {
    "name": "20260213000001_restore_tier_limits.sql",
    "version": "20260213000001",
    "sha256": "4329b7af32d021a1afd6eed7b1f8424e9be7d2a6561fe0b7c9df609b7914ede9"
  },
  {
    "name": "20260214000000_optimize_session_queries.sql",
    "version": "20260214000000",
    "sha256": "d92396839f2f0a0d07f7ec2e681e8355285f360fa344b0017a51de457af0775c"
  },
  {
    "name": "20260221213044_add_ai_suggestions_to_sessions.sql",
    "version": "20260221213044",
    "sha256": "0aa426f3a390edf50b109344dd0caca29fc4d8e4727ffb10b996f2639257ba07"
  },
  {
    "name": "20260222195500_add_updated_at_to_profiles.sql",
    "version": "20260222195500",
    "sha256": "83a9d23437852aa7f4f307e592d013bc0da5b0daaaec32a4a497885b79950af5"
  },
  {
    "name": "20260224000000_usage_tier_refactor.sql",
    "version": "20260224000000",
    "sha256": "b6c42d79dd18bc42e9de0ed5868c57268a239acfe7c2c0adc022ea0157555753"
  },
  {
    "name": "20260309000000_phase2_integration.sql",
    "version": "20260309000000",
    "sha256": "d5bd5106e2a9e41e34835f3e4ee135b42972eb87987d50dbc730f576b96946d7"
  },
  {
    "name": "20260309010000_session_cleanup_worker.sql",
    "version": "20260309010000",
    "sha256": "3011efb70cf1aa42d859029fd6605e729d589dd304ed6567ae853d5a8adf27a1"
  },
  {
    "name": "20260310000000_stripe_webhook_rpc.sql",
    "version": "20260310000000",
    "sha256": "1af091aaf259780cce8437d66ef417cee5e13d20be848c975c5c7c32989c916a"
  },
  {
    "name": "20260324000000_finalize_session_failed.sql",
    "version": "20260324000000",
    "sha256": "fc3dfb60af0db0e02acffc9420b0c75a56b57448ec0261c3663b87fe7f7795ee"
  },
  {
    "name": "20260325000000_fail_closed_usage_guards.sql",
    "version": "20260325000000",
    "sha256": "5dd12455411e7952cc0028340ef5fc39ee3b61b49541ef38e821bc2efb021f48"
  },
  {
    "name": "20260325010000_reconcile_historical_attempts_migration.sql",
    "version": "20260325010000",
    "sha256": "1860398b96a944e26e751cb2a5debcb33b4e18c3c30d9000040c9b2c0eb1a0d0"
  },
  {
    "name": "20260326000000_session_analysis_snapshot.sql",
    "version": "20260326000000",
    "sha256": "35d8ca22a2e844e8203cb9992ec381e41c969599cd2fd0943ea0e93b5db9df99"
  },
  {
    "name": "20260508000000_reconcile_historical_one_time_migration.sql",
    "version": "20260508000000",
    "sha256": "1860398b96a944e26e751cb2a5debcb33b4e18c3c30d9000040c9b2c0eb1a0d0"
  },
  {
    "name": "20260509000000_allow_private_engine_for_pro.sql",
    "version": "20260509000000",
    "sha256": "a482d0e0ddb0d5a4b95f2d61218173bf9bf6940132862cc31cc0a6c9c3f46e08"
  },
  {
    "name": "20260509010000_reconcile_historical_effective_tier_migration.sql",
    "version": "20260509010000",
    "sha256": "1860398b96a944e26e751cb2a5debcb33b4e18c3c30d9000040c9b2c0eb1a0d0"
  },
  {
    "name": "20260510080000_harden_user_filler_words.sql",
    "version": "20260510080000",
    "sha256": "631e2ae98e15e273ad2bd29056991afee5c8189d8449e8029fdf2109c7e56026"
  },
  {
    "name": "20260511100000_expire_stale_active_sessions.sql",
    "version": "20260511100000",
    "sha256": "7107ef61a04e8f5a4ae63919b00e77cc5461fb3229ba756400533cd9127b7556"
  },
  {
    "name": "20260521000000_basic_tier_cutover.sql",
    "version": "20260521000000",
    "sha256": "b3c6eb720cafab3b582f0a90f3e72beb7aed0f54c1c6f8e93ebba5e98e0fce1b"
  },
  {
    "name": "20260521100000_auto_trial_entitlements.sql",
    "version": "20260521100000",
    "sha256": "9df4f81bb860701f6d0bfd48963a4ad989b48a28d09140d226123f55e51df668"
  },
  {
    "name": "20260522090000_harden_runtime_billing_invariants.sql",
    "version": "20260522090000",
    "sha256": "30f3322a501d505154e2ab5a553f1a401a14af2b6ed7db13b703ae61d8e8d9ee"
  },
  {
    "name": "20260522100000_secure_system_tables_and_extend_trials.sql",
    "version": "20260522100000",
    "sha256": "c72741138f91d52a343a296e196f3d5684f6b53b3ae2433b4f91830735495d33"
  },
  {
    "name": "20260522110000_cleanup_stale_schema_lint.sql",
    "version": "20260522110000",
    "sha256": "f530a5ae7a502d38ba3c74a64037253a38cb4a7fc24b5c98a648974796119e45"
  },
  {
    "name": "20260522120000_drop_stale_session_rpc_overloads.sql",
    "version": "20260522120000",
    "sha256": "717d910371b684a4014152e08f294a90ce270a33f4454dfc3a8fadec76ab4d62"
  },
  {
    "name": "20260522130000_plan_aware_stripe_billing.sql",
    "version": "20260522130000",
    "sha256": "532557cb11bd2fcbd3f5361fb16efec2e8435e7909a70213eef067cf7e26449e"
  },
  {
    "name": "20260527162000_restore_free_user_type.sql",
    "version": "20260527162000",
    "sha256": "f4813c871e05e6df1bcfcd6196df1faef5c358c200ad069e5bb5d3e9ee911859"
  },
  {
    "name": "20260528183000_remove_free_to_basic_usage_mutation.sql",
    "version": "20260528183000",
    "sha256": "80d2f8f77878aba331433857fa8f7353709ba9ff455aa6440535d7eadec2ba21"
  },
  {
    "name": "20260528184500_restore_one_hour_trial_window.sql",
    "version": "20260528184500",
    "sha256": "3a6feb13715e9047c1106cf96fb5ed3cf4645f96806c7db4ad061c57f2f1b625"
  },
  {
    "name": "20260529183000_ack_unknown_stripe_downgrades.sql",
    "version": "20260529183000",
    "sha256": "14c3081b81c64827ec653450bf444e4207364bfd0e744ab181a0660d34e5e023"
  },
  {
    "name": "20260529233500_accept_downgrade_to_free_webhook_action.sql",
    "version": "20260529233500",
    "sha256": "f58f7844ae223e009539889e8d27a8cc41df0034d051be54e77cd2e66baccab4"
  },
  {
    "name": "20260530102000_grant_authenticated_sessions_access.sql",
    "version": "20260530102000",
    "sha256": "44d75e9274b131d6c57cb3db810bf8b2420c7c11770f74e36b1bb82ce365cd7f"
  },
  {
    "name": "20260530103000_normalize_basic_to_free_for_launch.sql",
    "version": "20260530103000",
    "sha256": "cdd47b3acad2a402c79c419fd324fcbe57d82667e238e03bb92dd98a1e9ae7b9"
  },
  {
    "name": "20260530170000_ai_suggestion_daily_quota.sql",
    "version": "20260530170000",
    "sha256": "3acb90fd5252ec5974e9c31d6631c1384e826bcb2d6c46e5241cfd88438c6543"
  },
  {
    "name": "20260603000000_formatter_daily_quota.sql",
    "version": "20260603000000",
    "sha256": "01ca696459659226bc73ff0271f7ce6b323b1783625c683e2f54fe7cf0e7860f"
  },
  {
    "name": "20260605080000_user_issue_reports.sql",
    "version": "20260605080000",
    "sha256": "d6b76adde5f3c16854b9a406f2ad0cb4c9c0cd3b3c73586808ac2c996c4f83da"
  },
  {
    "name": "20260605120000_user_issue_reports_optional_user.sql",
    "version": "20260605120000",
    "sha256": "fd4c3a4de0f1c709b62d0dd23ee776645bd0cfd4a34ee88482341b0749e324ce"
  },
  {
    "name": "20260607023000_grant_issue_report_insert.sql",
    "version": "20260607023000",
    "sha256": "b0af73b129b7c0160afbf774b30adf6192d2002690339b08684f866bec164962"
  },
  {
    "name": "20260607040000_active_recording_lease.sql",
    "version": "20260607040000",
    "sha256": "422880e3f25dadd7eaa595d275233e2c7620686dd8f09ee8294a012069abb399"
  },
  {
    "name": "20260608190000_store_stripe_customer_id_in_webhook.sql",
    "version": "20260608190000",
    "sha256": "732e9312eff77d0a900bad80e91da940e6c0d85d9a4e44727faf7ac2bf2dc6d7"
  },
  {
    "name": "20260610143000_private_sample_entitlement.sql",
    "version": "20260610143000",
    "sha256": "1da43ac08b79513506b3f3a0570c76b0b1f71d08db6677bc44cd92ddb92a29b8"
  },
  {
    "name": "20260610210500_fix_private_sample_session_fk_order.sql",
    "version": "20260610210500",
    "sha256": "d34c7f85dd86e5bc4d0ddf74a09da4469f2a09904c4c4cfeda6af88cb6d2245e"
  },
  {
    "name": "20260612120000_audit_index_hygiene.sql",
    "version": "20260612120000",
    "sha256": "2d916cba845e63fa43467fdfd6929b4edc00c380f9c5351b460ee5abe4414726"
  },
  {
    "name": "20260612205224_add_trial_entitlements_user_id_index.sql",
    "version": "20260612205224",
    "sha256": "e2e4db5c0e6c8226b83cac3f48e020436d738f2fb4313b21ed097d5597e385b5"
  },
  {
    "name": "20260613100000_drop_redundant_trial_entitlements_index.sql",
    "version": "20260613100000",
    "sha256": "2844eb8dd32cdd20cec155f87fac26ae37bea0aef8283b0606135859c7f4271e"
  },
  {
    "name": "20260619170000_burn_private_sample_on_downgrade.sql",
    "version": "20260619170000",
    "sha256": "4f17974d6a612e2fde756504d49cc8d89595798a5524ee1bbcf092c53779d1b2"
  },
  {
    "name": "20260621120000_deprecate_legacy_subscription_id_entitlement.sql",
    "version": "20260621120000",
    "sha256": "21cba0ef8dfef071ef1def3d16464dd611e4fd972ed171e9348ca1a89ff9614c"
  },
  {
    "name": "20260625120000_usage_checkpoints_user_id_on_delete_cascade.sql",
    "version": "20260625120000",
    "sha256": "04bf77924dde043c79ed4534bc49ff2546c2884486627d7b2e8adc2b3edde124"
  },
  {
    "name": "20260710000000_user_issue_reports_category_slugs.sql",
    "version": "20260710000000",
    "sha256": "012ec075256ffa6b7b1b72f6f302c9489a6441e83e357489b69bdd78e3d2660c"
  },
  {
    "name": "20260714000000_harden_get_user_id_by_email_grant.sql",
    "version": "20260714000000",
    "sha256": "a52ee31c78e6a2ec5b6298d894288f1f01f1d92d2df3abfad9f921fa23e42042"
  },
  {
    "name": "20260721130000_report_session_ownership_guard.sql",
    "version": "20260721130000",
    "sha256": "07f0a729a0b0c10e96e17ca82cff293bbf5975fafa481d3cc06594a80daff75a"
  },
  {
    "name": "20260724220000_sessions_attribution_status.sql",
    "version": "20260724220000",
    "sha256": "576b147cf61f37b07d7ca69de33c42b069036f51dc9681e296d914546ad0b856"
  },
  {
    "name": "20260727180000_guided_waitlist.sql",
    "version": "20260727180000",
    "sha256": "373834c57180af3bc766881b757514dd42ff3d37701d2d021ecdf6a3890298ae"
  },
  {
    "name": "20260729120000_secure_get_analytics_summary_authz.sql",
    "version": "20260729120000",
    "sha256": "66c6320469ff524c7ca76252a69d407fd163bdf125bab6a06ceebb82171eae45"
  },
  {
    "name": "20260729130000_analytics_summary_evidence_validity.sql",
    "version": "20260729130000",
    "sha256": "dc0fc0c743db43bbe00bb95c8210209e96789da71efaf213851c5b8a35e5e8aa"
  },
  {
    "name": "20260730000000_practice_streak.sql",
    "version": "20260730000000",
    "sha256": "309ed55e7103799ff7fda0c5f876f3c106710e99d9fe3c697be3a0567864210f"
  },
  {
    "name": "20260731120000_session_progress_evaluations.sql",
    "version": "20260731120000",
    "sha256": "c5ebe8354c9b949045229d668197ebfe875c56204703382191a90a378fe9672f"
  },
  {
    "name": "20260731130000_progress_recommendations.sql",
    "version": "20260731130000",
    "sha256": "a4c0d2f0fccab9601e6d7b79f367d017ee74cedcaeda7ef865b4b65c0203f169"
  },
  {
    "name": "20260801000000_sessions_transcript_state.sql",
    "version": "20260801000000",
    "sha256": "26ce24aa2d81d2cb4a1ff8fb6cee716485262b395f59354dd2528ae28356aba5"
  },
  {
    "name": "20260801010000_analytics_summary_transcript_provenance.sql",
    "version": "20260801010000",
    "sha256": "28dd0a1b4b0f6ed67db1928fc81dfb4b3fb881667b83ed25dcc47b0216d38438"
  },
  {
    "name": "20260802000000_guided_g1_foundation.sql",
    "version": "20260802000000",
    "sha256": "800f3043f54efdda22640ab230d61a7877cf3891488371ec693f1d0b9bdbf093"
  },
  {
    "name": "20260803000000_transcript_retention_newest_two.sql",
    "version": "20260803000000",
    "sha256": "23212b6a2f182d27584737462155989bb4ac5226727d7585041573ada4d12feb"
  },
  {
    "name": "20260803010000_session_attribution_authority.sql",
    "version": "20260803010000",
    "sha256": "160ae17bc7740123da38db53bdf413a97fcb962fc6d92013e024eca0d03704be"
  },
  {
    "name": "20260804000000_transcript_retention_converge_on_save.sql",
    "version": "20260804000000",
    "sha256": "f5fec625a626f00d93efd51e06d333dbb3b71f514f200df05716d0227dcf3710"
  },
  {
    "name": "20260805000000_transcript_retention_preflight.sql",
    "version": "20260805000000",
    "sha256": "4af2eec87fd344b13215ef3bec056f9f0f5f52ce1f909df2673f084f92fe547a"
  },
  {
    "name": "20260806000000_attest_drop_unused_var.sql",
    "version": "20260806000000",
    "sha256": "bcf69bf6eba32adb9e1c1e0b9d88db9923fd2d8b1e08efd614711a5df3670b29"
  },
  {
    "name": "20260807000000_rename_guided_to_objective.sql",
    "version": "20260807000000",
    "sha256": "f1d540cd2529c3a38cab427b0c15194091b03d48148218728534163c19fc41d1"
  },
  {
    "name": "20260807010000_issue_objective_brief.sql",
    "version": "20260807010000",
    "sha256": "cbd1a78521d4265e0f1335749f5b86bcf44584ac1c7ffa6ea9ba9cad358779a1"
  },
  {
    "name": "20260809000000_focus_points_pro_capability.sql",
    "version": "20260809000000",
    "sha256": "2e909d1395e541f3e739798a63be8062a43d8eeb730fea13c08e5ad253fb936e"
  },
  {
    "name": "20260810120000_retention_purge_ai_suggestions.sql",
    "version": "20260810120000",
    "sha256": "00fe3d3b5ed73fc7d0bd2aac6f37c71016f19e77c6757e606bc48ebeb51c72b7"
  },
  {
    "name": "20260811143000_harden_exposed_security_definer_acl.sql",
    "version": "20260811143000",
    "sha256": "fd5eaa15dc27f66aa488da76a48bd00e3f1156a2759a3355609f1fa6eef79d2f"
  },
  {
    "name": "20260812002000_webhook_lifecycle_completeness_1282.sql",
    "version": "20260812002000",
    "sha256": "e2e77217547100158d4324c29feafaa2d6ecd3462b96add3b0e9002b0d923a13"
  },
  {
    "name": "20260812030000_progress_cohort_mode_separation_1265.sql",
    "version": "20260812030000",
    "sha256": "deeb6845ff26a1bafbfdb3751727eea723625a00ff29d4829618e4b58106f5fa"
  },
  {
    "name": "20260812039500_webhook_duplicate_snapshot_convergence_1282.sql",
    "version": "20260812039500",
    "sha256": "149bc20af04573c4ee48d1f9bf272a824e47b7d6b6c4d3582c10bfb2bedd7045"
  },
  {
    "name": "20260812040000_thirty_day_trial_lifecycle_1282.sql",
    "version": "20260812040000",
    "sha256": "4377bcb2f899e106e977ed49baffc9eae77cec0bdec1e2167e003bad260c70ef"
  },
  {
    "name": "20260812041000_trial_expiry_fail_closed_1282.sql",
    "version": "20260812041000",
    "sha256": "695a9384b33f564c4318360daceb5b7d06a6eb6da96d1e7feedb3256fc647753"
  },
  {
    "name": "20260812041500_flawless_launch_runtime_convergence_1290.sql",
    "version": "20260812041500",
    "sha256": "0e717335be6cb59265754e513fc6b6934cfc1eabba6ff6d2127ec9564771122b"
  },
  {
    "name": "20260812041600_trial_commercial_grant_on_conflict_1294.sql",
    "version": "20260812041600",
    "sha256": "76188035d2b050aa4bcd4cf4753fa86d1cc030a12f371f05c9c143378beff030"
  },
  {
    "name": "20260812042000_trial_activation_stamp_1282.sql",
    "version": "20260812042000",
    "sha256": "41f10614d396769f49236cb355205e80122a969d1784f803d5b127ab8e5cb181"
  },
  {
    "name": "20260816223606_metrics_only_additive_1306.sql",
    "version": "20260816223606",
    "sha256": "a588c730862e2f6cfbf4361bc288eb8b070deee155bda07e92064bcae961b814"
  },
  {
    "name": "20260817140000_repoint_analytics_summary_flat_1306.sql",
    "version": "20260817140000",
    "sha256": "e9187f589c4aa2e8ccb83429fb942fb70250538cb071e08408294cce6fbf747f"
  },
  {
    "name": "20260819120000_complete_session_v2_atomic_retention_1314.sql",
    "version": "20260819120000",
    "sha256": "da6392389dc74ab1d7cf06ca9326a089d565eff497745473ab61379d7dd5c41e"
  },
  {
    "name": "20260829120000_retire_complete_session_v1_1306.sql",
    "version": "20260829120000",
    "sha256": "db760dad491ea52330cf3e99dd7e9ea78d6277c1e4ef9d8b29d51d7168f23ee9"
  },
  {
    "name": "20260903140000_feedback_kind_severity_contract.sql",
    "version": "20260903140000",
    "sha256": "8a68268063b571e839bfd59c6783107713475f9225a4b26ad27b2584d3abbf85"
  },
  {
    "name": "20260904150000_share_feedback_redesign.sql",
    "version": "20260904150000",
    "sha256": "024a5424770e60000dd58a2bb05f1b0ab28901bb56f407230959eb961e6d49e6"
  },
  {
    "name": "20260908120000_transcript_retention_newest_one.sql",
    "version": "20260908120000",
    "sha256": "784e7f67be64017f9fd73871107d7e0735db97010bf6e36c08ce16f4376ff412"
  },
  {
    "name": "20260910193000_ai_suggestion_authority_receipt.sql",
    "version": "20260910193000",
    "sha256": "85bbae6d2b3e69921b1b8419c8de9d6ce0d0f0dddfd7632bb9d04d30a3d49701"
  },
  {
    "name": "20260914214307_objective_eligibility_reads_attribution_authority.sql",
    "version": "20260914214307",
    "sha256": "bdef62768ac61a3c10cac141aa80bcd248cd5ad9f24b0d96cf573cc1b6321e7c"
  },
  {
    "name": "20260923120000_one_active_engine_per_account_1476.sql",
    "version": "20260923120000",
    "sha256": "94c92e280285816287de54e48e6ec393b16fe0fe54126b7ca5a3b964015b3e5f"
  },
  {
    "name": "20260924150000_progress_evaluation_filler_counts_authority_1471.sql",
    "version": "20260924150000",
    "sha256": "d080925041c90fd909ce926a76a2fb2c54dd93d037467b88aa43026205c4c921"
  },
  {
    "name": "20260926190000_session_product_marker_1258.sql",
    "version": "20260926190000",
    "sha256": "b576f0d888fde0217911f9022c2dad4710e2314a6cb963344c6cfa8e11da101f"
  },
  {
    "name": "20260928120000_focus_points_trial_capability.sql",
    "version": "20260928120000",
    "sha256": "c96f5a67027c184a904578f7e4e7d3166a26253faa70e149d7347939c6495350"
  },
  {
    "name": "20261013120000_retention_expiry_without_superuser_1258.sql",
    "version": "20261013120000",
    "sha256": "a00a578f0d474bf319b05cf9dc6f64a205bb366959dbb8ee033db75880477adb"
  },
  {
    "name": "20261013140000_retention_expiry_typed_empty_array_1258.sql",
    "version": "20261013140000",
    "sha256": "a0116bf92e81f0a87c7bbc2528f6cc60c78b2f32a55253fcf49bbadc5eb4c6b1"
  },
  {
    "name": "20261013180000_account_closure_tokens.sql",
    "version": "20261013180000",
    "sha256": "8647483f6ed72d99246c84cb2d07571c34c7a5393268f8acd505edf267b03688"
  },
  {
    "name": "20261016090000_account_closure_drain_persistence.sql",
    "version": "20261016090000",
    "sha256": "d8a5b1d153890167869b2e7d366fb1ae3dd1272a67cd26f3980e6d2cd5233145"
  },
  {
    "name": "20261016180000_account_closure_drain_enforcement.sql",
    "version": "20261016180000",
    "sha256": "2613a3921d084d008d18e94834c59d0764c108b38385afbcb280cd01760bdce1"
  },
  {
    "name": "20261017200000_checkout_rejection_recovery.sql",
    "version": "20261017200000",
    "sha256": "3f53ad3408a35af5cea6baac456e3b34ba433c7bd37d2c238e345df53fc05f6c"
  },
  {
    "name": "rotate_sessions.sql",
    "version": null,
    "sha256": "e8e15780608a7ebea33b7f13efa4d8e92650d36b5b69d2b2cacebcfdb51b3e85"
  },
  {
    "name": "test_usage_rpc.sql",
    "version": null,
    "sha256": "158a6a3c7ec1b45345c6c724629b6f495446a73cba6aed068bdaf6dd21873592"
  }
].map(row => Object.freeze(row)));
export const MAIN_U1_MIGRATION = Object.freeze({
  "name": "20261019010000_heartbeat_session_cap_keeps_take_open_1593.sql",
  "version": "20261019010000",
  "sha256": "df02b867f5a4f29ee207a8b4359a82bb3b27abefd9eabe2eb5cd9960b4f0fb45"
});
export const MAIN_ANALYTICS_MIGRATION=Object.freeze({
  name:'20261018090000_analytics_summary_observed_filler_rate_1472.sql',
  version:'20261018090000',sha256:'72299dacc4bf2986b7d7e37299608de64fada0e4e70ba22aba4cee6d058d519f',
});
export const MAIN_T2_ACCOUNT_MIGRATIONS=Object.freeze([
  {name:'20261018170000_account_closure_pending_checkout.sql',version:'20261018170000',sha256:'68eab9724083189f28eb7c048f259a80cedb9b3280801ee5f7b762c972f8dd19',stage:'account-pending'},
  {name:'20261019055102_account_pending_recording_admission_1643.sql',version:'20261019055102',sha256:'e1f0534de3ca9b8ce9af291903064a6cf7c9c220db3354ab851a21eb31bd8ac4',stage:'recording-admission'},
  {name:'20261019202856_account_coaching_admission_1643.sql',version:'20261019202856',sha256:'f4acb882ce9a5d259b02b349461667c0d6c7a1b6b2d6548f59599e44e53b812e',stage:'coaching-admission'},
  {name:'20261020230653_account_pending_completion_journal_1643.sql',version:'20261020230653',sha256:'76bffe1f7dc15efe487cd33faffbfd8d1b6c654a7b09508d427e53b4b88d83cf',stage:'account-completion'},
].map(row=>Object.freeze(row)));
// #1643 UNKNOWN-coaching fence: reviewed separately and staged after completion, never inside the 126 profile.
export const MAIN_T2_FENCE_MIGRATION=Object.freeze({name:'20261024083000_account_coaching_unknown_fence_1643.sql',
  version:'20261024083000',sha256:'29548e27a0b33a303ff093569097367b1227251faff7e7df77af392cfa4b0d14',stage:'coaching-unknown-fence'});
export const MAIN_T2_RETENTION_MIGRATION=Object.freeze({name:'20261025021046_content_free_retention_evidence.sql',
  version:'20261025021046',sha256:'37af792f8abeeb0e073e229ec25cd294a20050058632f793c4635ba3af37f47d',stage:'content-free-retention'});
// Independently reviewed corrected bytes (Sam); the historical 120..128 pins stay unchanged.
export const MAIN_COMPLETION_BILLING_MIGRATION=Object.freeze({name:'20261027192550_account_completion_billing_settlement.sql',
  version:'20261027192550',sha256:'398aa50b8db168acc0cee68a11a433b40bd3101af03e3051dcdc2c87b2bef45d',stage:'completion-billing'});
const BILLING_PROFILE='main-completion-billing-129';
const MAIN_PROFILES=['main-120','main-u1-121','main-analytics-u1-122','main-t2-account-126','main-t2-fence-127','main-t2-retention-128',BILLING_PROFILE];
const T2_PROFILES=['main-t2-account-126','main-t2-fence-127','main-t2-retention-128',BILLING_PROFILE];
function selectedAdditions(profile) {
  const rows=[...(profile!=='main-120'?[{...MAIN_U1_MIGRATION,stage:'heartbeat-u1'}]:[]),
    ...(['main-analytics-u1-122',...T2_PROFILES].includes(profile)?[{...MAIN_ANALYTICS_MIGRATION,stage:'analytics-observed-rate'}]:[]),
    ...(T2_PROFILES.includes(profile)?MAIN_T2_ACCOUNT_MIGRATIONS:[]),
    ...(['main-t2-fence-127','main-t2-retention-128',BILLING_PROFILE].includes(profile)?[MAIN_T2_FENCE_MIGRATION]:[]),
    ...(['main-t2-retention-128',BILLING_PROFILE].includes(profile)?[MAIN_T2_RETENTION_MIGRATION]:[]),
    ...(profile===BILLING_PROFILE?[MAIN_COMPLETION_BILLING_MIGRATION]:[])];
  return rows.sort((a,b)=>a.name.localeCompare(b.name,'en'));
}
const MAIN_DRAIN = '20261016180000_account_closure_drain_enforcement.sql';
const MAIN_RECOVERY = '20261017200000_checkout_rejection_recovery.sql';

export function parseMainProofArguments(args) {
  assert.ok(Array.isArray(args), 'proof arguments must be an array');
  const profiles = args.filter(arg => typeof arg === 'string' && arg.startsWith('--profile='));
  assert.ok(profiles.length <= 1, 'choose exactly one proof profile');
  for (const arg of args) assert.ok(arg === '--plan' || arg === '--cleanup' || profiles.includes(arg), 'unknown proof argument');
  const profile = profiles[0]?.slice('--profile='.length) ?? 'main-120';
  assert.ok(MAIN_PROFILES.includes(profile), 'unknown reviewed main proof profile');
  return { profile, plan: args.includes('--plan'), cleanup: args.includes('--cleanup') };
}

export function buildMainU1ReplayPlan(rows, profile = 'main-120') {
  assert.ok(MAIN_PROFILES.includes(profile), 'unknown reviewed main proof profile');
  assert.ok(Array.isArray(rows), 'migration manifest must be an array');
  const actual = rows.map(row => {
    assert.ok(row && typeof row === 'object' && !Array.isArray(row), 'migration row must be an object');
    assert.equal(typeof row.name, 'string', 'migration name missing');
    assert.match(row.sha256 ?? '', /^[a-f0-9]{64}$/, 'migration digest missing');
    const version = row.name.match(/^(\d{8}|\d{14})_.+\.sql$/)?.[1] ?? null;
    assert.ok(version || ['rotate_sessions.sql', 'test_usage_rpc.sql'].includes(row.name), 'unrecognized migration name');
    assert.equal(row.version, version, 'migration version does not match name');
    return { name: row.name, version, sha256: row.sha256 };
  }).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  assert.equal(new Set(actual.map(row => row.name)).size, actual.length, 'duplicate migration name');
  const versioned = actual.filter(row => row.version !== null);
  assert.equal(new Set(versioned.map(row => row.version)).size, versioned.length, 'duplicate migration version');
  const additions=selectedAdditions(profile);
  const expected = [...MAIN_MIGRATION_SNAPSHOT,...additions];
  const byName = new Map(expected.map(row => [row.name, row]));
  for (const row of actual) {
    assert.ok(byName.has(row.name), 'unreviewed migration requires an explicit updated baseline: ' + row.name);
    assert.equal(row.sha256, byName.get(row.name).sha256, 'reviewed migration digest changed: ' + row.name);
  }
  for (const row of expected) assert.ok(actual.some(value => value.name === row.name), 'reviewed migration missing: ' + row.name);
  const history = excluded => versioned.filter(row => !excluded.includes(row.name)).map(row => row.version);
  const late=[MAIN_U1_MIGRATION.name,MAIN_ANALYTICS_MIGRATION.name,...MAIN_T2_ACCOUNT_MIGRATIONS.map(row=>row.name),MAIN_T2_FENCE_MIGRATION.name,MAIN_T2_RETENTION_MIGRATION.name,MAIN_COMPLETION_BILLING_MIGRATION.name];
  const stages = [
    { name: 'baseline-before-drain', versions: history([MAIN_DRAIN, MAIN_RECOVERY, ...late]) },
    { name: 'drain-enforcement', versions: history([MAIN_RECOVERY, ...late]) },
    { name: 'checkout-rejection-recovery', versions: history(late) },
    ...additions.map((row,index)=>({name:row.stage,versions:history(additions.slice(index+1).map(item=>item.name))})),
  ];
  return { mode: 'PLAN_ONLY', profile, migrations: versioned.length,
    unversioned: actual.filter(row => row.version === null), stages, executed: false };
}

export function runMainClosureProof() {
  const args = parseMainProofArguments(process.argv.slice(2));
  const root = resolve('backend/supabase/migrations');
  const candidate = '20261016180000_account_closure_drain_enforcement.sql';
  const recovery = '20261017200000_checkout_rejection_recovery.sql';
  const postgresVersion = proofPostgresVersion(process.env.PROOF_POSTGRES_VERSION);
  const files = readdirSync(root).filter((file) => file.endsWith('.sql')).sort();
  assert.ok(files.includes(candidate), 'closure candidate missing');
  const manifest = files.map((name) => {
    const match = name.match(/^(\d{8}|\d{14})_.+\.sql$/);
    // Supabase ignores these existing unversioned scripts. Preserve them
    // in the snapshot and manifest; do not pretend it is a replayed migration.
    assert.ok(match || ['rotate_sessions.sql', 'test_usage_rpc.sql'].includes(name), `unrecognized migration name: ${name}`);
    return { name, version: match?.[1] ?? null, sha256: createHash('sha256').update(readFileSync(join(root, name))).digest('hex') };
  });
  const migrations = manifest.filter((row) => row.version !== null);
  assert.equal(new Set(migrations.map((row) => row.version)).size, migrations.length, 'duplicate migration versions');
  const plan = buildMainU1ReplayPlan(manifest, args.profile);
  const completeT2=T2_PROFILES.includes(args.profile);
  const billingT2=args.profile===BILLING_PROFILE;
  const retentionT2=args.profile==='main-t2-retention-128'||billingT2;
  const fenceT2=args.profile==='main-t2-fence-127'||retentionT2;
  const hasAnalytics=['main-analytics-u1-122',...T2_PROFILES].includes(args.profile);
  if (args.plan) {
    console.log(JSON.stringify({ ...plan, candidate: migrations.at(-1) }));
    process.exit(0);
  }
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'full-stack execution requires the disposable CI runner');
  assert.equal(process.env.DOCKER_HOST, 'unix:///var/run/docker.sock', 'remote Docker contexts are refused');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !key.startsWith('PG') && !key.startsWith('SUPABASE_') && !['DATABASE_URL', 'GITHUB_TOKEN', 'GH_TOKEN',
      'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'].includes(key)));
  // setup-cli uses the public GHCR mirror to avoid anonymous Docker Hub limits.
  // This is an image location, not a Supabase project or credential setting.
  env.SUPABASE_INTERNAL_IMAGE_REGISTRY = 'ghcr.io';
  const evidence = resolve('artifacts/account-closure-full-chain');
  mkdirSync(evidence, { recursive: true });
  const resourcesFile = join(evidence, 'resources.json');
  const editedTakeReceipt = join(evidence, 'retention-edited-take.json');
  const run = (bin, args, options = {}) => {
    const result = spawnSync(bin, args, { env, encoding: 'utf8', timeout: 12 * 60_000, maxBuffer: 8 * 1024 * 1024, ...options });
    if (result.error || result.status !== 0) {
      const diagnostic = proofSubprocessFailure(bin, args, result);
      const error = new Error(`${diagnostic.command} failed (status=${diagnostic.status}, signal=${diagnostic.signal}):\n`
        + `stdout:\n${diagnostic.stdout}\nstderr:\n${diagnostic.stderr}`);
      error.subprocess = diagnostic;
      throw error;
    }
    return result.stdout.trim();
  };
  const firewallArgs = (id, subnet) => ['DOCKER-USER', '-s', subnet, '!', '-d', subnet,
    '-m', 'comment', '--comment', id, '-j', 'DROP'];
  function cleanupOwned({ id, stage, networkName, subnet }) {
    assert.match(id, /^closure-proof-[a-f0-9]{16}$/);
    assert.equal(networkName, `${id}-internal`);
    assert.equal(resolve(stage).startsWith(`${resolve(process.env.RUNNER_TEMP)}/closure-chain-`), true);
    if (existsSync(stage)) run('supabase', ['stop', '--no-backup', '--workdir', stage]);
    if (subnet) {
      assert.match(subnet, /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/);
      const args = firewallArgs(id, subnet);
      const rule = spawnSync('sudo', ['iptables', '-w', '-C', ...args], { env, encoding: 'utf8' });
      if (rule.status === 0) run('sudo', ['iptables', '-w', '-D', ...args]);
      else assert.equal(rule.status, 1, 'cannot verify owned firewall teardown');
    }
    const networks = run('docker', ['network', 'ls', '--filter', `name=^${networkName}$`, '--format', '{{.Name}}']);
    if (networks) {
      const network = JSON.parse(run('docker', ['network', 'inspect', networkName]))[0];
      assert.equal(network.Labels['speaksharp.closure-proof'], id, 'cleanup ownership changed');
      run('docker', ['network', 'rm', networkName]);
    }
    const retained = run('docker', ['ps', '-a', '--filter', `name=_${id}$`, '--format', '{{.Names}}']);
    assert.equal(retained, '', 'owned containers remain after teardown');
    const volumes = run('docker', ['volume', 'ls', '--filter', `name=_${id}$`, '--format', '{{.Name}}']);
    assert.equal(volumes, '', 'owned volumes remain after teardown');
    rmSync(stage, { recursive: true, force: true });
  }
  if (args.cleanup) {
    if (existsSync(resourcesFile)) cleanupOwned(JSON.parse(readFileSync(resourcesFile, 'utf8')));
    process.exit(0);
  }
  writeFileSync(join(evidence, 'migration-manifest.json'), JSON.stringify(manifest, null, 2));
  const stage = mkdtempSync(join(process.env.RUNNER_TEMP, 'closure-chain-'));
  const id = `closure-proof-${randomBytes(8).toString('hex')}`;
  const networkName = `${id}-internal`;
  const containerName = `supabase_db_${id}`;
  writeFileSync(resourcesFile, JSON.stringify({ id, stage, networkName }));
  let primaryError;
  let cleanupError;
  let realSupabaseSchema = false;
  let nativeT2Catalog;
  let editedTakeReached = false;
  let subnet;
  const cli = (args) => run('supabase', [...args, '--workdir', stage]);
  const sql = (text) => run('docker', ['exec', '-i', containerName, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
    input: `SET statement_timeout='30s'; SET lock_timeout='5s';\n${text}`,
  });
  const history = () => sql('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;').split('\n');
  function verifyEnforcement(mode) {
    const source = (name) => readFileSync(join(root, name), 'utf8');
    const stages = accountClosureEnforcementStages(mode, { closure: source('20261013180000_account_closure_tokens.sql'),
      baseline: source('20260812041600_trial_commercial_grant_on_conflict_1294.sql'),
      drain: source('20261016090000_account_closure_drain_persistence.sql'), enforcement: source(candidate) });
    const output = sql(`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n${stages.map(([query]) => query).join('\n')}\nCOMMIT;`).split('\n');
    assert.equal(output.length, stages.length, 'incomplete enforcement postflight');
    for (const [index, [, verify]] of stages.entries()) verify(output[index]);
  }
  try {
    const directory = join(stage, 'supabase');
    mkdirSync(join(directory, 'migrations'), { recursive: true });
    // Fresh, unlinked configuration: never copy project-ref, seed, functions or
    // operator credentials from the application or an installed local stack.
    writeFileSync(join(directory, 'config.toml'), `project_id = "${id}"\n[db]\nmajor_version = 17\n[db.seed]\nenabled = false\n`);
    // Supported CLI selector; fresh staging only, never an installed/project DB.
    mkdirSync(join(directory, '.temp'), { recursive: true });
    writeFileSync(join(directory, '.temp', 'postgres-version'), postgresVersion);
    for (const file of files.filter((name) => ![candidate,recovery,MAIN_U1_MIGRATION.name,MAIN_ANALYTICS_MIGRATION.name,...MAIN_T2_ACCOUNT_MIGRATIONS.map(row=>row.name),MAIN_T2_FENCE_MIGRATION.name,MAIN_T2_RETENTION_MIGRATION.name,MAIN_COMPLETION_BILLING_MIGRATION.name].includes(name))) cpSync(join(root, file), join(directory, 'migrations', file));
    // Internal-only bridges do not publish the localhost DB port used by the
    // pinned CLI. Use a loopback-published bridge with an owned egress DROP rule
    // established before starting any database/service container instead.
    run('docker', ['network', 'create', '--opt', 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1',
      '--label', `speaksharp.closure-proof=${id}`, networkName]);
    const network = JSON.parse(run('docker', ['network', 'inspect', networkName]))[0];
    assert.equal(network.Labels['speaksharp.closure-proof'], id);
    assert.equal(network.EnableIPv6, false, 'unfiltered IPv6 is refused');
    subnet = network.IPAM.Config[0].Subnet;
    assert.match(subnet, /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/);
    writeFileSync(resourcesFile, JSON.stringify({ id, stage, networkName, subnet }));
    run('sudo', ['iptables', '-w', '-I', ...firewallArgs(id, subnet)]);
    run('sudo', ['iptables', '-w', '-C', ...firewallArgs(id, subnet)]);
    // Pull the approved immutable content, then provide the tag expected by the
    // supported CLI selector. Post-start verification refuses retag/substitution.
    const imagePin = proofPostgresImage(postgresVersion);
    run('docker', ['pull', '--platform', 'linux/amd64', imagePin.repositoryDigest]);
    run('docker', ['tag', imagePin.repositoryDigest, imagePin.tag]);
    cli(['start', '--network-id', network.Id, '--exclude', 'studio,imgproxy,realtime,edge-runtime,logflare,vector,supavisor']);
    const container = JSON.parse(run('docker', ['inspect', containerName]))[0];
    assert.deepEqual(Object.keys(container.NetworkSettings.Networks), [networkName], 'database escaped the owned internal network');
    const image = JSON.parse(run('docker', ['image', 'inspect', container.Image]))[0];
    writeFileSync(join(evidence, 'database-image.json'), JSON.stringify(proofImageEvidence(postgresVersion, container, image), null, 2));
    const databaseVersion = JSON.parse(sql(`SELECT json_build_object('version',version(),
      'serverVersionNum',current_setting('server_version_num'),
      'sharedPreloadLibraries',current_setting('shared_preload_libraries',true),
      'sessionPreloadLibraries',current_setting('session_preload_libraries',true),
      'supautilsHintRoles',current_setting('supautils.hint_roles',true),
      'supautilsReservedRoles',current_setting('supautils.reserved_roles',true),
      'supautilsVersionSetting',current_setting('supautils.version',true),
      'extensions',(SELECT json_agg(json_build_object('name',extname,'version',extversion) ORDER BY extname) FROM pg_extension))::text;`));
    writeFileSync(join(evidence, 'database-version.json'), JSON.stringify(databaseVersion, null, 2));
    if (completeT2) nativeT2Catalog = createNativeT2CatalogProof({ sql,
      sources: Object.fromEntries(manifest.filter(row => T2_VERSIONS.includes(row.version))
        .map(row => [row.version, readFileSync(join(root, row.name), 'utf8')])),
      identity: { profile: args.profile, environment: 'disposable',
        testedCommit: run('git', ['rev-parse', 'HEAD']), requestedHead: process.env.PROOF_HEAD_SHA,
        treeClean: run('git', ['status', '--porcelain']) === '', selectedPostgresVersion: postgresVersion,
        ownedContainer: containerName, imageDigest: proofPostgresImage(postgresVersion).repositoryDigest },
      retain: receipt => writeFileSync(join(evidence, 't2-native-catalog.json'), JSON.stringify(receipt, null, 2)),
    });
    // On a pin mismatch, retain the un-hashed object for that key from this same disposable database; the run still
    // fails exactly as before.
    if (nativeT2Catalog) nativeT2Catalog.record = withExpandedCatalogDiagnostic(nativeT2Catalog.record.bind(nativeT2Catalog), {
      sql, inventory: T2_INVENTORY,
      write: diagnostic => writeFileSync(join(evidence, 't2-native-catalog-expanded.json'), JSON.stringify(diagnostic, null, 2)),
    });
    assert.equal(Math.floor(Number(sql("SELECT current_setting('server_version_num');")) / 10000), 17);
    assert.deepEqual(history(), plan.stages[0].versions, 'baseline replay is incomplete');
    verifyEnforcement('before');
    // Legacy schema invariants belong to the actual118 baseline, before119
    // deliberately revokes its service-role mutation bypasses.
    const baselineProof = sql(readFileSync('tests/db/account-closure-full-chain.sql', 'utf8'));
    assert.ok(baselineProof.includes('ACCOUNT CLOSURE FULL-CHAIN INVARIANTS PASSED'), 'baseline proof marker absent');
    console.log('ACTUAL SUPABASE BASELINE REPLAY PASSED');
    // Diagnose the provider's general ACL-error hook before119 changes grants.
    // Failure is real and remains FAIL; it never bypasses the full proof.
    const denialControl = sql(readFileSync('tests/db/account-closure-denial-control.sql', 'utf8'));
    assert.ok(denialControl.includes('ACCOUNT CLOSURE DISPOSABLE DENIAL CONTROL PASSED'), 'disposable denial control absent');
    writeFileSync(join(evidence, 'denial-control.json'), JSON.stringify({ baselineMigrations: plan.stages[0].versions.length,
      selectedPostgresVersion: postgresVersion, status: 'PASS', productionProof: false }));
    cpSync(join(root, candidate), join(directory, 'migrations', candidate));
    cli(['migration', 'up', '--local']);
    assert.deepEqual(history(), plan.stages[1].versions, 'enforcement history is incomplete');
    realSupabaseSchema = true;
    verifyEnforcement('after');
    const proof = sql(readFileSync('tests/db/account-closure-enforcement-full-chain.sql', 'utf8'));
    assert.ok(proof.includes('ACCOUNT CLOSURE ENFORCEMENT FULL-CHAIN INVARIANTS PASSED'), 'enforcement proof marker absent');
    assert.equal(sql("SELECT count(*) FROM auth.users WHERE id='c1111111-1111-4111-8111-111111111111'"), '0', 'owned fixture Auth residue');
    assert.equal(sql("SELECT count(*) FROM public.account_closure_attempts WHERE user_id='c1111111-1111-4111-8111-111111111111'"), '0', 'owned fixture journal residue');
    assert.equal(sql('SELECT checkout_workers_drained FROM public.account_billing_coordination;'), 'f', 'proof must restore disabled rollout gate');
    verifyEnforcement('after');
    console.log('ACCOUNT CLOSURE ENFORCEMENT FULL-CHAIN INVARIANTS PASSED');
    assertCheckoutRejection(sql(checkoutRejectionQuery('before', readFileSync(join(root, recovery), 'utf8'))), 'before');
    cpSync(join(root, recovery), join(directory, 'migrations', recovery));
    cli(['migration', 'up', '--local']);
    assert.deepEqual(history(), plan.stages[2].versions, 'recovery history is incomplete');
    assertCheckoutRejection(sql(checkoutRejectionQuery('after', readFileSync(join(root, recovery), 'utf8'))), 'after');
    const recoveryProof = sql(readFileSync('tests/db/checkout-rejection-recovery.sql', 'utf8'));
    assert.ok(recoveryProof.includes('CHECKOUT REJECTION RECOVERY INVARIANTS PASSED'), 'recovery proof marker absent');
    assert.equal(sql("SELECT count(*) FROM auth.users WHERE id IN ('c3333333-3333-4333-8333-333333333333','c4444444-4444-4444-8444-444444444444')"), '0', 'rejection fixture residue');
    verifyEnforcement('after');
    console.log('CHECKOUT REJECTION RECOVERY INVARIANTS PASSED');
    nativeT2Catalog?.record(0); // Native main120, before any of the six T2 targets.
    const verifyAnalytics=()=>{
      const proof=sql(readFileSync('tests/db/analytics-observed-rate-full-chain.sql','utf8'));
      assert.ok(proof.includes('ANALYTICS OBSERVED RATE FULL-CHAIN INVARIANTS PASSED'),'Analytics proof marker absent');
      assert.equal(sql("SELECT count(*) FROM auth.users WHERE id='a1472000-0000-4000-8000-000000000001'"),'0','Analytics fixture Auth residue');
      assert.equal(sql("SELECT count(*) FROM public.sessions WHERE user_id='a1472000-0000-4000-8000-000000000001'"),'0','Analytics fixture session residue');
    };
    const assertCompletionAbsent=()=>{
      const state=JSON.parse(sql("SELECT json_build_object("+
        "'tables',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN "+
        "('account_completion_configuration','account_completion_coverage','account_save_obligations','account_completion_executions','account_completion_stages','account_completion_status_capabilities')),"+
        "'functions',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE '%account%completion%' OR p.proname LIKE '_account_save_%')),"+
        "'triggers',(SELECT count(*) FROM pg_trigger WHERE tgname IN ('zz_account_save_obligation','zz_account_save_session_obligation','account_save_delete_guard')))::text;"));
      assert.deepEqual(state,{tables:0,functions:0,triggers:0},'completion leaked into an earlier account checkpoint');
    };
    const applyAccountStage=(row,proofFile,marker)=>{
      cpSync(join(root,row.name),join(directory,'migrations',row.name));
      cli(['migration','up','--local']);
      assert.deepEqual(history(),plan.stages.find(stage=>stage.name===row.stage).versions,'account stage history is incomplete: '+row.stage);
      nativeT2Catalog?.record(T2_VERSIONS.indexOf(row.version) + 1);
      if(row.stage!=='account-completion') assertCompletionAbsent();
      const output=sql(readFileSync(proofFile,'utf8')+"\nSELECT '"+marker+"';");
      assert.ok(output.includes(marker),'account stage proof marker absent: '+row.stage);
      assert.equal(sql('SELECT checkout_workers_drained FROM public.account_billing_coordination;'),'f','account proof enabled legacy rollout');
    };
    if(completeT2) assertCompletionAbsent();
    if(hasAnalytics) {
      cpSync(join(root,MAIN_ANALYTICS_MIGRATION.name),join(directory,'migrations',MAIN_ANALYTICS_MIGRATION.name));
      cli(['migration','up','--local']);
      assert.deepEqual(history(),plan.stages.find(stage=>stage.name==='analytics-observed-rate').versions,'Analytics history is incomplete');
      nativeT2Catalog?.record(1);
      verifyAnalytics();
      verifyEnforcement('after');
      assertCheckoutRejection(sql(checkoutRejectionQuery('after',readFileSync(join(root,recovery),'utf8'))),'after');
    }
    if(completeT2) {
      applyAccountStage(MAIN_T2_ACCOUNT_MIGRATIONS[0],'tests/db/account-closure-pending-invariants.sql','ACCOUNT CLOSURE PENDING INVARIANTS PASSED');
      // Reuse semantic legacy controls after pending replaces selected function bodies.
      // The immutable118/119/120 catalog checks above remain at their original boundary.
      const retained=sql(readFileSync('tests/db/account-closure-enforcement-full-chain.sql','utf8'));
      assert.ok(retained.includes('ACCOUNT CLOSURE ENFORCEMENT FULL-CHAIN INVARIANTS PASSED'));
    }
    if (args.profile !== 'main-120') {
      // The original 118 -> 119 -> 120 proof above is unchanged. Only now may U1 enter staging.
      cpSync(join(root, MAIN_U1_MIGRATION.name), join(directory, 'migrations', MAIN_U1_MIGRATION.name));
      cli(['migration', 'up', '--local']);
      assert.deepEqual(history(), plan.stages.find(stage=>stage.name==='heartbeat-u1').versions, 'U1 history is incomplete');
      nativeT2Catalog?.record(3);
      // Pending intentionally replaces checkout bodies. Preserve exact catalog
      // fingerprints on120/121/122;126 uses the same substantive recovery SQL below.
      if(!completeT2) {
        assertCheckoutRejection(sql(checkoutRejectionQuery('after', readFileSync(join(root, recovery), 'utf8'))), 'after');
        verifyEnforcement('after');
      }
      const u1EnforcementProof = sql(readFileSync('tests/db/account-closure-enforcement-full-chain.sql', 'utf8'));
      assert.ok(u1EnforcementProof.includes('ACCOUNT CLOSURE ENFORCEMENT FULL-CHAIN INVARIANTS PASSED'), 'U1 enforcement proof marker absent');
      const u1RecoveryProof = sql(readFileSync('tests/db/checkout-rejection-recovery.sql', 'utf8'));
      assert.ok(u1RecoveryProof.includes('CHECKOUT REJECTION RECOVERY INVARIANTS PASSED'), 'U1 recovery proof marker absent');
      assert.equal(sql("SELECT count(*) FROM auth.users WHERE id='c1111111-1111-4111-8111-111111111111'"), '0', 'U1 owned fixture Auth residue');
      assert.equal(sql("SELECT count(*) FROM public.account_closure_attempts WHERE user_id='c1111111-1111-4111-8111-111111111111'"), '0', 'U1 owned fixture journal residue');
      assert.equal(sql('SELECT checkout_workers_drained FROM public.account_billing_coordination;'), 'f', 'U1 proof must restore disabled rollout gate');
      assert.equal(sql("SELECT count(*) FROM auth.users WHERE id IN ('c3333333-3333-4333-8333-333333333333','c4444444-4444-4444-8444-444444444444')"), '0', 'U1 rejection fixture residue');
      if(!completeT2) verifyEnforcement('after');
      console.log('MAIN PLUS U1 CLOSURE INVARIANTS PASSED');
      if(hasAnalytics) verifyAnalytics();
    }
    if(completeT2) {
      assertCompletionAbsent();
      applyAccountStage(MAIN_T2_ACCOUNT_MIGRATIONS[1],'tests/db/account-recording-admission-invariants.sql','ACCOUNT RECORDING ADMISSION INVARIANTS PASSED');
      applyAccountStage(MAIN_T2_ACCOUNT_MIGRATIONS[2],'tests/db/account-coaching-admission-invariants.sql','ACCOUNT COACHING ADMISSION INVARIANTS PASSED');
      const completion=MAIN_T2_ACCOUNT_MIGRATIONS[3];
      cpSync(join(root,completion.name),join(directory,'migrations',completion.name));
      cli(['migration','up','--local']);
      assert.deepEqual(history(),plan.stages.find(stage=>stage.name===completion.stage).versions,'completion history is incomplete');
      nativeT2Catalog.record(6);
      // Catalog metadata only, bound to the immutable image already verified above.
      // Retain it before completion SQL, including when that SQL later fails.
      const storageGuard=JSON.parse(sql(`SELECT json_build_object(
        'functionDefinition',pg_get_functiondef(p.oid),'functionBodyMd5',md5(p.prosrc),
        'objectDeleteTriggers',(SELECT json_agg(json_build_object('name',t.tgname,'enabled',t.tgenabled,
          'type',t.tgtype,'definition',pg_get_triggerdef(t.oid)) ORDER BY t.tgname)
          FROM pg_trigger t WHERE t.tgrelid='storage.objects'::regclass AND t.tgfoid=p.oid AND NOT t.tgisinternal))
        FROM pg_proc p WHERE p.oid='storage.protect_delete()'::regprocedure;`));
      writeFileSync(join(evidence,'storage-delete-guard.json'),JSON.stringify({
        profile:args.profile,image:JSON.parse(readFileSync(join(evidence,'database-image.json'),'utf8')),
        completionSqlSha256:createHash('sha256').update(readFileSync('tests/db/account-completion-full-chain-invariants.sql')).digest('hex'),
        guard:storageGuard,scope:'catalog readback; synthetic metadata cleanup only, not Storage API/object-store deletion',
      },null,2));
      assert.ok(storageGuard.objectDeleteTriggers?.some(trigger=>trigger.name==='protect_objects_delete'
        && trigger.enabled==='O' && trigger.type===10),'actual Storage statement-level delete guard missing or disabled');
      const completionProof=sql("SET closure_proof.heartbeat_profile='true';\n"+readFileSync('tests/db/account-completion-full-chain-invariants.sql','utf8'));
      assert.ok(completionProof.includes('ACCOUNT COMPLETION REAL-SCHEMA INVARIANTS PASSED'),'completion proof marker absent');
      assert.equal(sql('SELECT enabled FROM public.account_completion_configuration;'),'f','completion proof must restore disabled configuration');
      assert.equal(sql('SELECT count(*) FROM public.account_completion_coverage;'),'0','synthetic coverage escaped rollback');
      assert.equal(sql('SELECT checkout_workers_drained FROM public.account_billing_coordination;'),'f','legacy rollout must remain disabled');
      assert.equal(sql("SELECT count(*) FROM auth.users WHERE id IN ('b9110000-0000-4000-8000-000000000001','b9110000-0000-4000-8000-000000000002','b9110000-0000-4000-8000-000000000003','b9110000-0000-4000-8000-000000000004')"),'0','completion fixture Auth residue');
      assert.equal(sql("SELECT count(*) FROM storage.buckets WHERE id='closure-completion-proof'"),'0','completion fixture storage residue');
      assert.equal(sql("SELECT to_regclass('public.completion_chain_residue_fixture') IS NULL"),'t','completion fixture table escaped rollback');
      verifyAnalytics();
      nativeT2Catalog.finish(); // No PASS without all seven actual native readbacks.
      console.log('ACCOUNT COMPLETION REAL-SCHEMA INVARIANTS PASSED');
    }
    if(fenceT2) {
      // Fence last: it redefines claim/status/W1/delete guard and closes direct coaching writes. Its semantics and
      // concurrency are proven natively by tests/db/account-coaching-fence.*; here the real Supabase image proves the
      // migration applies at the end of the actual chain, its catalog/ACL, and that every earlier account proof still holds.
      const fence=MAIN_T2_FENCE_MIGRATION;
      cpSync(join(root,fence.name),join(directory,'migrations',fence.name));
      cli(['migration','up','--local']);
      assert.deepEqual(history(),plan.stages.find(stage=>stage.name===fence.stage).versions,'fence history is incomplete');
      const w2='public.persist_ai_suggestion_with_authority_v1(uuid,uuid,jsonb,text,text,text,date,integer,integer)';
      const rpc='public.fence_account_coaching_unknown_v1(uuid,uuid,uuid,uuid,text,text)';
      const guard='public.guard_account_coaching_ai_suggestions_write_v1()';
      const state=JSON.parse(sql(`SELECT json_build_object(
        'auditRls',(SELECT relrowsecurity FROM pg_class WHERE oid='public.account_coaching_fences'::regclass),
        'auditPrivileges',(SELECT count(*) FROM unnest(ARRAY['anon','authenticated','service_role']) r,
          unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p WHERE has_table_privilege(r,'public.account_coaching_fences',p)),
        'rpcDefiner',(SELECT prosecdef FROM pg_proc WHERE oid='${rpc}'::regprocedure),
        'rpcService',has_function_privilege('service_role','${rpc}','EXECUTE'),
        'rpcClient',has_function_privilege('anon','${rpc}','EXECUTE') OR has_function_privilege('authenticated','${rpc}','EXECUTE'),
        'guardInvoker',(SELECT NOT prosecdef FROM pg_proc WHERE oid='${guard}'::regprocedure),
        'guardTriggers',(SELECT count(*) FROM pg_trigger WHERE tgrelid='public.sessions'::regclass AND tgenabled='O'
          AND tgname IN ('a_guard_account_coaching_ai_suggestions_insert','a_guard_account_coaching_ai_suggestions_update')),
        'w2Service',has_function_privilege('service_role','${w2}','EXECUTE'),
        'receiptWrites',has_table_privilege('service_role','public.ai_suggestion_authority_receipts','INSERT')
          OR has_table_privilege('service_role','public.ai_suggestion_authority_receipts','UPDATE'),
        'cacheReadDefiner',(SELECT prosecdef FROM pg_proc WHERE oid='public.record_ai_suggestion_cache_read_v1(uuid,uuid)'::regprocedure),
        'fencedPhase',(SELECT pg_get_constraintdef(oid) LIKE '%fenced_unknown%' FROM pg_constraint
          WHERE conrelid='public.account_coaching_operations'::regclass AND conname='account_coaching_operations_phase_check'))::text;`));
      assert.deepEqual(state,{auditRls:true,auditPrivileges:0,rpcDefiner:true,rpcService:true,rpcClient:false,guardInvoker:true,
        guardTriggers:2,w2Service:false,receiptWrites:false,cacheReadDefiner:true,fencedPhase:true},'fence catalog/ACL');
      const coaching=sql(readFileSync('tests/db/account-coaching-admission-invariants.sql','utf8')+"\nSELECT 'ACCOUNT COACHING ADMISSION INVARIANTS PASSED';");
      assert.ok(coaching.includes('ACCOUNT COACHING ADMISSION INVARIANTS PASSED'),'coaching admission proof after the fence');
      const completionAfterFence=sql("SET closure_proof.heartbeat_profile='true';\n"+readFileSync('tests/db/account-completion-full-chain-invariants.sql','utf8'));
      assert.ok(completionAfterFence.includes('ACCOUNT COMPLETION REAL-SCHEMA INVARIANTS PASSED'),'completion proof after the fence');
      assert.equal(sql('SELECT enabled FROM public.account_completion_configuration;'),'f','completion proof must restore disabled configuration');
      assert.equal(sql('SELECT count(*) FROM public.account_coaching_fences;'),'0','the migration fences nothing');
      observeC1ReleaseCatalog({ sql, root: process.cwd(), stage: 127,
        retain: receipt => writeFileSync(join(evidence, 't2-release-post127.json'), JSON.stringify(receipt, null, 2)) });
      console.log('ACCOUNT COACHING UNKNOWN FENCE FULL-CHAIN INVARIANTS PASSED');
    }
    if(retentionT2) {
      // This is installation/catalog proof on the real chain. Behavioral retention/concurrency
      // evidence is separate; stage0..6 above remains the historical six-migration proof.
      const retention=MAIN_T2_RETENTION_MIGRATION;
      cpSync(join(root,retention.name),join(directory,'migrations',retention.name));
      cli(['migration','up','--local']);
      assert.deepEqual(history(),plan.stages.find(stage=>stage.name===retention.stage).versions,'retention history is incomplete');
      const state=JSON.parse(sql(`SELECT json_build_object(
        'compatible',public.retention_content_free_compatible(),
        'pinCount',(SELECT count(*) FROM public.transcript_retention_function_pins),
        'evidenceRows',(SELECT count(*) FROM public.session_progress_content_evidence),
        'contextRows',(SELECT count(*) FROM public.transcript_retention_replacement_context),
        'privateRls',(SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN
          ('public.session_progress_content_evidence'::regclass,'public.transcript_retention_replacement_context'::regclass,
           'public.transcript_retention_function_pins'::regclass)),
        'privatePrivileges',(SELECT count(*) FROM unnest(ARRAY['anon','authenticated','service_role']) r,
          unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p,
          unnest(ARRAY['public.session_progress_content_evidence','public.transcript_retention_replacement_context',
            'public.transcript_retention_function_pins','public.transcript_retention_expiry_grants']) t WHERE has_table_privilege(r,t,p)),
        'expiredGuardInvoker',(SELECT NOT prosecdef FROM pg_proc WHERE oid='public._ss_retention_expired_derived_guard()'::regprocedure),
        'expiredGuardEnabled',(SELECT count(*) FROM pg_trigger WHERE tgrelid='public.sessions'::regclass
          AND tgname='aa_retention_expired_derived_guard' AND tgenabled='O'),
        'completionDisabled',(SELECT NOT enabled FROM public.account_completion_configuration))::text;`));
      writeFileSync(join(evidence,'retention-catalog.json'),JSON.stringify({profile:args.profile,
        migration:retention,state,scope:'installation/catalog only; not retention behavioral or Production proof'},null,2));
      assert.equal(state.completionDisabled,true,'completion must remain disabled after retention');
      assert.deepEqual(state,{compatible:true,pinCount:8,evidenceRows:0,contextRows:0,privateRls:true,
        privatePrivileges:0,expiredGuardInvoker:true,expiredGuardEnabled:1,completionDisabled:true},'retention catalog/ACL');
      observeC1ReleaseCatalog({ sql, root: process.cwd(), stage: 128,
        retain: receipt => writeFileSync(join(evidence, 't2-release-post128.json'), JSON.stringify(receipt, null, 2)) });
      console.log('CONTENT-FREE RETENTION FULL-CHAIN CATALOG PASSED');
      // Observe the actual current profile-first edit/save race before129.
      // A child receipt cannot PASS until this parent's owned teardown succeeds.
      assert.equal(existsSync(editedTakeReceipt), false, 'stale edited-take receipt refused');
      editedTakeReached = true;
      runRequiredEditedTakeProof({
        run: () => run(process.execPath, ['tests/db/retention-edited-take-full-chain.mjs']),
        read: () => existsSync(editedTakeReceipt) ? JSON.parse(readFileSync(editedTakeReceipt, 'utf8')) : null,
        owner: id, testedCommit: run('git', ['rev-parse', 'HEAD']),
      });
    }
    if(billingT2) {
      const billing=MAIN_COMPLETION_BILLING_MIGRATION;
      const existingAcl=()=>JSON.parse(sql(`SELECT json_build_object(
        'tables',(SELECT json_agg(json_build_array(c.relname,c.relacl::text,c.relrowsecurity) ORDER BY c.relname)
          FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
          AND (c.relname='user_profiles' OR c.relname LIKE 'account_completion_%')),
        'legacyRpcAcl',(SELECT proacl::text FROM pg_proc WHERE oid='public.settle_account_closure_billing(uuid,uuid,text,jsonb)'::regprocedure))::text;`));
      const before=existingAcl();
      cpSync(join(root,billing.name),join(directory,'migrations',billing.name));
      cli(['migration','up','--local']);
      assert.deepEqual(history(),plan.stages.find(stage=>stage.name===billing.stage).versions,'billing history is incomplete');
      const after=existingAcl();
      assert.deepEqual(after,before,'settlement must preserve existing table and base-RPC ACLs');
      const result=sql(readFileSync('tests/db/account-completion-billing-full-chain-invariants.sql','utf8'));
      assert.ok(result.includes('ACCOUNT COMPLETION BILLING REAL-SCHEMA INVARIANTS PASSED'),'completion billing oracle incomplete');
      assert.equal(sql('SELECT NOT enabled AND scope_digest IS NULL FROM public.account_completion_configuration;'),'t',
        'settlement proof must restore disabled unbound configuration');
      writeFileSync(join(evidence,'completion-billing-catalog.json'),JSON.stringify({profile:args.profile,
        migration:billing,existingAclBefore:before,existingAclAfter:after,oraclePassed:true,completionDisabled:true,
        scope:'real-chain sequential SQL/ACL/replay compatibility; separate native race and provider/Production proof'},null,2));
      console.log('ACCOUNT COMPLETION BILLING FULL-CHAIN CATALOG PASSED');
    }
  } catch (error) {
    primaryError = error;
  } finally {
    // Must precede supabase stop/removal: otherwise the crashing backend's state,
    // OOM indicator, server signal and stage output are permanently lost.
    try {
      writeFileSync(join(evidence, 'database-diagnostics.json'), JSON.stringify(captureOwnedDatabaseDiagnostics(containerName, env), null, 2));
      if (primaryError?.subprocess) writeFileSync(join(evidence, 'subprocess-failure.json'), JSON.stringify(primaryError.subprocess, null, 2));
    } catch (error) {
      try {
        writeFileSync(join(evidence, 'diagnostic-capture-failure.json'), JSON.stringify({ message: 'owned database diagnostics unavailable', code: error?.code ?? null }));
      } catch { /* Artifact storage failure must not prevent owned resource cleanup. */ }
    }
    try {
      cleanupOwned({ id, stage, networkName, subnet });
    } catch (error) { cleanupError = error; }
    if (editedTakeReached) {
      try {
        assert.equal(existsSync(editedTakeReceipt), true, 'reached edited-take stage is missing its receipt');
        const observed = finalizeEditedTakeProof(JSON.parse(readFileSync(editedTakeReceipt, 'utf8')), {
          owner: id, testedCommit: run('git', ['rev-parse', 'HEAD']), cleanupVerified: !cleanupError,
          parentPassed: !primaryError && !cleanupError,
        });
        writeFileSync(editedTakeReceipt, JSON.stringify(observed, null, 2));
        assert.equal(observed.status, 'PASS', 'edited-take proof or owned teardown did not complete');
      } catch (error) { primaryError ??= error; }
    }
    writeFileSync(join(evidence, 'verdict.json'), JSON.stringify({
      status: primaryError || cleanupError ? 'FAIL' : 'PASS',
      candidate: migrations.at(-1), migrations: migrations.length, realSupabaseSchema,
      profile: args.profile, stagedVersions: plan.stages,
      testedCommit: run('git', ['rev-parse', 'HEAD']), requestedHead: process.env.PROOF_HEAD_SHA,
      t2NativeCatalog: nativeT2Catalog?.report() ?? null,
      providerProof: false, cleanupVerified: !cleanupError,
      selectedPostgresVersion: postgresVersion, imageComparisonOnly: postgresVersion === '17.6.1.106', productionRepresentativenessVerified: false,
      error: primaryError?.message, cleanupError: cleanupError?.message,
    }, null, 2));
  }
  if (primaryError || cleanupError) throw primaryError ?? cleanupError;

}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) runMainClosureProof();
