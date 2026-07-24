# Codebase Map — product intent → code path → protecting test → doc

A breadcrumb for new developers. It answers: where a product promise lives in code, which test protects it, and which doc to update when you change it. Paths are repo-relative and verified against `main`. Keep this current; do **not** add PR narratives here.

> Baseline: last product-behavior change `main` `c25b2178` (#1024) atop `a37a6ba1` (#1027) and `c99208b9` (#1022); current `main` HEAD `05643fbd` (audit tooling only). See `RELEASE_STATUS.md` (SSOT). The durable outbox / provenance / owner-alert / retrieval architecture is **DRAFT #1006 — NOT shipped, NOT deployed, NOT activated**; it is called out below where relevant.

## 1. Product direction
- **Private = Recommended** and the main beta experience. **Browser = "Quick preview"** (not equivalent to Private). **Cloud = Pro**, unavailable to Free testers during the no-billing beta (existing paid-Pro accounts retain access).
- Product roadmap direction: **Rehearsal Sandbox → HUD → Live Companion** (see `product_release/BACKLOG.md` P2.1–P3.1; not built yet).

## 2. Session / UI (mode hierarchy + post-save)
- Mode selector, opaque dropdown, one desktop description flyout, one touch About panel, mic/timer/pill:
  - [frontend/src/components/session/LiveRecordingCard.tsx](../frontend/src/components/session/LiveRecordingCard.tsx) — controls the dropdown (opaque), the single `activeMode` → [ModeDescriptionFlyout.tsx](../frontend/src/components/session/ModeDescriptionFlyout.tsx), and the About panel ([HelpPopover.tsx](../frontend/src/components/session/HelpPopover.tsx)); About and dropdown are mutually exclusive.
  - [frontend/src/components/ui/dropdown-menu.tsx](../frontend/src/components/ui/dropdown-menu.tsx) — the opt-in `opaque` variant (no whole-surface fade) used by the STT menu.
- One authoritative post-save surface + persistent Analytics action (no toast):
  - [frontend/src/components/session/StatusNotificationBar.tsx](../frontend/src/components/session/StatusNotificationBar.tsx) — the single saved-state surface; persistent accessible (emerald, WCAG-AA) Analytics action with a bounded→persistent cue.
  - [frontend/src/pages/SessionPage.tsx](../frontend/src/pages/SessionPage.tsx) — the truthful post-save gate; suppresses the recording-card pill so it does not duplicate "Session saved". **`PostSaveToast` / "Next: Analytics" are deleted.**
- Protecting tests: [tests/e2e/mode-selector-private-first.e2e.spec.ts](../tests/e2e/mode-selector-private-first.e2e.spec.ts) (order/tags, one flyout + geometry, opaque menu, About⇄dropdown mutual exclusion, responsive 320/375/390/1280); [tests/e2e/post-save-consolidation.e2e.spec.ts](../tests/e2e/post-save-consolidation.e2e.spec.ts) (one surface, no toast, pill reset, persistent Analytics, WCAG contrast).

## 3. STT policy / entitlements
- [frontend/src/services/transcription/TranscriptionPolicy.ts](../frontend/src/services/transcription/TranscriptionPolicy.ts) — mode/entitlement policy.
- [frontend/src/constants/subscriptionTiers.ts](../frontend/src/constants/subscriptionTiers.ts) — tier definitions.
- Centralizing the entitlement decision into one selector is tracked as **BACKLOG P1.3** (not yet done).

## 4. Billing (dual fail-closed)
- **Frontend switch:** [frontend/src/config/appRuntimeConfig.ts](../frontend/src/config/appRuntimeConfig.ts) (payments-enabled flag).
- **Backend switch + checkout:** [backend/supabase/functions/stripe-checkout/index.ts](../backend/supabase/functions/stripe-checkout/index.ts).
- **Freeze proof:** [scripts/billing-freeze-check.mjs](../scripts/billing-freeze-check.mjs) — CI proves billing is CLOSED. During the beta BOTH switches are OFF; enabling billing requires the separate paid-launch sequence.

## 5. Persistence and feedback (Supabase = source of truth)
- **Sessions:** `sessions` table + migrations under [backend/supabase/migrations/](../backend/supabase/migrations/) (e.g. `20250819072116_add_accuracy_to_sessions.sql`).
- **Issue reports:** [backend/supabase/migrations/20260605080000_user_issue_reports.sql](../backend/supabase/migrations/20260605080000_user_issue_reports.sql); submitted via [frontend/src/services/issueReportService.ts](../frontend/src/services/issueReportService.ts).
- **Supabase is authoritative** for saved sessions and issue reports. **PostHog is observability / best-effort client capture — its absence does NOT prove a session/report failed to persist.** Sentry carries failures + sanitized alerts only, not full feedback storage.
- The durable server-side **outbox + server-assigned provenance + owner-alert + protected retrieval** architecture is **DRAFT #1006 — NOT shipped**; do not treat it as current behavior.

## 6. Security perimeter
- **Exact-origin CORS:** [backend/supabase/functions/_shared/cors.ts](../backend/supabase/functions/_shared/cors.ts) — the production origin allowlist. Deployed + live-DAST proven (rc-gates Gate 3).
- **Migration deploys** are gated, manual `workflow_dispatch` + protected environment: [.github/workflows/deploy-supabase-migrations.yml](../.github/workflows/deploy-supabase-migrations.yml).

## 7. Observability & release operations
- **Ops health:** [scripts/ops-health.mjs](../scripts/ops-health.mjs) via [.github/workflows/ops-health.yml](../.github/workflows/ops-health.yml).
- **CI:** [.github/workflows/ci.yml](../.github/workflows/ci.yml) (unit/e2e/coverage; UX screenshot artifacts `retention-days: 1`). **Release gates:** [.github/workflows/rc-gates.yml](../.github/workflows/rc-gates.yml) (Gate 1 Product Truth, 2 SAST, 3 DAST/CORS, 4 SCA, 5 UX Smoke).
- **Deploy-version signal (there is NO `version.json` endpoint):** the deployed commit SHA is injected into `index.html` at build time as an inline `<script>window.__APP_RELEASE__=…</script>` (release-inject plugin in [frontend/vite.config.mjs](../frontend/vite.config.mjs)), resolving `BUILD_ID ?? VERCEL_GIT_COMMIT_SHA ?? GITHUB_SHA ?? 'dev'`; on Vercel prod it resolves to `VERCEL_GIT_COMMIT_SHA`. It is **NOT** a `__BUILD_ID__` JS `define` — that define was **removed** (PR #1027) because inlining the volatile SHA into a JS chunk rotated content hashes across the import graph every deploy, 404-ing long-lived tabs on rotated-away lazy chunks. The Sentry Vite plugin's release **injection is disabled** (`release.inject: false`) for the same reason; Sentry gets its release at runtime from `window.__APP_RELEASE__` (`Sentry.init`, [frontend/src/main.tsx](../frontend/src/main.tsx)). The SHA surfaces at runtime as `appRuntimeConfig.release` / `window.__APP_RUNTIME_CONFIG__.release` (reads `window.__APP_RELEASE__`, [frontend/src/config/appRuntimeConfig.ts](../frontend/src/config/appRuntimeConfig.ts)) and as PostHog `release_sha`. Verify deploy/SHA-equality by reading `window.__APP_RELEASE__` from the deployed `index.html` (or `window.__APP_RUNTIME_CONFIG__.release`) — **not** a `__BUILD_ID__` define (removed). **Caveat:** `vercel.json` rewrites every unmatched **app** path to `index.html` (but `/assets/*`, `/models/*`, `/api/*` are excluded → a real 404 on a miss, never HTML), so an HTTP `200` from an arbitrary app URL (e.g. `/version.json`) is **NOT** endpoint proof — it may be the SPA fallback returning HTML. Any future version endpoint must be **build-generated** (not a committed static file) and its health check must assert `Content-Type: application/json` + expected schema + exact SHA equality, never `200` alone.
- **Doc ownership boundary:** `RELEASE_STATUS.md` = current deployment posture; `BACKLOG.md` = unfinished work; `ACTIVE_COORDINATION.md` = current board. Do not mix.

## 8. When changing X, update Y
- **selector / mode copy** → `PRODUCT_FEATURES.operational.md` + tester docs + `tests/e2e/mode-selector-private-first.e2e.spec.ts`.
- **post-save UI** → `PRODUCT_FEATURES.operational.md` + `ARCHITECTURE.operational.md` + `tests/e2e/post-save-consolidation.e2e.spec.ts`.
- **env / flags** → `ENV_INVENTORY.md` + `LAUNCH_ENV_CHECKLIST.md`.
- **release gates / workflows** → `RC_GATES.md` + `RC_TEST_INVENTORY.md`.
- **persistence / telemetry** → `ARCHITECTURE.operational.md` + `INTERNAL_TEST_PROTOCOL.md`.
- **product priority** → `BACKLOG.md` + `ACTIVE_COORDINATION.md`.
- **current deployment posture** → `RELEASE_STATUS.md` only.
