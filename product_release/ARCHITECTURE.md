**Status:** Authoritative (SSOT for system structure, boundaries, persistence & retention, and authority ADRs)
**Owner:** Engineering (relativityE)
**Last Reviewed:** 2026-07-28
**Last Verified:** 2026-07-28 — consolidated from approved sources (`ARCHITECTURE.operational.md`, `CODEBASE_MAP.md`) and cross-checked against the cited `frontend/` and `backend/` code paths. No volatile run IDs or SHAs are carried here — release posture lives in `RELEASE_STATUS.md`.
**Applies To:** The SpeakSharp beta platform — the React/Vite SPA, the Supabase persistence + Edge Function layer, and the CI/release machinery that ships them.
**Class:** Architecture invariant / ADR.
**Authority:** The source for system context, component boundaries and ownership, trust/data-flow, persistence & retention boundaries, identity & session lifecycle, the engine identity/provenance contract, requested-mode vs normalized-capability separation, failure/fail-closed boundaries, the release-identity mechanism, and the authoritative-source ADRs (entitlement, retention).
**Not Authoritative For:** user-visible product guarantees & the feature contract (→ `PRODUCT_REQUIREMENTS.md`); tier / entitlement / quota / billing *mechanics* and pricing (→ `ENTITLEMENTS_AND_BILLING.md`); the Session Progress / scoring model (→ `COACHING_SCORE.md`); STT runtime/data contracts, baselines, accuracy & SLOs (→ `STT.md`); deferred / future sequencing (→ `ROADMAP.md`); current deployment posture, run IDs & SHAs (→ `RELEASE_STATUS.md`); the entitlement *implementation* refactor (tracked separately as issue #1036).
**Supersedes:** `ARCHITECTURE.operational.md` and `CODEBASE_MAP.md` (interim sources; archived at documentation closeout per `DOC_MIGRATION_LEDGER.md`).
**Evidence Sources:** `DOC_MIGRATION_LEDGER.md` §3.C extraction mapping; the `frontend/` and `backend/` code paths cited inline; the engine-provenance contract proven in #1033; the release-identity mechanism (#1027).

# SpeakSharp Architecture (v1)

Canonical statement of how SpeakSharp is structured: what the components are, who owns which decision, where data lives and how long it is kept, how identity and sessions flow, and the authority ADRs that resolve otherwise-ambiguous ownership. This is a **structural** doc, not a status or product doc: it changes by architectural decision, carries no volatile release facts, and routes product/entitlement/STT/scoring detail to its owning canonical document.

This is a **documentation** artifact. It defines structure and contracts; it does not change any application code, database configuration, quota, price, payment switch, or entitlement behavior. Draft/unshipped designs are labeled as such.

---

## 1. System context & component boundaries

SpeakSharp is a single-page web app with a thin serverless backend. The trust boundary runs between the browser (untrusted; holds only the anon key + the user's own JWT) and the server side (Supabase Postgres, Edge Functions, and CI, which hold service-role and vendor secrets).

- **Frontend** — React + Vite SPA hosted on Vercel (`https://speaksharp-public.vercel.app`). Owns all UI, the transcription runtime (in-browser STT), same-session transcript state, and client telemetry emission. Holds no privileged secret beyond the Supabase anon key.
- **Supabase Postgres** — the authoritative persistence layer for saved sessions and issue/feedback reports. Row-Level Security governs per-user access.
- **Supabase Edge Functions (Deno)** — the privileged perimeter: quota enforcement, checkout, user provisioning, and (pre-launch) the waitlist. They alone use the service-role key and vendor secrets.
- **Stripe** — billing/checkout provider, reached only from Edge Functions; both payment switches are OFF during the no-billing beta.
- **PostHog** — best-effort client-side product observability. Never a persistence source of truth.
- **Sentry** — error/failure capture and sanitized alerts; not feedback storage.
- **CI (GitHub Actions)** — the credential-backed generator for release gates and ops-health; vendor secrets stay server-side here, never in the browser.

## 2. Component responsibilities & ownership

Each capability has exactly one owning component, so behavior cannot silently diverge across callers:

- **UI / mode hierarchy / post-save surface** — frontend `session/` components; the single post-save surface is `StatusNotificationBar` ([code](../frontend/src/components/session/StatusNotificationBar.tsx)).
- **Transcription runtime & policy** — frontend `services/transcription/` (engine selection, policy, FSM).
- **Quota enforcement** — the `check-usage-limit` Edge Function + its RPC (server-side; the frontend pre-check is advisory only).
- **Billing / checkout** — the `stripe-checkout` Edge Function ([code](../backend/supabase/functions/stripe-checkout/index.ts)) behind the dual fail-closed switches.
- **Persistence** — the `sessions` and `user_issue_reports` tables under [migrations](../backend/supabase/migrations/).
- **Origin perimeter** — the shared exact-origin CORS helper ([code](../backend/supabase/functions/_shared/cors.ts)).
- **Release identity & ops health** — the build-time release injector in [vite.config.mjs](../frontend/vite.config.mjs) and CI ops-health.

## 3. Authoritative sources of truth (persistence vs observability)

| Domain | Authoritative source | Advisory (non-truth) |
| :--- | :--- | :--- |
| Billing limits / quota | Postgres migration schema + `check-usage-limit` RPC | frontend constants / pre-checks |
| Transcript state (in-session) | `useSessionStore` / same-session client memory | component local state |
| Saved session history | Supabase `sessions` row (transcript, duration, counts, filler/pause metrics, AI suggestions, engine/mode fields) | ephemeral UI-only metrics |
| Issue / feedback reports | Supabase `user_issue_reports` (insert via `issueReportService.ts`) | PostHog capture / Sentry event id |
| Session lifecycle | the transcription FSM state | browser mount/unmount events |
| Telemetry / observability | — (never a persistence truth) | PostHog capture, Sentry events |

**Persistence vs observability is a hard boundary.** Supabase is the only authoritative persistence layer; a successful PostHog/Sentry client capture MUST NOT be read as a durable-write guarantee.

## 4. Trust & data-flow boundaries

- The browser holds only the anon key and the signed-in user's JWT; every privileged write flows through an Edge Function using the service-role key, never the client.
- RLS is the per-user isolation boundary on all user tables; new tables ship RLS-enabled (deny-all where only the service role should write).
- Vendor secrets (Stripe, service-role) live only in Edge Functions / Supabase / CI and MUST NOT be exposed to frontend code.

## 5. Transcript & audio storage & retention boundaries

- **Private STT audio never leaves the browser.** Private transcription runs on-device (Transformers.js, same-origin worker/model assets); raw audio is not uploaded.
- **Final transcript text MAY be persisted** as part of the finalized session snapshot (the `sessions` row) so returning-user coaching, AI-feedback caching, PDF regeneration, WER-ready validation, and session comparison have a stable source of truth. Transcripts are **append-only and monotonic** — segments are ordered by absolute timestamp and never overwritten by late partials.
- **Retention boundary (ADR-2):** persisted session snapshots and issue reports are stored in Supabase under RLS; on-device Private audio is transient and never persisted server-side; CI UX screenshots are ephemeral (`retention-days: 1`). This does **not** approve indefinite transcript retention or set a deletion SLA — **retention duration, user deletion, and account-deletion policy remain unresolved** and require Product Owner approval (→ the enterprise/operations contracts). Any change to what is persisted is an architectural decision recorded here.

## 6. Identity & session lifecycle

- Authentication is Supabase Auth; the authenticated home is `/practice`, the anonymous root `/` renders the marketing/product page.
- **One active transcription session per browser tab**, enforced by a `localStorage` distributed mutex; a start is refused while another context holds the lock.
- Component unmount **detaches UI listeners only** — it never destroys an active transcription service; the service lives until an explicit termination event.

## 7. Structural invariants

These govern behavior and take precedence over implementation preference:

- **Session** — only one active session per tab (mutex-guarded).
- **FSM** — transcription cannot enter RECORDING before a verified engine `READY` handshake.
- **Finalized-producer** — the "finalized" signal is published exactly once, at the terminal join, session-guarded; it feeds exactly one post-save surface and discards signals from a superseded session.
- **Billing** — quota enforcement fails closed: if the usage check is unreachable, a new metered session is denied. Private STT MUST NOT silently fail over to Cloud (that changes privacy posture and variable cost); Cloud is entered only by explicit user selection.
- **Data** — final transcripts are append-only and monotonic (see §5).
- **Subscription (lifecycle)** — unmount detaches listeners but never destroys active sessions.

## 8. Engine identity & provenance contract (#1033)

One recording is produced by exactly one engine, and its provenance is recorded truthfully:

- The producing engine is latched immutably per recording; the persisted engine/mode fields describe the engine that actually produced the transcript.
- `sessions.attribution_status` is a constrained value (`legacy_unknown | pending | verified | unverified`); only `verified` counts as engine evidence, and an unconfirmable identity is `unverified` — never a fabricated engine token.
- No silent fallback: a change of engine is a new recording, not a relabel. (Proven end-to-end in #1033.)

## 9. Requested-mode vs normalized-capability separation

The mode a user *requests* and the capability the runtime *normalizes to* are distinct:

- A requested mode is validated against entitlement + device capability and normalized to an allowed engine; the normalized capability — not the raw request — drives the runtime and the persisted provenance.
- The engine selection is locked after normalization so a post-start path cannot silently swap engines.

## 10. Failure, retry & fail-closed boundaries

- **Quota** fails closed (§7 Billing).
- **CORS** rejects a present-but-disallowed browser origin with 403 before any auth/DB/provider/Stripe side effect (see §11).
- **Config** — Edge Functions load secrets lazily / guard with actionable errors; a missing service-role config returns a generic server error and writes nothing.
- **Retry/idempotency** — durable writes that may be retried are guarded by DB-level uniqueness (idempotency keys / unique indexes) so a retried create cannot duplicate a row.

## 11. Edge Function perimeter (exact-origin CORS)

The shared helper (`_shared/cors.ts`) enforces an **exact** origin allowlist — every candidate origin is parsed with the WHATWG `URL` parser and compared by exact `URL.origin` string equality; there is no substring/suffix/wildcard matching. A disallowed browser origin is rejected **403** before any side effect and receives no `Access-Control-Allow-Origin`; a request with **no** `Origin` (server-to-server, webhooks, trusted automation) is permitted but never gets a fabricated allow-origin header. The built-in allowlist covers the production host, approved product domains, and exact local-dev origins; preview origins must be added explicitly (fail closed otherwise). CORS is not authentication — each function keeps its own JWT/secret checks.

## 12. Release-identity mechanism

There is **no `version.json` endpoint** and no `__BUILD_ID__` JS define (removed in #1027 because inlining the volatile SHA rotated chunk content hashes every deploy and 404-ed long-lived tabs). The deployed commit SHA is injected at build time into `index.html` as an inline `window.__APP_RELEASE__` (release-inject plugin in [vite.config.mjs](../frontend/vite.config.mjs)); Sentry release-injection is disabled and Sentry reads the release at runtime from `window.__APP_RELEASE__`. Verify deploy/SHA equality by reading `window.__APP_RELEASE__` from the deployed `index.html` (or `window.__APP_RUNTIME_CONFIG__.release`) — an HTTP `200` from an arbitrary app URL is NOT proof (the SPA rewrite returns HTML for unmatched app paths). Any future version endpoint must be build-generated and asserted by `Content-Type` + schema + exact-SHA equality, never `200` alone.

## 13. Implementation stack & rationale

- **Frontend:** React + Vite (fast HMR, static chunking, Vercel-native). In-browser STT via Transformers.js keeps Private audio on-device.
- **Backend:** Supabase (Postgres + RLS + Auth + Deno Edge Functions) — one managed platform for persistence, per-user isolation, and a small privileged perimeter.
- **Billing:** Stripe, reached only server-side, behind two independent fail-closed switches.
- **Observability:** PostHog (product analytics) + Sentry (errors) — both best-effort, never persistence truth.
- **CI/CD:** GitHub Actions (release gates, ops-health, migration deploys via gated `workflow_dispatch`) + Vercel (frontend). Secrets remain server-side.

## 14. Authority ADRs

- **ADR-1 — Entitlement authority.** Server-side state is authoritative, but **payment status and product capabilities are distinct**:
  - Verified paid-Pro requires **real Stripe subscription evidence**.
  - `canUsePrivate` and `canUseCloud` are **server-derived capability entitlements** and MAY include explicitly approved **comped or legacy grants** — they are not equivalent to payment status.
  - A profile field such as `subscription_status = 'pro'` and any frontend-derived booleans are **advisory** and are never sufficient authority by themselves.
  - `check-usage-limit` enforces server-side **quota policy**; it is **not itself proof of payment**.
  - Exact quotas, pricing, packaging, and comped-access policy remain owned by **#1053** (`ENTITLEMENTS_AND_BILLING.md`).
  - **#1036** will centralize the client selector **without changing these authority boundaries**.
- **ADR-2 — Storage & retention boundary.**
  - Final transcript / session data MAY persist in `sessions` under RLS (see §5).
  - Raw Private audio remains on-device and is **never uploaded or persisted server-side**.
  - CI UX screenshots remain ephemeral (1-day retention).
  - This ADR does **not** approve indefinite transcript retention or establish a deletion SLA. **Retention duration, user deletion, and account-deletion requirements remain unresolved policy** for the appropriate enterprise/operations contracts and require Product Owner approval.
- **ADR-3 — Persistence vs observability.** Supabase is the sole persistence truth; PostHog/Sentry are never a durable-write guarantee (§3).
- **ADR-4 — No silent STT fallback.** Cloud is never entered implicitly; engine provenance is truthful (§8).

## 15. Current limitations & open ADRs

- **Entitlement selector not yet centralized** — the entitlement decision is currently read by multiple callers; unifying it behind one selector is **open** (#1036). Until then, ADR-1 fixes the authority boundaries (payment vs capability) but the code path is not yet single-sourced. Exact quotas/pricing/packaging/comped-access policy is owned by #1053.
- **Retention duration & deletion — unresolved policy.** ADR-2 fixes *where* data lives and that Private audio never persists, but retention duration, user deletion, and account-deletion (SLA/erasure) are **not decided here**; they belong to the enterprise/operations contracts and require Product Owner approval.
- **Durable telemetry/alert outbox + provenance registry** — DRAFT design only (#1006), **NOT shipped / NOT activated**. The persistence-vs-observability invariants above stand unchanged; do not cite the outbox as current behavior.
- **Native Browser STT verification** — a browser-dependent convenience path; non-Chrome browsers require browser-specific proof before being marketed as verified (→ `STT.md`).
