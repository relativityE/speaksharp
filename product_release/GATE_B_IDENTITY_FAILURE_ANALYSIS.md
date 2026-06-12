# Gate B (`POSTHOG-STT-A/B`) — Failure Chain & Resolution (✅ RESOLVED)

**Status:** ✅ **RESOLVED (2026-06-12)** — identity materialized via Option B (real human login); operator targeting applied (Method A); official STT A/B stacked browser proof **PASS** (targeted v4 + negative control). The historical automated-proof status `FAIL_AUTH_POSTHOG_IDENTIFY` was root-caused to PostHog client-side bot filtering of the automation browser, **not an app defect** — full chain + Resolution below.
**Last updated:** 2026-06-12 · **PostHog project:** 207400 · **posthog-js:** 1.298.1
**Target user.id:** `22899590-4af1-4a0c-88d6-b00996cb5ae0` · **Flag:** `private_stt_v4_enabled` (709644)

## Goal
Prove that a specific targeted Pro user receives the `private_stt_v4_enabled` flag on the deployed app so v4 STT can roll out to internal testers. The flag is bucketed on `distinct_id`, so PostHog Cloud must hold a **queryable person at the Supabase `user.id`**, created by the deployed app, with **no PII**.

## TL;DR (calibrated)
After five PRs that each fixed a real layer, **the deployed app is correctly *instrumented* for real human users based on current evidence** — it identifies by `user.id` (no PII) and emits a non-PII `account_identified` event intended to materialize the person. **The final server-side person-materialization proof is now COMPLETE** (Option B, 2026-06-12): a queryable PostHog person exists at the `user.id` with real `$identify` + `account_identified` web events and `hasEmailProperty=false`. See **Resolution** below.

The remaining automated failure **appears to be a verification-environment cause, not an app defect**: PostHog's client-side bot filtering (on by default) suppresses event capture from automation browsers (`HeadlessChrome` UA and `navigator.webdriver`) while still allowing feature-flag (`/flags`) requests — which matches the observed symptom exactly. The Test harness UA / `navigator.webdriver` has not been directly inspected, so this is a **high-confidence inference**, not a fully proven production success.

## Background (architecture)
- **Supabase** owns identity (`user.id`); **`AuthProvider.tsx`** fires `analyticsBuffer.identify(user.id)` on login.
- **`AnalyticsBuffer.ts`** wraps PostHog (+Sentry) and enforces the privacy contract (no email/transcript/audio; `user.id` only).
- posthog-js `1.298.1` defaults `person_profiles: 'identified_only'` — a queryable person is created only once an **ingested event** is tied to the identified `distinct_id`.

## The failure chain

| PR (merge SHA) | Hypothesis | Change | Result |
|---|---|---|---|
| **#748** `7c988821` | App never identifies authed users | Identify by `user.id` only (no PII); reset on sign-out; reload flags | Browser-local `distinct_id = user.id` OK; **server-side: no person**. |
| **#749** `79b224f` | Deferred `setTimeout(0)` `posthog.init()` raced the identify effect (identify ran pre-init) | Initialize PostHog **synchronously before render** | Local OK; **server still empty** (0 web `$identify`). Init race was real but not the whole story. |
| **#750** `661fa799` | `identified_only` needs an **ingested event**; the lone `$identify` didn't reliably ingest | Emit non-PII `capture('account_identified', {source:'auth_provider'})` after identify. **P2** (`d4fadd22`): isolate it in its own try/catch so a capture failure can't block `reloadFeatureFlags()` | Deployed; **server still empty**. Test observed `/flags` but **zero `/e/`**. |
| **#751** `ddfe620d` | Event batch-queued (~3s) and never flushed before the short session ends | `posthog.flush()` after the capture | **No-op.** `/e/` still zero. |
| **#752** `89627638` | Use `send_instantly` to bypass the batch queue | `capture(..., { send_instantly: true })` + non-PII observability hook `window.__SS_ANALYTICS_IDENTITY__` + real-posthog integration test | Deployed; probe proves the app path ran (`accountIdentifiedSendInstantly=true`, no error), **but `/e/` still zero** across fetch/XHR/sendBeacon. |

