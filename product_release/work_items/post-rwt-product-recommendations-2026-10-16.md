# Post-RWT product recommendations — 16 October 2026

**Status:** Draft research collection; decisions PENDING  
**Owner:** UNASSIGNED  
**As of:** 2026-10-16  
**Class:** Unverified hypotheses and proposed post-RWT work  
**Authority:** None; a collection for later Product Owner triage  
**Not authoritative for:** existing ticket acceptance, release gates, scheduling, deployed behavior, or implementation approval

## Scope and decision boundary

The owner directed no scope expansion: collect recommendations separately so current tickets can close. Implementation of these recommendations is **POST-RWT**, subject to later selection and authorization. This document adds no RWT, MVP, release, or ticket-closure gate. It does not change code, CI, product requirements, developer branches, or #1634.

The owner also requested **post-RWT triage of the catch-all PR** so useful existing ideas can improve the recommendations and PRs align with the refined goals. Its identity is **UNVERIFIED**; do not assume it is #1548. Confirm the intended PR before that triage. No existing PR is closed, reclassified, or expanded here.

Refined goals for that future decision: feedback should be personal and grounded in the user's attempt; users should see credible change and feel relevant progress. Preserve the simple two-suggestion experience and a clear next attempt. Felt progress and demonstrated improvement are distinct measurements.

