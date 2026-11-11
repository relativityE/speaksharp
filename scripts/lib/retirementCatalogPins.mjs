// Exact PostgreSQL17 logical catalog delta for the pinned local-retirement migration.
// Native fixture derived; full Supabase-chain successor replay independently enforces these pins.
export const RETIREMENT_CATALOG_DELTA = Object.freeze({
  "function:public.claim_account_pending_completion_v1(uuid, uuid, text)": "78e36462e5c9ca972f3c8351cb6e542c",
  "function:public.fence_account_coaching_expired_v1(uuid, uuid, uuid, uuid, text, text)": "837796cbf538e2e858078697f4783bba",
  "function:public.finish_account_coaching_local_v1(uuid, uuid, uuid)": "9f319865e5ba99562b6ce6cb60ce8a87",
  "function:public.guard_unsettled_account_coaching_delete_v1()": "97002ed0db7fb2f2473e21677e2a9fae",
  "function:public.persist_account_coaching_v1(uuid, boolean, uuid, uuid, jsonb, text, text, text, date, integer, integer)": "7d9acb50ee7c97c80f3c802bb604645c",
  "function:public.read_account_completion_status_v1(uuid, text, text)": "74fdf96ac1aa47d57218d0912d110e7f",
  "table:public.account_coaching_expiry_fences": "a095992cc0cd3fb9091507642d1eb04d",
  "table:public.account_coaching_local_fences": "baf9c4b76a95c1a5e03866f79ddba850",
  "table:public.account_coaching_operations": "3b700410a7b025a5512100a110b6c057"
});
