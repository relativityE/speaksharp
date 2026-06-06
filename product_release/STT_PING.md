# STT Ping Log — Current Queue

This is the fast dev⇄test channel. Keep it short.

Rules:
- Only current, actionable handoffs live here.
- When an item is answered or superseded, replace it with the latest state.
- Evidence details belong in STT reports/artifacts; old ping history remains in git.
- Every active line ends with the current ball: `=> dev`, `=> test`, `=> product`, or `=> product-ops`.

Last hygiene reset: `2026-06-06T14:20Z`.

## Active

| Updated UTC | ID | Status | Latest Evidence / Ask | Ball |
|---|---|---|---|---|
| 2026-06-06T14:12Z | SELFHOST-MODELS-MAXDEPTH | **FAIL / dev action** | Base opt-in setup/transcription succeeds, but max-depth persists. Latest artifact: `/private/tmp/stt-maxdepth-console-wrapper-base-h1_6.json`; WER `0`, journey/detail pass, `Maximum update depth exceeded` = `12`, `Initializing transformers-js` = `5`. In-page `console.error` wrapper proves React does **not** emit component-stack args in this Vite/browser build; waiting for `at <Component>` lines will stall. Best path: use the persisted Zustand/update path and narrowed consumers (`SessionPage` → `StatusNotificationBar` / `MobileActionBar`; `useSessionLifecycle` data-model-status observer). | `=> dev` |
| 2026-06-06T14:25Z | V4-RELEASE-PATH | **reactivated / needs candidate** | Product reactivated v4 for release investigation. Current evidence: explicit v4 full-auth app lifecycle previously passed once (`/private/tmp/stt-v4-realbrowser-h1_6.json`, non-empty, saved/detail, WER `0.375`) before device telemetry; device-telemetry rerun then proved WebGPU worker path (`resolvedDevice=webgpu`, `backend=webgpu`, `fallbackOccurred=false`) but failed every inference with `invalid data location: undefined for input "a"` and no save (`/private/tmp/stt-v4-device-proof-092617c5-autosetup.json`). Standalone probe works on main-thread WebGPU; app worker WebGPU fails. Next dev action: supply a release-candidate integration path or explicit decision among main-thread WebGPU prototype, worker/ORT workaround, different export/runtime, or guarded experimental path with known limits. Test can re-run once a new candidate is named. | `=> dev/product` |
| 2026-06-06T14:30Z | REVIEWER-REPORT-DISPOSITION | **aligns with corrections** | Independent review aligns on controlled-soft-release `CAVEATED GO` and broad-public `HOLD` until ops/selfhost close. Corrections to avoid stale signals: (1) empty Stripe key no longer means full app boot goes to `ConfigurationNeededPage` after `CONFIG-GATE-RELAX`; app boots and payment surfaces are hidden/guarded when Stripe is missing. (2) v4 is reactivated by product, but current app-worker WebGPU evidence still fails with `invalid data location`; it needs a new candidate path before test can green it. (3) selfhost remains unmerged/active; diagnostic zero-HF pass exists, signed-in final evidence hung after transcript result. | `=> dev/product/product-ops` |
| 2026-06-06T14:05Z | SELFHOST-MODELS | **test partial / land decision** | Diagnostic zero-HF proof passed (`0` HuggingFace requests, model assets from origin); signed-in base opt-in printed WER `0` / `100%` but the corpus harness hung before final `STT_CORPUS_EVIDENCE`, so save/detail/zero-HF were not recaptured in that run. Dev recommends landing on combined evidence; product/dev decide whether to accept or request a shorter signed-in proof. | `=> product/dev` |
| 2026-06-06T13:34Z | CONFIG-GATE-RELAX | **PASS / landable** | With Supabase env only and Stripe/Sentry unset, `/auth/signup` and `/pricing` boot instead of `Configuration Required`; `stripeKeyClass=missing`; pricing exposes no checkout button, only `Start Free`. | `=> dev` |
| 2026-06-06T13:20Z | RELEASE-OPS | **pre-release ops** | Stripe: prod must use live Stripe key or hide/disable payment conversion surfaces. Feedback: apply `user_issue_reports` migrations or hide Report issue. These are product-ops, not STT model bugs. | `=> product-ops` |

## Recently Closed / Superseded

| Updated UTC | ID | Result |
|---|---|---|
| 2026-06-06T14:12Z | MAXDEPTH-COMPONENT-STACK-REQUEST | Answered. In-page wrapper captured only warning string + JS/Zustand stack; no React component-stack args exist in this run. |
| 2026-06-06T13:09Z | CONSOLE-TO-LOGGER | PASS. Static `console.*` guard clean; production-preview public-route console audit clean. |
| 2026-06-06T13:20Z | FRIENDLY-COPY-ITEM8 | Closed as stale. Friendly mode labels landed in `738b1929`; no current test work unless product asks for a new copy pass. |
| 2026-06-06T13:20Z | PRIV-DOWNLOAD-CONSENT | Closed as stale. Model-aware consent landed in `738b1929`; base.en size corrected to ~80 MB in `1c567431`. |
| 2026-06-06T05:18Z | RELEASE-UX-COPY | Code-side copy fixes complete: stale `Vault Mode` removed from `frontend/src`; auth-wall CTAs routed/copy-adjusted. |

## Deferred / Lower Priority

| ID | State |
|---|---|
| ZERO-HF-CI | Useful hardening hook after selfhost-models lands; not a blocker for the current max-depth fix. |
