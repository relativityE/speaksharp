// Exact PostgreSQL17 logical catalog delta for the pinned #1811 feedback fence migration (ledger 11): the fence table,
// its write trigger on user_issue_reports and the four functions. Derived from the bounded fixture replay in both catalog
// contexts (identical); the full Supabase-chain successor replay independently enforces these pins.
export const FEEDBACK_FENCE_CATALOG_DELTA = Object.freeze({
  "function:public._rwt_feedback_fence_v1()": "b3d5dfb42dd2e2774376b61016d886d3",
  "function:public.clean_rwt_feedback_fence_v1(text)": "2e95a4692712ae7e4acc84fa43a7b204",
  "function:public.close_rwt_feedback_fence_v1(text)": "0f2b823914493ad9716b18ff971d34d0",
  "function:public.open_rwt_feedback_fence_v1(uuid, jsonb, text, integer)": "8c0ba73b76c5ecbdb6e161e6d6912e4d",
  "table:public.rwt_feedback_fences": "e02122b312cb0329eacf5536fbdcc849",
  "trigger:public.user_issue_reports.zz_rwt_feedback_fence": "1dea4fcbf23a4d0068a2b6b3d30fe6a6"
});
