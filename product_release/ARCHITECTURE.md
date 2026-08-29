**Status:** Authoritative (SSOT for system structure, boundaries, persistence & retention, and authority ADRs)
**Owner:** Engineering (relativityE)
**Last Reviewed:** 2026-08-29
**Last Verified:** 2026-08-29 — reconciled to `complete_session_v2`, the server-owned `transcript_state`, newest-two retention, and the current content-free `PracticeSession` read model. No volatile run IDs or SHAs are carried here — release posture lives in `RELEASE_STATUS.md`.
**Applies To:** The SpeakSharp beta platform — the React/Vite SPA, the Supabase persistence + Edge Function layer, and the CI/release machinery that ships them.
**Class:** Architecture invariant / ADR.
**Authority:** The source for system context, component boundaries and ownership, trust/data-flow, persistence & retention boundaries, identity & session lifecycle, the engine identity/provenance contract, requested-mode vs normalized-capability separation, failure/fail-closed boundaries, the release-identity mechanism, and the authoritative-source ADRs (entitlement, retention).
**Not Authoritative For:** user-visible product guarantees & the feature contract (→ `PRODUCT_REQUIREMENTS.md`); tier / entitlement / quota / billing *mechanics* and pricing (→ `ENTITLEMENTS_AND_BILLING.md`); the personal progress and next-action contract (→ `PROGRESS_AND_NEXT_ACTION.md`); STT runtime/data contracts, baselines, accuracy & SLOs (→ `STT.md`); deferred / future sequencing (→ `ROADMAP.md`); current deployment posture, run IDs & SHAs (→ `RELEASE_STATUS.md`); the entitlement *implementation* refactor (tracked separately as issue #1036).
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
| Saved session history | Supabase `sessions` row: metrics, structured next action, producer identity and — while `transcript_state = available` — the retained transcript | ephemeral UI-only metrics; removed legacy content fields |
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
- **Final transcript text is persisted only for the two newest transcript-bearing saved sessions per user.** `complete_session_v2` writes the final transcript and invokes the evidence-gated `newest_two_v1` retention coordinator. Older transcript text expires; derived metrics and the structured next action remain. The server-owned `transcript_state` (`available | expired | not_captured`) is the only authority for the distinction — clients never infer expiry from an empty string.
- **Retention boundary (ADR-2):** persisted session snapshots and issue reports are stored in Supabase under RLS; on-device Private audio is transient and never persisted server-side; CI UX screenshots are ephemeral (`retention-days: 1`). Transcript-derived `ai_suggestions` age out with transcript expiry and are absent from the current `PracticeSession` read model. The newest-two policy does not replace account deletion: user/account deletion and the zero-residue contract still apply independently. Any change to what is persisted is an architectural decision recorded here.

## 6. Identity & session lifecycle

- Authentication is Supabase Auth; the authenticated home is `/practice`, the anonymous root `/` renders the marketing/product page.
- **One active transcription session per browser tab**, enforced by a `localStorage` distributed mutex; a start is refused while another context holds the lock.
- Component unmount **detaches UI listeners only** — it never destroys an active transcription service; the service lives until an explicit termination event.

## 7. Structural invariants

These govern behavior and take precedence over implementation preference:

- **Session** — only one active session per tab (mutex-guarded).
- **FSM** — transcription cannot enter RECORDING before a verified engine `READY` handshake.
- **Finalized-producer** — the "finalized" signal is published exactly once, at the terminal join, session-guarded; it feeds exactly one post-save surface and discards signals from a superseded session.
- **Commercial access** — access decisions fail closed. Active-trial and paid users receive the same Private capability; expired users retain only the documented read/export/account/upgrade permissions. Private STT never routes to another producer.
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

- **ADR-1 — Entitlement authority.** Server-side commercial state is authoritative and fail-closed:
  - Active-trial and paid users receive the same customer capability allow-list: exactly `private`.
  - Verified paid access requires an exact Stripe customer/subscription binding and the approved monthly Price; a profile flag or frontend boolean is never sufficient.
  - Trial access requires the immutable server-side grant marker and server-authoritative window defined by `ENTITLEMENTS_AND_BILLING.md`.
  - Browser, Cloud, Native, provider names, and Private implementation variants never become customer capabilities through a tier or legacy grant.
  - Usage counters may remain for sanitized telemetry or compatibility, but they are not entitlement authority and cannot deny an active-trial or paid user.
  - Expired users lose create/record/save/analyze capability while retaining the read/export/history/progress/account/billing-management/upgrade surfaces defined by the product contract.
- **ADR-2 — Storage & retention boundary.**
  - Final transcript / session data MAY persist in `sessions` under RLS (see §5).
  - Raw Private audio remains on-device and is **never uploaded or persisted server-side**.
  - CI UX screenshots remain ephemeral (1-day retention).
  - This ADR does **not** approve indefinite transcript retention: the active policy is `newest_two_v1`. Account deletion and zero-residue obligations remain separate and binding; retention convergence is not a substitute for deletion.
- **ADR-3 — Persistence vs observability.** Supabase is the sole persistence truth; PostHog/Sentry are never a durable-write guarantee (§3).
- **ADR-4 — Private-only producer.** Private is the only customer STT producer. There is no customer engine selector or silent fallback; the internal Native hook remains isolated to deterministic E2E, and producer provenance is truthful (§8).

## 14a. Enterprise readiness — structural implications (no buildout)

Requirements and triggers are owned by `PRODUCT_REQUIREMENTS.md` §10a; this records only what they would mean structurally, so the current design is not quietly foreclosed.

- **Isolation today is per-user row-level security.** That is the deliberate design and the current privacy guarantee. An organization model would layer *membership* on top of it — it must not replace or weaken per-user RLS.
- **Deletion must reach derived evidence.** Deleting a session has to remove or orphan-proof everything derived from it (transcript, delivery measurements, progress evaluation records, generated feedback). A deletion that leaves derived rows behind is not a deletion. *(Gap: no user-facing deletion path exists today → `ROADMAP.md`.)*
- **Auditability requires an append-only record.** Access and change logging cannot be reconstructed from mutable rows after the fact; it would need its own immutable record with a stated retention window.
- **Exports must reuse the stored evaluation, not recompute.** Any org-level export has to read the same persisted result the product displays, per the one-deterministic-truth rule in `PROGRESS_AND_NEXT_ACTION.md` §8a.
- **No tenant-PARTITIONED infrastructure is planned**, but logical isolation is required if the organization model ships. Separate per-customer databases/deployments and per-tenant models are **Declined**; **on-prem/self-hosted is classified Later**, not declined (`PRODUCT_REQUIREMENTS.md` §10a). **Org-scoped data must still be isolated between organizations** — membership and org settings would be enforced in the same row-level-security layer that already isolates users, never by a separate partitioning scheme. Reversing the decline is a new decision, not an incremental change.

## 15. Current limitations & open ADRs

- **Commercial integration in progress** — the canonical trial, paid, expiry, checkout, webhook, and activation seam is implemented and qualified through #1282 after its required database prerequisite. This document does not duplicate that implementation; `ENTITLEMENTS_AND_BILLING.md` owns the durable contract.
- **Retention and deletion — partially resolved.** Saved transcript text follows the active `newest_two_v1` policy; that retention decision is settled. User-facing deletion behavior, account-erasure SLA/ownership, cleanup of unfinished delivery rows, and retention of non-transcript records remain unresolved. The current schema also leaves a deletion-order dependency (`session_delivery_measurements.user_id` does not cascade) and duplicates the documented newest-two predicate inside its mutation. Those implementation gaps are tracked in `ROADMAP.md`; correcting production migrations still requires separate Product Owner authorization.
- **Durable telemetry/alert outbox + provenance registry** — DRAFT design only (#1006), **NOT shipped / NOT activated**. The persistence-vs-observability invariants above stand unchanged; do not cite the outbox as current behavior.
- **Private STT device verification** — every supported browser/device requires Private setup, record, finalize, save, and reopen proof before it is marketed as supported (→ `STT.md`).

---

## #1367 boundary reconciliation (2026-08-29)

The audio-boundary invariants above were re-verified against code and **hold**: transcription runs in a
same-origin worker and no audio upload path exists on the Private route.

To prevent that invariant being over-read, the transcript boundary is stated explicitly — it is a **different**
boundary:

| Data | Leaves the device? | Stored server-side? | Third party? |
|---|---|---|---|
| Raw audio | No | No | No |
| Transcript text | **Yes**, on save (`p_final_transcript` → `complete_session_v2`) | **Yes**, bounded to the two newest saved sessions | **Yes**, on explicit user request — `get-ai-suggestions` → Google Gemini |
| Derived metrics | Yes | Yes | Only within a coaching request |

"Private STT audio never leaves the browser" is correct. It does **not** imply the transcript stays local.
See `PRODUCT_REQUIREMENTS.md` §7.1 and the dated [`DOCUMENTATION_RECONCILIATION_LEDGER_2026-08-29.md`](./evidence/retained/DOCUMENTATION_RECONCILIATION_LEDGER_2026-08-29.md) §10.1.
