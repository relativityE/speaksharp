# Memo — distil bakeoff selector: which knob shape?

**For:** Product owner review · **From:** Dev · **Date:** 2026-06-11 · **Branch:** `dev/v4-integration`

## Problem

To close **V4-CANDIDATE-SELECTION** we must run **both** `base_q4` and `distil_q4` under *identical*
Gate A conditions (real WebGPU, padded fake-audio, `selectionSource=dev_harness`) and pick one winner
before any PostHog A/B. Today `distilEnabled` comes **only** from the PostHog flag
`private_stt_v4_distil_enabled`, so the dev_harness/forceAuto path always resolves to `base_q4`. We
therefore need a **dev/test-only** way to select distil under the same conditions — without touching
production targeting.

**Non-negotiable constraint (owner):** the distil selector is a **test-cell selector, not a customer
feature**. It must be dev/test-gated, production-inert, allowlisted (no arbitrary model/variant/dtype/
URL/backend), and label evidence `selectionSource=dev_harness`. Cautionary precedent: the early-session
`?engine=v4` regression where an ungated URL param could select an engine in production.

## Current state (why this is a fork, not a clean build)

While preparing to add a `forceDistil` boolean, I found **Codex already wired an allowlisted
`?v4Variant=base_q4|distil_q4` selector** end-to-end (uncommitted, working tree):
- `privateV4Experiment.ts`: `v4Variant` read from `?v4Variant` / `speaksharp.v4.variant`, **allowlisted
  to exactly `['base_q4','distil_q4']`**, behind the same `experimentAllowed()` gate (`DEV || ENV.isTest`).
- Resolver (`PrivateSTT.ts`): `distilEnabled = flag || (forceAuto && v4Variant === 'distil_q4')`.
- Harness: `STT_V4_VARIANT` → `?v4Variant`.
- Test: Case B's production-bypass URL already includes `&v4Variant=distil_q4` and still asserts v2-base
  (production proven to ignore it).

So the mechanism exists and works; the only open question is its **shape**.

## Options

### Option A — keep the allowlisted `?v4Variant=base_q4|distil_q4` (Codex's), and harden it
- **Mechanism:** 2-value allowlisted string; `forceAuto + v4Variant=distil_q4` → distil (dev/test only).
- **Security:** dev/test-gated, prod-inert (Case B tests it), allowlisted to ONLY the two known
  candidates (anything else is rejected → base/v2), `selectionSource=dev_harness`.
- **Pros:** already wired + partially tested; ONE mechanism runs BOTH bakeoff arms
  (`?v4Variant=base_q4` and `?v4Variant=distil_q4`) — the natural shape for an A/B; no undo of Codex's work.
- **Cons:** it's a `?variant=` string, the shape you flagged to avoid proliferating; a future maintainer
  could be tempted to widen the allowlist.
- **Hardening I'd add:** dev/test `forceAuto+variant=distil_q4`+WebGPU → `distil_q4` + `dev_harness`
  test; a localStorage prod-ignore test; a runbook line: "harness-only bakeoff control, never widened,
  never a PostHog/prod selector."

### Option B — convert to a `forceDistil=true` boolean (your stated preference)
- **Mechanism:** single boolean; `forceAuto` alone → base_q4, `forceAuto + forceDistil` → distil_q4.
- **Security:** same gating/inertness; maximally misuse-resistant — a boolean **cannot** be widened to
  arbitrary values.
- **Pros:** smallest possible surface; "harder to misuse later"; exactly one explicit override.
- **Cons:** undoes Codex's uncommitted `v4Variant` wiring (resolver + harness + Case B) and re-does it as
  a boolean; the base arm becomes "flag absent" (implicit) rather than an explicit `?v4Variant=base_q4`.
- **Work:** rewire experiment override + resolver + harness; update Case B; add dev/test + prod-ignore
  tests; doc.

## Security verdict: equivalent on what matters
Both are dev/test-gated, production-inert, **non-arbitrary** (A allowlisted to 2 values; B a single
boolean), and label `selectionSource=dev_harness`. Neither is customer-reachable in a production build.
The difference is **shape / future-proofing**, not a present security gap.

## Recommendation
**Option A (keep + harden the allowlisted `v4Variant`).** It already satisfies every security guardrail
— the strict 2-value allowlist makes it non-arbitrary — it's wired + partly tested, and a 2-value
selector is the natural fit for a bakeoff that runs both arms. Your "boolean is harder to misuse" point
is valid but marginal given the allowlist; I'd honor its spirit by keeping the allowlist locked to the
two candidates, commenting + runbook-noting that it must never be widened or exposed in prod, and adding
the prod-ignore tests.

If you weight minimal-surface/future-proofing over avoiding churn, **Option B** is also fully acceptable
and I'll convert.

## Decision needed
**A** (keep + harden allowlisted `v4Variant`) or **B** (convert to `forceDistil` boolean)?
Either way I then add: dev/test-selects-distil test, prod-ignores test (URL + localStorage), runbook
"harness-only" note; Test runs the base_q4 vs distil_q4 bakeoff; we apply the selection rule
(distil wins only if WER ≤ base +0.02 **and** RTF ≥25–30% faster, no fallback, clean save/detail).
