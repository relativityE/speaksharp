#!/usr/bin/env node
/* eslint-env node */
/* global console, process */
/**
 * VERIFIED cleanup for the proof-only worker e2e (run as a separate `if: always()` workflow step).
 * Reads $PROOF_STATE_FILE, expires the synthetic actor, deletes the synthetic outbox + session rows,
 * and VERIFIES the deletion. Exits non-zero on ANY cleanup failure so the proof workflow fails.
 * No-op (exit 0) if there is no state (proof never created anything).
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const need = (k) => { const v = process.env[k]; if (!v) throw new Error(`CLEANUP_NOT_RUNNABLE: ${k} required`); return v; };
const SUPABASE_URL = need('SUPABASE_URL');
const SERVICE_KEY = need('SUPABASE_SERVICE_ROLE_KEY');
const STATE_FILE = process.env.PROOF_STATE_FILE ?? '/tmp/proof-worker-state.json';
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function main() {
  let state;
  try { state = JSON.parse(readFileSync(STATE_FILE, 'utf8')); }
  catch { console.log('CLEANUP: no state file — nothing to clean.'); return; }

  const problems = [];
  const { userId, sessionId } = state;

  if (sessionId) {
    const d1 = await supabase.from('telemetry_outbox').delete().eq('record_id', sessionId);
    if (d1.error) problems.push(`delete outbox: ${d1.error.message}`);
    const d2 = await supabase.from('sessions').delete().eq('id', sessionId);
    if (d2.error) problems.push(`delete session: ${d2.error.message}`);
    // VERIFY deletion
    const ob = (await supabase.from('telemetry_outbox').select('id').eq('record_id', sessionId)).data ?? [];
    if (ob.length !== 0) problems.push(`outbox rows still present: ${ob.length}`);
    const ss = (await supabase.from('sessions').select('id').eq('id', sessionId)).data ?? [];
    if (ss.length !== 0) problems.push(`session row still present`);
  }
  if (userId) {
    const e = await supabase.rpc('expire_observability_actor', { p_user_id: userId });
    if (e.error) problems.push(`expire actor: ${e.error.message}`);
    // VERIFY the registry row is gone (expire deletes it).
    const reg = (await supabase.from('observability_actor_registry').select('user_id').eq('user_id', userId)).data ?? [];
    if (reg.length !== 0) problems.push(`registry row still present`);
  }

  if (problems.length) { console.error(`CLEANUP FAILED:\n - ${problems.join('\n - ')}`); process.exit(1); }
  console.log('CLEANUP OK: actor expired, synthetic session/outbox deleted and verified gone.');
}

main().catch((e) => { console.error('CLEANUP ERROR:', e.message); process.exit(2); });