## Process failures & lessons (candid)
1. **#751 was the worst miss.** `posthog.flush()` was added from a grep of the **minified** bundle (which matched the *private* `_flush`) and asserted public — it is **not** (per type defs and PostHog docs, the browser SDK exposes no public `flush()` for custom events). The guarded call was a silent no-op and cost a full merge→deploy→proof cycle. **Corrective rule now in force: verify third-party API contracts against source/types/docs before use.**
2. **Too many deploy→proof cycles, not enough local ground-truth.** Each blind round is expensive (merge, Vercel deploy, real-browser proof). Process changed to: read source, reproduce/instrument locally, then ship one verified fix.
3. **#752's integration test surfaced a real limitation honestly:** jsdom cannot exercise posthog's network transport at all. Rather than overclaim a passing network test, this was documented and the observability hook added — which is what finally exposed the true root cause.

## Final root cause (verified at source; doc-supported)
posthog-js `1.298.1` `capture()` (decompiled):
```js
var s = !this.config.opt_out_useragent_filter && this._is_bot();
if (!(s && !this.config.__preview_capture_bot_pageviews)) { /* …rate-limit… ; SEND */ }
// else: event built/processed but NEVER sent
```
- `opt_out_useragent_filter` default = **`false`** → bot-filtering **on**. (PostHog config docs: by default PostHog does **not** send events matching user-agent bot filtering; setting `true` keeps them and instead sets `$browser_type`.)
- Bot list includes **`headlesschrome`, `webdriver`, `bot`, `crawler`, `spider`**; `_is_bot()` also returns true when **`navigator.webdriver`** is set (`return !!t.webdriver`).
- **Empirically confirmed:** `posthog._is_bot() === true` under a `HeadlessChrome` UA.
- **Feature flags are not bot-gated** → `/flags` fires even when capture does not. (PostHog flag-troubleshooting docs: `/flags` is triggered by SDK init, `identify()`, property updates, and `reloadFeatureFlags()`, and is separate from event capture.)
- Matches Test's evidence exactly: `identifyCalls=1`, `accountIdentifiedSendInstantly=true`, `lastError=null`; `eRequestCount=0`; only `/flags`.

**References:** PostHog JS config (`opt_out_useragent_filter`); PostHog feature-flag troubleshooting (`/flags` triggers); PostHog JS usage (`send_instantly`, no public `flush()`).

## What is proven vs not (calibrated)
- **Proven:** identity contract (`user.id` only, no PII, reset on sign-out, reload flags); the app calls `capture('account_identified', {source:'auth_provider'}, {send_instantly:true})` non-fatally, before `reloadFeatureFlags()`, PII-free (unit + real-posthog integration tests).
- **NOW PROVEN (2026-06-12, Option B):** a non-bot real human login created the **server-side person** at the `user.id` (real `$identify` + `account_identified`, `hasEmailProperty=false`); operator targeting then applied (Method A); official A/B stacked proof PASS. See **Resolution** below.

## Options to unblock

| Option | What | Trade-offs | Owner |
|---|---|---|---|
| **A — Harness as real user (PRIMARY)** | Test reruns the proof in a **non-bot** browser context: real Chrome UA, `navigator.webdriver` masked/false (e.g. `--disable-blink-features=AutomationControlled` + UA override). | No prod change; preserves production bot-filtering; faithful to real users; **repeatable**. Requires the harness to defeat PostHog's bot heuristics. | Test |
| **B — One-time real human login (FALLBACK)** | A real person logs in once as the disposable Pro user on a normal browser to materialize the person; then Product targets the `user.id` and Test verifies flag eval + the official A/B proof. | Fast one-time unblock; no code/harness change; **not** repeatable automation. Label as a **one-time manual release-unblock proof**, not the durable Gate B harness. | Release owner / Product |
| ~~C — App disables bot filter~~ | `opt_out_useragent_filter: true` in `posthog.init`. | **Do not.** Changes production analytics semantics; admits bot/crawler traffic → noise + person inflation. | — |
| ~~D — Server-side materialization~~ | Create the person via posthog-node under the `user.id`. | **Do not** (except as an admin repair). Doesn't prove the client identity path the gate exists to verify. | — |