[Scope clarification](https://github.com/relativityE/speaksharp/pull/1548#issuecomment-6220183987) supersedes any interpretation of the [first research note](https://github.com/relativityE/speaksharp/pull/1548#issuecomment-6219921982) or [personalization note](https://github.com/relativityE/speaksharp/pull/1548#issuecomment-6220154652) as additional release obligations.

## Existing requirements versus new proposals

- [#1548's original preserved contract](https://github.com/relativityE/speaksharp/pull/1548) already describes concise 1+1 coaching, evidence supporting advice, a canonical practice target, and review → understood target → repeat → same target → measured outcome. Those are provenance, not newly invented requirements in this collection. Its existing disposition and acceptance remain owned by that ticket.
- [#1621](https://github.com/relativityE/speaksharp/pull/1621) identifies the persisted metric, direction, value, and units beside the stored repeat outcome. Its [source acceptance](https://github.com/relativityE/speaksharp/pull/1548#issuecomment-6197166874) expressly separates that bounded increment from semantic assessment of AI-content advice.
- New UX, evaluation methods, study thresholds, persistence proposals, commercial experiments, and optional features below remain proposals. Any overlap with an existing ticket must be reconciled against its original contract, not promoted into acceptance through this document.
- Neither collecting an idea nor later retaining it during triage authorizes implementation, a merge, deployment, billing change, live experiment, or tester recruitment.

## Dated evidence and limits

The source audit used main `ef417e9947583e814d8e3a4fd3665fa2932a393d`. Source inspection establishes code/design observations, not deployed performance or user benefit.

- [Review pair](https://github.com/relativityE/speaksharp/blob/ef417e9947583e814d8e3a4fd3665fa2932a393d/frontend/src/components/review/PracticeLoopReviewPair.tsx): two sections, optional session evidence, and one practice action. Its evidence comment explicitly distinguishes adjacent measurements from the AI's reason.
- [Saved review](https://github.com/relativityE/speaksharp/blob/ef417e9947583e814d8e3a4fd3665fa2932a393d/frontend/src/components/analytics/SavedPracticeLoopReview.tsx) and [session evidence](https://github.com/relativityE/speaksharp/blob/ef417e9947583e814d8e3a4fd3665fa2932a393d/frontend/src/services/review/sessionEvidence.ts): review composition and measurement context. Review filler evidence is per minute; repeat filler/word percentages are a different denominator, as recorded in #1621 and the audit.
- [AI handler](https://github.com/relativityE/speaksharp/blob/ef417e9947583e814d8e3a4fd3665fa2932a393d/backend/supabase/functions/get-ai-suggestions/index.ts): `MAX_TRANSCRIPT_CHARS = 8000`; the request uses the leading slice and a truncation notice. Omitted content cannot be treated as assessed.
- [Focus coverage](https://github.com/relativityE/speaksharp/blob/ef417e9947583e814d8e3a4fd3665fa2932a393d/frontend/src/utils/focusCoverage.ts): deterministic keyword matching; view timestamps are approximate, and finalized authority avoids attaching unsupported quotes/timestamps. Detection is not a semantic-quality judgment.
- [Architecture](https://github.com/relativityE/speaksharp/blob/ef417e9947583e814d8e3a4fd3665fa2932a393d/product_release/ARCHITECTURE.md): newest-one transcript is the approved retention policy; transcript-derived coaching expires with its transcript. This is not proof that the approved policy is activated in Production. Existing activation/deletion work is outside this collection.
- Design-review rubric: **0 absent, 1 partial, 2 coherent in source, 3 observed with users**. The audit scored next step **2**, context **2**, evidence **1**, target continuity **1**, outcome explanation **1**. Felt progress remains **unverified**. These are review judgments, not a product-quality percentage, usability study, or release score.

## Ranked recommendation register

Rank is a proposed discussion order, not a delivery commitment. Impact/effort are qualitative hypotheses; S/M/L are relative sizes, not estimates. **Every row: decision PENDING; owner UNASSIGNED; implementation POST-RWT; release gate NO.**

| Rank / ID | Recommendation and rationale | Current evidence versus proposed work | Expected impact / effort |
|---|---|---|---|
| 1 / R01 | Triage the catch-all PR against the refined goals before selecting new work. Reuse useful existing ideas rather than creating duplicates. | Identity unverified. After confirmation, inventory each item and choose keep, consolidate, defer, or retire with reason and original source. Preserve existing acceptance and separate already-delivered work. | High alignment / M |
| 2 / R02 | Preserve the two AI suggestions and one clear practice action. Keep the chosen content target and criterion understandable across review, retry, and result. | The simple pair exists; canonical continuity overlaps #1548's original contract. Proposed additional semantic assessment must distinguish following “name the price first” from reducing fillers. A metric label in #1621 supplies no semantic proof. | High / L |
| 3 / R03 | Ground both positive feedback and improvement advice in the actual attempt, stated goal, and reliable evidence. | Adjacent measurements exist; relevance and causal support are not established by adjacency. Propose target-specific evidence and clear uncertainty rather than generic praise or invented observations. Any new presentation/persistence is a separate decision. | High / M–L |
| 4 / R04 | Measure visible change and felt progress separately. Explain achieved, moved toward target, no change, insufficient evidence, and not comparable honestly. | Source-level design scores do not establish user comprehension or confidence. Propose separate records for demonstrated target change and perceived relevance/helpfulness/confidence; do not manufacture success through praise. | High / M |
| 5 / R05 | Make metric units and comparison claims explicit. Separate movement from attainment. | Per-minute filler evidence and filler/word percentages are different quantities; source-accepted #1621 addresses its own label scope. Proposed later comparisons must preserve denominators, baseline, target, and comparable conditions. | High trust / S–M |
| 6 / R06 | Bound AI claims to the assessed transcript coverage. | The handler currently sends at most 8,000 leading characters. Propose coverage-aware explanations and evaluation of omitted-content cases. No whole-session assessment claim, new word-count rejection, or truncation-policy change is approved here. | High trust / M |
| 7 / R07 | Review privacy before persisting a content target or comparison evidence. | Architecture's newest-one boundary and coaching expiry apply. A derived target may reveal private content. Propose explicit lifecycle, minimization, deletion, and consent review; no older quotes/audio or second transcript retained by default. | High trust / M–L |
| 8 / R08 | Validate filler detection and clarity claims on a fixed, labeled corpus. | Existing signals and historical evidence do not establish accuracy for every speaker/context. Propose normalized denominators, false-positive/negative analysis, transcript-error sensitivity, comparable session lengths, and subgroup/error review. Treat a clarity score as a proxy until validated. | High / L |
| 9 / R09 | Keep Focus point detection separate from semantic quality. | Keyword detection can miss a paraphrase or detect words without a persuasive explanation. Propose tests of meaning, ordering, and completeness only if that additional outcome is selected; do not relabel detection as quality. | Medium–high / M–L |
| 10 / R10 | Test a minimal practice cue before adding more UI. | The current pair/action is a useful foundation. Propose one short selected-target cue and a comprehension check; avoid extra competing actions, drills, or a dashboard by default. | Medium–high / S–M |
| 11 / R11 | Validate who returns: recurring communication needs versus one-off interview/presentation preparation. | Neither competitor existence nor general communication demand proves SpeakSharp demand. The risk that a 30-day trial satisfies a one-off need before payment is a hypothesis. Test usage cadence and reasons to return without changing trial terms now. | High commercial / M |
| 12 / R12 | Test value at $10/month without claiming uniquely low pricing. | Official alternatives include annual-equivalent prices below $10 and differing commitments/features. Compare actual billing periods, trials, privacy, and use cases; do not infer willingness to pay or parity. No price change proposed for the active launch. | High commercial / M |
| 13 / R13 | Reconcile the forecast to observed costs and customer behavior. | Financial outputs below are unvalidated assumptions, not actual margins, LTV, CAC, or demand. Propose usage/provider costs, trial load, conversion, paid lifetime, refunds, and acquisition-cost measurement before relying on the forecast. | High commercial / M |
| 14 / R14 | Test whether coaching adds benefit beyond repeating alone. | Proposed randomized coaching-versus-retry-alone comparison, with comparable tasks and blinded target-specific assessment where practical. Separately test comprehension, return behavior, actual purchase, and privacy understanding. No efficacy claim or study threshold is established. | High learning / L |
| 15 / R15 | Keep v2/v4 fixed-corpus model evaluation in its existing post-MVP track. | Architecture names #1304/#1390 for comparable v2/v4 authority. Preserve historical benchmark provenance; propose task-relevant accuracy, latency, device, and downstream coaching-error comparisons without changing current engine/model policy. | Medium–high / L |
| 16 / R16 | Consider optional features only after evidence supports them. | Dashboards, reminders, drills, expanded coaching, competitor feature parity, and pricing changes are research options, not launch scope. Prefer a measured improvement in the existing loop before expanding the product. | Unknown / varies |

### Future catch-all triage record

After the intended PR is confirmed, record for each item: original PR/comment and acceptance; existing evidence; contribution to personal feedback, credible visible change, felt relevance, and the next attempt; overlap with R01–R16; keep/consolidate/defer/retire recommendation; reason; decision; owner. Retain useful older ideas. Resolve duplicates without rewriting history. Seek the owner's disposition before changing existing PR scope or closing anything.

## Commercial context and research sources

These sources motivate questions; they do not demonstrate SpeakSharp efficacy, demand, conversion, retention, or market size.

- [Shute, 2008, formative feedback review](https://myweb.fsu.edu/vshute/pdf/shute%202008_b.pdf): research basis for examining specific, actionable feedback. Transfer to this product still needs testing.
- [Microsoft Human-AI Interaction guidelines](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/): rationale for communicating capabilities/limits and supporting understandable interaction; not a certification of this implementation.
- [Orai pricing](https://orai.com/pricing/) and [privacy](https://orai.com/privacy/): reported official snapshot on 2026-10-16, $12 monthly or $49.99 annually and a seven-day card trial. App recording/cloud handling must be distinguished from separate local browser recording tools.
- [Yoodli pricing](https://yoodli.ai/pricing) and [privacy](https://yoodli.ai/privacy): official snapshot, Pro $8/month equivalent billed annually with 10 roleplays/week; Advanced $20/month equivalent annually with unlimited roleplays. Training exclusions differ by plan; do not imply universal exclusion.
- [Speeko subscriptions](https://www.speeko.co/subscriptions) and [privacy policy](https://www.speeko.co/privacy-policy): official snapshot, $29.99 monthly or $8.33/month annual equivalent, seven-day annual trial. Policy describes uploaded/stored audio, transcription processing, and transcript content feedback. Generic privacy marketing is not a substitute for these data-flow details.
- [Microsoft Speaker Coach](https://support.microsoft.com/en-us/powerpoint/rehearse-your-slide-show-with-speaker-coach): an adjacent rehearsal/report/retry alternative. Its free preview and report-lifetime limitations affect comparison; vendor descriptions do not prove a coaching outcome.
- [Financial review record](https://github.com/relativityE/speaksharp/blob/ef417e9947583e814d8e3a4fd3665fa2932a393d/product_release/work_items/financial-analysis/FINANCIAL_MODEL_REVIEW_2026-09-05.md): quoted, **not recomputed**, model outputs are $9.2875 monthly contribution per paid user, $55.725 six-month contribution LTV, $18.575 CAC ceiling at 3:1, and 5/8 paid users for lean/monitored software break-even. All remain unvalidated. Taxes, founder compensation, and one-time legal/accounting costs are excluded.

Privacy wording should distinguish on-device audio transcription, saved transcript retention, later text sent for AI coaching, derived records, and deletion. No blanket “nothing leaves the device” or “nothing to delete” claim follows from private STT. Competitor pricing and policies are dated vendor claims and must be rechecked before a future commercial decision.

## Completion of this collection

This draft is complete as a research collection when its scope, provenance, and pending decisions are reviewable. It creates no acceptance checklist for existing work. Post-RWT triage and any selected implementation remain future, separately authorized decisions.
