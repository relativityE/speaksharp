#!/usr/bin/env node
/* eslint-env node */
/**
 * Service-role provenance CLI for AUTOMATED data-producing workflows. The browser can never assign
 * provenance; a CI job that writes sessions/reports must REGISTER its actor here (server-side, trusted)
 * BEFORE writing, and EXPIRE it after. Also exposes the pre-reconciliation candidate counts.
 *
 * Usage (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY):
 *   node scripts/observability-provenance.mjs register --user <uuid> --origin automated_test \
 *        --cohort <c> --run <test_run_id> --suite <s> [--ttl-hours 6]
 *   node scripts/observability-provenance.mjs expire --user <uuid>
 *   node scripts/observability-provenance.mjs candidates [--since <iso>]   # dry-run counts, no writes
 *
 * Concurrency: the registry PK is user_id — use a UNIQUE ephemeral account per run, or SERIALIZE the
 * data-producing workflows for a shared account (a GitHub concurrency group). Never let two concurrent
 * runs share one account (they would overwrite each other's test_run_id).
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('PROVENANCE_NOT_RUNNABLE: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required'); process.exit(2); }

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };

const supabase = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  if (cmd === 'register') {
    const user = flag('user');
    if (!user) throw new Error('--user <uuid> required');
    const ttlHours = Number(flag('ttl-hours') ?? '6') || 6;
    const { error } = await supabase.rpc('register_observability_actor', {
      p_user_id: user,
      p_data_origin: flag('origin') ?? 'automated_test',
      p_cohort_id: flag('cohort') ?? null,
      p_test_run_id: flag('run') ?? null,
      p_test_suite: flag('suite') ?? null,
      p_ttl: `${ttlHours} hours`,
    });
    if (error) throw new Error(`register failed: ${error.message}`);
    console.log(`PROVENANCE registered actor origin=${flag('origin') ?? 'automated_test'} run=${flag('run') ?? '-'} ttl=${ttlHours}h`);
  } else if (cmd === 'expire') {
    const user = flag('user');
    if (!user) throw new Error('--user <uuid> required');
    const { error } = await supabase.rpc('expire_observability_actor', { p_user_id: user });
    if (error) throw new Error(`expire failed: ${error.message}`);
    console.log('PROVENANCE expired actor');
  } else if (cmd === 'candidates') {
    const since = flag('since') ?? null;
    const { data, error } = await supabase.rpc('reconcile_telemetry_candidates', { p_since: since });
    if (error) throw new Error(`candidates failed: ${error.message}`);
    // COUNTS ONLY — event_type × candidate_count × unclassified_count. No content, no ids.
    console.log(`PROVENANCE_CANDIDATES ${JSON.stringify({ since, counts: data ?? [] })}`);
  } else {
    console.error('usage: register|expire|candidates (see file header)');
    process.exit(2);
  }
}

main().catch((e) => { console.error('PROVENANCE ERROR:', e.message); process.exit(1); });
