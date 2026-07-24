# Proposal / PR scaffold: central entitlement selector

**Status:** DRAFT — scaffold only. No code change in this commit. Implementation to follow after the documentation-canonicalization effort, per Product Owner sequencing.
**Type:** Refactor (entitlement/policy consolidation). Behavior-preserving by intent.
**Owner:** Prod Owner (relativityE)
**Related:** roadmap step 6; entitlement-divergence gap in [`product_release/DOC_MIGRATION_LEDGER.md`](../../product_release/DOC_MIGRATION_LEDGER.md) §8 item 4.

> Scaffold opened for tracking. Not to be implemented until its turn. The target is a **single, well-tested selector** that every consumer calls with the same inputs — reducing the risk that divergent inputs produce inconsistent transcription policy.

---

## Problem (verified against `main`)

`buildPolicyForUser` (`frontend/src/services/transcription/TranscriptionPolicy.ts`) is the intended single source of transcription-policy truth, but it is **called from four sites with independently-derived inputs**:

| Call site | Line | Inputs passed |
|---|---|---|
| `frontend/src/providers/TranscriptionProvider.tsx` | `:93` | `buildPolicyForUser(isPro, safeMode, { allowCloud: canUseCloud })` |
| `frontend/src/hooks/useSessionLifecycle.ts` | `:357` | `buildPolicyForUser(canUsePrivateStt, latestMode, { allowCloud: canUseCloudStt })` |
| `frontend/src/hooks/useSessionLifecycle.ts` | `:744` | `buildPolicyForUser(canUsePrivateStt, safeMode, { allowCloud: canUseCloudStt })` |
| `frontend/src/hooks/useSpeechRecognition/useSpeechRecognition_prod.ts` | `:119` | `buildPolicyForUser(isEffectiveProUser, effectivePolicyMode, { allowCloud: canUseCloudStt })` |

The first boolean is variously `isPro`, `canUsePrivateStt`, and `isEffectiveProUser`; the mode is variously `safeMode`, `latestMode`, `effectivePolicyMode`. These are derived from different upstream state, so the **same user can be handed different policy** depending on which path evaluated first. This has been an acknowledged latent risk (previously refuted as a launch blocker because `startRecording` self-heals, but it remains a correctness/maintainability hazard).

## Target design

A single selector — e.g. `selectEntitlementPolicy(session, subscription, uiMode)` — that:

1. Derives the canonical entitlement facts **once** (is-Pro, private-allowed, cloud-allowed) from one authoritative source (subscription entitlement + tier), rather than each caller re-deriving them.
2. Normalizes the requested mode once (the `safeMode`/`latestMode`/`effectivePolicyMode` divergence collapses to one rule).
3. Returns the `TranscriptionPolicy` via the existing `buildPolicyForUser` (kept as the pure formatter).
4. Is the **only** thing the four call sites invoke.

## Guardrails / non-goals

- **Behavior-preserving.** No entitlement is loosened or tightened; the no-silent-fallback and Cloud-requires-paid-Pro invariants are unchanged. Any behavior delta must be surfaced explicitly and approved.
- No billing/migration/flag change. Cloud stays paid-Pro-only; Private stays default; v4 stays hard-off.
- Do not merge behind a flag without evidence that all four call sites produce identical policy to today for a matrix of (tier × mode × cloud-eligibility) inputs.

## Acceptance criteria / tests

- New unit tests for the selector covering the full (isPro/private-allowed/cloud-allowed × requested-mode) matrix.
- Characterization tests proving each of the four migrated call sites yields the **same** `TranscriptionPolicy` as before the refactor for representative inputs.
- Existing `TranscriptionPolicy.test.ts` and `SpeechRuntimeController.test.ts` remain green.
- Full RC gate battery green before merge.
