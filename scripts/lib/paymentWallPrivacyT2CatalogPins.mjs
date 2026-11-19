// T2 release catalog deltas for ledger 12 (#1863 payment wall, 20261114170000) and ledger 13 (#1835 practice privacy,
// 20261117105700). Only these existing T2-inventoried objects change (measured by replaying the real chain before and after
// each migration): #1863 replaces get_analytics_summary with its guarded wrapper and widens the recording_start_abandonments
// outcome CHECK; #1835 revokes direct EXECUTE on persist_account_coaching_v1. Each digest must be the native Supabase
// Postgres 17.6.1.155 observation from the full-chain proof (profiles main-payment-wall-132 / main-practice-privacy-133),
// never a PGlite value. A pending value is not a digest, so assertT2Catalog refuses that stage until it is pinned.
export const PENDING_NATIVE_PIN = 'PENDING_NATIVE_PG17_OBSERVATION';
// Observed natively by full-chain run 44424646936 (head d74ea9ee), identically in profiles 132 and 133, after the ledger-11
// reference passed against the current pins (referenceVerified: true).
export const PAYMENT_WALL_T2_CATALOG_DELTA = Object.freeze({
  "function:public.get_analytics_summary(uuid)": "59a8264bf7c34d8117722d00b21f6506",
  "table:public.recording_start_abandonments": "a599a366c15a1026c4604f9b23291c19"
});
// Observed natively by full-chain run 44425976976 (head 94d2b1cb), profile 133, after the ledger-12 reference passed against
// the pins above (referenceVerified: true; profile 132 PASS with its refusal controls in the same run).
export const PRACTICE_PRIVACY_T2_CATALOG_DELTA = Object.freeze({
  "function:public.persist_account_coaching_v1(uuid, boolean, uuid, uuid, jsonb, text, text, text, date, integer, integer)": "0e774e4694bf34831b94c857b6e0e6b7"
});
