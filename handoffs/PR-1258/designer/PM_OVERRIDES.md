# PO decisions and implementation corrections — 7 October 2026

Read this with the four Designer specs. These corrections override conflicting older copy in those originals, which are preserved unchanged.

1. The user-facing metric label is **Clear Delivery**, per the PO. Keep internal fields such as `clarity_score` unchanged.
2. Coaching answers the defined questions using transcript evidence and relevant measured signals. Ask the LLM for **around 10 words per phrase**. Length is a prompt target, never a word-count rejection or truncation rule. The old six-word/90-character constraints in the Designer documents are superseded. Preserve current product-specific payload versions; do not force every payload to `gemini_coaching_v1`.
3. Saved reviews display the persisted pair verbatim. A revisit must not generate a new review automatically. Explicit retry is separate from read-only display.
4. The current profile contract has no first-name field. Use the unnamed factual greeting; never infer a name from email or add a migration just for this greeting.
5. Persisted per-word counts are `sessions.filler_counts`. Use `readPersistedFillerCounts` and `persistedFillerTotal` from `frontend/src/contracts/fillerCounts.ts`. A valid empty object means measured zero; missing or invalid counts mean unmeasured. Do not use legacy `filler_words` or convert per-minute rates into counts.
6. Use `hasValidPauseEvidence` from `frontend/src/utils/metricValidity.ts`. Missing, empty or malformed `pause_metrics` are unmeasured and excluded from charts and sample counts. Structurally valid all-zero evidence remains a measured zero.
7. Determine product from persisted `session.product`, never its title. Unknown legacy product remains unknown. Keep the existing comparison feature and give its checkbox a visible Compare label; the ZIP guide takes precedence over the older standalone attachment on this point.
8. The three-measurement minimum is a chart display rule. It must not change core Progress eligibility or baseline/cohort queries. Latest/previous filler comparisons use the two newest usable count records and show their actual dates and whole counts with units.
9. Back/return must restore an owned saved session independently of recorder state. A speculative POP restore was withdrawn: mocked Back already preserved the take and that change broke Products navigation. A real-engine teardown roughly 61 seconds after save is observed, but its cause remains unproven. Test saved restoration, fresh take, product switch, deleted/unowned session and real-engine idle behavior separately. Never resurrect an active recorder on return.
10. The manual localhost copy calls the deployed coaching function. Its failure is not evidence of a missing local Gemini connection. The provider HTTP status and precise failure boundary remain unknown until observed; do not label them as Gemini overload or free-tier failure without evidence.
11. Implement all four independently collapsed trend rows, including fillers. The older three-chart collapse candidate is not the final design.

Layout work does not resolve provider reliability, recognition misses or persisted/displayed count mismatches. Keep those implementation defects as explicit engineering tasks with their own evidence.
