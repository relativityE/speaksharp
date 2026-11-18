// T2 release catalog deltas for ledger 12 (#1863 payment wall, 20261114170000) and ledger 13 (#1835 practice privacy,
// 20261117105700). Only these existing T2-inventoried objects change (measured by replaying the real chain before and after
// each migration): #1863 replaces get_analytics_summary with its guarded wrapper and widens the recording_start_abandonments
// outcome CHECK; #1835 revokes direct EXECUTE on persist_account_coaching_v1. Each digest must be the native Supabase
// Postgres 17.6.1.155 observation from the full-chain proof (profiles main-payment-wall-132 / main-practice-privacy-133),
// never a PGlite value. A pending value is not a digest, so assertT2Catalog refuses that stage until it is pinned.
export const PENDING_NATIVE_PIN = 'PENDING_NATIVE_PG17_OBSERVATION';
export const PAYMENT_WALL_T2_CATALOG_DELTA = Object.freeze({
  "function:public.get_analytics_summary(uuid)": PENDING_NATIVE_PIN,
  "table:public.recording_start_abandonments": PENDING_NATIVE_PIN
});
export const PRACTICE_PRIVACY_T2_CATALOG_DELTA = Object.freeze({
  "function:public.persist_account_coaching_v1(uuid, boolean, uuid, uuid, jsonb, text, text, text, date, integer, integer)": PENDING_NATIVE_PIN
});