## Decision (reviewer-approved)
> **Proceed with Option A as the primary Gate B proof.** Test reruns the deployed browser proof using a non-bot browser context: real Chrome UA, `navigator.webdriver` masked/false, and explicit logging of: UA, `navigator.webdriver`, `posthog._is_bot?.()`, `/e/` count, `/flags` count, server-side person query, and final flag value.
>
> **Fallback:** If harness modification blocks release timing, use **Option B**: one real human login as the disposable Pro user to materialize the PostHog person, then run the server-side person/flag verification. Mark this as a one-time manual unblock, not the durable automated Gate B proof.
>
> **Do not use Option C or D unless explicitly directed.** C changes production analytics semantics; D bypasses the app path the gate is meant to prove.

### Option A success criteria (Test)
```
navigator.webdriver === false
UA does not include HeadlessChrome / automation markers
posthog._is_bot?.() === false   (if accessible)
/e/ request observed (POST .../e/ carrying account_identified)
server-side person exists at Supabase user.id (22899590-…)
flag eval returns private_stt_v4_enabled (after operator targeting)
hasEmailProperty === false ; mutations === [] before identity pass
```

## Independent open items
- ✅ **Closed:** `private_stt_v4_enabled` no longer targets the client-settable `isInternalTester` — Method A replaced it with a `distinct_id exact` operator condition on the `user.id` (flag 709644 v3), closing the self-grant finding.
- ✅ **Closed:** the identity fix chain (#749/#750/#752) is on the deploy line.

## Resolution (2026-06-12)

**Outcome: Gate B closed.** The chain above bottomed out at **PostHog client-side bot filtering** (not an app defect): the automation browser's `HeadlessChrome`/`navigator.webdriver` made `_is_bot()` true, so `capture()` was silently dropped while `/flags` still fired. Resolved without touching production analytics semantics (no Option C/D):

1. **Identity materialized (Option B).** A one-time real human login as the disposable Pro user emitted real `/i/v0/e/` events; PostHog now holds a **queryable person** at `distinct_id = 22899590-4af1-4a0c-88d6-b00996cb5ae0` with web `$identify` + `account_identified`, `hasEmailProperty=false`, `mutations=[]` before the identity pass. The #748→#752 fix chain + bot-filter diagnosis are validated end-to-end.
2. **Operator targeting applied (Method A).** Flag `private_stt_v4_enabled` (709644) → v3: release condition `distinct_id exact "22899590-…"` @100%; the client-settable `isInternalTester` condition **removed**; `private_stt_v4_distil_enabled` (709645) stays OFF. Server-side eval = `true` / `condition_match`.
3. **Official STT A/B stacked browser proof — PASS.** Against `#754 + #755` (data-layer commit-boundary withhold + P2 seam fix) on the v4 candidate, served via `build:test` + `serve:e2e`:
   - **Targeted Pro:** `selectionSource=posthog_flag`, provider `transformers-js-v4`, variant `base_q4`, runtime `webgpu`; WER 0.1099; `canonicalRtf=0.0760`; save/history/detail PASS; **post-stop visible integrity PASS** (`postStopWer = selectedForSaveWer = 0.1099`, exact text match, **0** `"It's a question"` repeats); processing-local fallback visible while finalizing.
   - **Negative control (non-targeted Pro):** stayed default v2 (`selectionSource=default`, `transformers-js`); WER 0.0890; post-stop integrity PASS.
   - Artifacts: `speaksharp-stacked-latest-targeted-1781278620.json`, `speaksharp-stacked-latest-negative-1781278730.json`.

**Privacy contract held throughout:** PostHog `distinct_id` = Supabase `user.id`; no email/PII; no client-settable targeting. **Remaining work is release-owner merge sequencing of the transcript/audit PRs — no further Dev code required for Gate B.**
