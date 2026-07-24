#!/usr/bin/env node
/**
 * READ-ONLY historical audit for the post-#1022 P2 finding: how many existing `user_issue_reports`
 * rows persisted a raw `metadata.appRuntimeConfig.url`.
 *
 * STRICTLY read-only and content-free:
 *   - performs SELECT/COUNT only — never UPDATE/DELETE/INSERT.
 *   - prints ONLY aggregates: total rows, affected count, percentage, and the affected date range.
 *   - NEVER prints any metadata, url, title, description, user id, or session id value.
 *
 * Requires (from the CI-secret path, never echoed):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Any cleanup is a SEPARATE, Product-Owner-authorized operation — this script does not mutate anything.
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('[audit] Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY (present/absent only): ' +
    `URL=${url ? 'present' : 'absent'} SERVICE_ROLE=${key ? 'present' : 'absent'}`);
  process.exit(2);
}

const sb = createClient(url, key, { auth: { persistSession: false } });
const TABLE = 'user_issue_reports';
// JSONB text path: rows where metadata.appRuntimeConfig.url is present (non-null).
const URL_PATH = 'metadata->appRuntimeConfig->>url';

const fail = (label, error) => { console.error(`[audit] ${label} failed:`, error?.message ?? error); process.exit(1); };

// Aggregate counts only (head:true → no row bodies transferred).
const { count: total, error: e1 } = await sb.from(TABLE).select('*', { count: 'exact', head: true });
if (e1) fail('total count', e1);

const { count: affected, error: e2 } = await sb
  .from(TABLE).select('*', { count: 'exact', head: true }).not(URL_PATH, 'is', null);
if (e2) fail('affected count', e2);

// Date range of affected rows (created_at only — a date is an aggregate boundary, not content).
let earliest = null; let latest = null;
if ((affected ?? 0) > 0) {
  const { data: minRow, error: e3 } = await sb
    .from(TABLE).select('created_at').not(URL_PATH, 'is', null).order('created_at', { ascending: true }).limit(1);
  if (e3) fail('earliest', e3);
  const { data: maxRow, error: e4 } = await sb
    .from(TABLE).select('created_at').not(URL_PATH, 'is', null).order('created_at', { ascending: false }).limit(1);
  if (e4) fail('latest', e4);
  earliest = minRow?.[0]?.created_at ?? null;
  latest = maxRow?.[0]?.created_at ?? null;
}

const pct = total ? ((100 * (affected ?? 0)) / total).toFixed(1) : '0.0';
console.log('===== issue-report appRuntimeConfig.url audit (READ-ONLY) =====');
console.log(`total_reports          : ${total ?? 0}`);
console.log(`rows_with_appcfg_url   : ${affected ?? 0}`);
console.log(`percentage_affected    : ${pct}%`);
console.log(`affected_date_range    : ${earliest ?? 'n/a'}  →  ${latest ?? 'n/a'}`);
console.log('note                   : read-only; no rows mutated; no metadata/url/PII values printed.');
