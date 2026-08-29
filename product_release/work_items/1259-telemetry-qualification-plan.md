**Status:** Plan — not implemented
**Owner:** Engineering (relativityE)
**Last Reviewed:** 2026-08-29
**Last Verified:** 2026-08-29 (all paths read from `origin/main@0e2fffd1`)
**Applies To:** Qualifying the advice → attempt → later comparable outcome path for #1259.
**Class:** Procedure (work item — temporary).
**Authority:** The qualification plan, closure checklist and falsification set for #1259.
**Not Authoritative For:** release posture, or any claim that telemetry improves retention or coaching.
**Supersedes:** —
**Evidence Sources:** `frontend/src/contracts/nextActionSignal.ts`, `frontend/src/services/AnalyticsBuffer.ts`, `backend/supabase/migrations/20260816223606_metrics_only_additive_1306.sql`.

# #1259 — telemetry qualification

**This is an existing path to qualify, not a greenfield feature.** Treating it as new work would rebuild
mechanisms that already ship and would miss the two real gaps below.

## 1. What already ships

| Piece | Where | State |
|---|---|---|
| Advice identity, persisted | `sessions.next_action_signal JSONB` (`20260816223606_metrics_only_additive_1306.sql:25`) | ships |
| Written atomically with the session | `complete_session_v2(… p_next_action …)` | ships |
| Advice schema, **fully coded** | `contracts/nextActionSignal.ts` | ships |
| Rendered to the user | `AnalyticsDashboard.tsx:740` | ships |
| Event transport + buffering | `services/AnalyticsBuffer.ts` | ships |

**Schema identity is already strong.** `NextActionSignal` is `{reasonCode, actionCode, metric, value,
comparator, templateVersion}`, every field drawn from a closed enum (`REASON_CODES`, `ACTION_CODES`,
`METRIC_CODES`, `COMPARATOR_CODES`), versioned by `templateVersion: 'rec_v1'`.

**That closed enum is itself the privacy control for advice identity**: prose, transcript text and rehearsal
free text cannot be represented in it at all. This is a structural guarantee, not a filter — it does not need
a runtime test to prove text cannot pass, only a test that the enum stays closed.

## 2. Gap A — the outcome-loop events get the WEAKER sanitizer

`AnalyticsBuffer` applies two different policies (`AnalyticsBuffer.ts:198-201`):

| Event shape | Policy | Strength |
|---|---|---|
| `private_*` | `sanitizePrivateTelemetryProps` — **allowlist re-projection** | strong: a non-allowlisted field cannot survive even if a caller bypasses the emitter |
| everything else | `sanitizeAnalyticsProperties` — **denylist on key NAMES**, `/(transcript\|audio\|wav\|blob\|base64)/i` | weak |

Outcome-loop events are **not** `private_*`, so they fall to the denylist. A field named `content`, `notes`,
`spokenText`, `agenda` or `talkingPoints` carries its value to PostHog **unredacted** — the regex matches the
key's *name*, not the value's nature.

Compare the persistence boundary, which is an **allowlist that fails closed**: an unknown filler key is
rejected outright rather than dropped (`storage.ts` `validatePersistedFillerCounts`). The two boundaries have
opposite postures, and the weaker one guards the events this lane will add.

**Required:** outcome-loop events must be re-projected through an allowlist, like `private_*`. Adding key names
to the denylist regex is not a fix — it re-opens on the next field anyone invents.

## 3. Gap B — attempt and comparability do not exist

Already recorded on the ticket. Advice plus later improvement is an **association**; it cannot show the user
saw the advice, attempted it, or that the advice caused the change. Missing:

1. **Attempt evidence** — explicit acknowledgement, or a defensible inferred-attempt rule.
2. **Comparable-session eligibility** for outcome comparison. A floor already exists for progress
   (`>= 30s` **and** non-null composite quality, `aggregateProgress.ts:24,111`); outcomes need their own
   stated rule, not a borrowed one.
3. **Target-specific outcome** — the metric the advice actually targeted (`metric` is already in the signal,
   so the join key exists; the measured outcome does not).
4. **Chronology** — the outcome session must be strictly later than the advice, with no interleaved advice of
   the same `actionCode` muddying attribution.
5. **Absence handling** — no advice, advice with no later session, or a later session below the eligibility
   floor must each produce an explicit "not measurable" state, never a flattering default.

## 4. Closure checklist

- [ ] Event/schema identity: every emitted outcome event validates against a versioned contract; an unknown
      field is **rejected**, not dropped.
- [ ] Privacy boundary: outcome events re-projected through an **allowlist**, proven by a test that sends a
      plausibly-named prose field and asserts it does not reach the transport.
- [ ] No transcript and no rehearsal free text can reach telemetry, by construction rather than by regex.
- [ ] Chronology and comparability rules stated and enforced.
- [ ] Absence handling: all three absence cases produce explicit not-measurable states.
- [ ] **"Implemented" and "proven to improve retention or coaching" reported as separate statuses.** Shipping
      the instrumentation proves neither, and the ticket must not conflate them.
- [ ] Exact-head CI with every job reported individually.

## 5. Expected mutant casualties — named before implementation

| # | Mutant | Must fail |
|---|---|---|
| T1 | Emit an outcome event with a prose field named `notes` | the allowlist test — under today's denylist this **passes**, which is the gap |
| T2 | Widen the denylist regex instead of adopting an allowlist | the posture test: a newly-invented key name must still be refused |
| T3 | Add a free-text field to `NextActionSignal` | the closed-enum test |
| T4 | Compare against a session earlier than the advice | the chronology test |
| T5 | Count a sub-floor session as a comparable outcome | the eligibility test |
| T6 | Return an improvement figure when no advice was issued | the absence test |
| T7 | Report "implemented" as evidence of coaching benefit | the separated-status assertion |

## 6. Out of scope

No claim that telemetry improves retention or coaching outcomes. No production write, migration, or
deployment. No STT, runtime, or model files.
