// Exact PostgreSQL17 logical catalog delta for the pinned #1643 start-abandonment migration (ledger 10):
// the two replaced save-obligation bodies, the new RPC and its table. Derived from the bounded fixture replay in both
// catalog contexts (identical); the full Supabase-chain successor replay independently enforces these pins.
export const ABANDONMENT_CATALOG_DELTA = Object.freeze({
  "function:public._account_save_lease_obligation_v1()": "495800fd7acd5f0c210c2427d515a803",
  "function:public._account_save_session_obligation_v1()": "b9f4e34978cc76c15e4a2e10db63b0c9",
  "function:public.abandon_recording_start_v1(uuid)": "7b555a5c8edfee2acf2290357dd47caa",
  "table:public.recording_start_abandonments": "73919f1060a6caa58ce7aafb031da5b6"
});
