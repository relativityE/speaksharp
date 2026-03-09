# Tech Debt Inventory

## 1. Inventory

| ID | Location | Description | Impact Area | Notes |
|----|----------|-------------|-------------|-------|
| TD-001 | ROADMAP.md:84 | Harden Supabase Security (OTP expiry, leaked password, Postgres upgrade) | Security / Infra | Requires Supabase Pro for some items |
| TD-002 | ROADMAP.md:92 | Domain Services DI Refactor | Architecture | Low priority, current spies work |
| TD-003 | ROADMAP.md:456 | Simplify Setup Test Users Workflow UI | Dev Experience | GH Actions UI limitations |
| TD-004 | ROADMAP.md:546 | Unified Documentation Metric Sync | Dev Experience | ✅ RESOLVED in PR #DebtRemediation |
| TD-005 | ROADMAP.md:547 | Remove Mock Timeout Bypass in `TranscriptionService.ts` | Testing / Reliability | ✅ RESOLVED in PR #DebtRemediation |
| TD-006 | ROADMAP.md:604 | Split Usage Tracking (cloud_usage vs native_usage) | Billing / DB | Part of Tier Enforcement Refactor |
| TD-007 | ROADMAP.md:606 | Update RPC Logic for engine-specific counters | Billing / DB | Part of Tier Enforcement Refactor |
| TD-008 | ROADMAP.md:608 | Revise Edge Function Limits (daily vs monthly) | Billing / DB | Part of Tier Enforcement Refactor |
| TD-009 | ROADMAP.md:610 | Frontend UI Sync for decoupled usage bars | UI / UX | Part of Tier Enforcement Refactor |
| TD-010 | ROADMAP.md:613 | Default to Private STT for Pro users | UX / Cost | ✅ RESOLVED in PR #DebtRemediation |
| TD-011 | ROADMAP.md:615 | "Zero-Network Vault Mode" UI | UX / Privacy | ✅ RESOLVED in PR #DebtRemediation |
| TD-012 | ROADMAP.md:617 | Delightful Loading States for WebGPU | UX | ✅ RESOLVED in PR #DebtRemediation |
| TD-013 | ROADMAP.md:619 | Secure Model Hosting (Signed URLs) | Security / Cost | Gating model access by subscription |
| TD-014 | ROADMAP.md:419 | Profile Loading Root Cause Investigation | Reliability | Intermittent Supabase fetch failures |
| TD-015 | ARCHITECTURE.md:3057 | Input length enforcement for `transcript` field | Reliability / Security | ✅ RESOLVED in PR #DebtRemediation |
| TD-016 | ARCHITECTURE.md:3058 | Cold start optimization for Edge Functions | Performance | Optimize imports/warmup logic |
| TD-017 | tests/live/analytics-journey.live.spec.ts:37 | Implement dynamic promo generation for Free path | Testing / Marketing | E2E automation for promo flow |
| TD-018 | ROADMAP.md:134 | Set `ALLOWED_ORIGIN` in Supabase for production | Security | ✅ RESOLVED in PR #DebtRemediation |
| TD-019 | PRD.md:209 | Testimonials placeholders ("TBD") | Marketing / UI | Needs real content |
| TD-020 | ROADMAP.md:550 | Migration Idempotency (IF NOT EXISTS) | Infrastructure | ✅ RESOLVED in PR #DebtRemediation |
| TD-021 | ROADMAP.md:552 | React Router v7 Deprecation future flags | Architecture | ✅ RESOLVED in PR #DebtRemediation |
| TD-022 | PRD.md:214 | STT Integration Test Timeouts | Testing | WASM overhead causes flakiness in CI |
| TD-023 | ROADMAP.md:483 | 1-Click Practice Session Summaries (Watermarked) | Marketing / Funnel | viral acquisition feature |
| TD-024 | ROADMAP.md:485 | AI Speech Coach (Pro Tier) | Product / AI | Post-session feedback agent |

## 2. Prioritization

Priority = (Impact × Confidence) / (Risk + Complexity)

| ID | Impact (1-5) | Confidence (1-5) | Risk (1-5) | Complexity (1-5) | Score | Tier |
|----|---|---|---|---|---|---|
| TD-015 | 5 | 5 | 1 | 1 | 12.5 | Tier 1 |
| TD-018 | 5 | 5 | 1 | 1 | 12.5 | Tier 1 |
| TD-020 | 3 | 5 | 1 | 1 | 7.5 | Tier 1 |
| TD-021 | 2 | 5 | 1 | 1 | 5.0 | Tier 1 |
| TD-005 | 4 | 5 | 2 | 2 | 5.0 | Tier 1 |
| TD-004 | 3 | 5 | 1 | 2 | 5.0 | Tier 1 |
| TD-014 | 5 | 3 | 2 | 4 | 2.5 | Tier 2 |
| TD-010 | 4 | 5 | 2 | 2 | 5.0 | Tier 1 |
| TD-011 | 3 | 5 | 1 | 2 | 5.0 | Tier 1 |
| TD-002 | 2 | 5 | 1 | 2 | 3.3 | Tier 2 |
| TD-001 | 5 | 4 | 2 | 4 | 3.3 | Tier 2 |
| TD-016 | 4 | 4 | 2 | 3 | 3.2 | Tier 2 |
| TD-006 | 5 | 5 | 3 | 4 | 3.6 | Tier 2 |
| TD-007 | 5 | 5 | 3 | 4 | 3.6 | Tier 2 |
| TD-008 | 5 | 5 | 3 | 4 | 3.6 | Tier 2 |
| TD-009 | 4 | 5 | 2 | 3 | 4.0 | Tier 1 |
| TD-012 | 3 | 5 | 1 | 2 | 5.0 | Tier 1 |
| TD-013 | 4 | 4 | 3 | 4 | 2.3 | Tier 3 |
| TD-024 | 4 | 4 | 3 | 5 | 2.0 | Tier 3 |
| TD-023 | 3 | 4 | 2 | 4 | 2.0 | Tier 3 |
| TD-022 | 3 | 3 | 3 | 4 | 1.3 | Tier 3 |
| TD-017 | 2 | 4 | 2 | 4 | 1.3 | Tier 3 |
| TD-003 | 2 | 3 | 2 | 4 | 1.0 | Tier 3 |
| TD-019 | 1 | 5 | 1 | 1 | 2.5 | Tier 2 |

## 3. Analysis & Design

### Tier 1 Implementation Plan

#### TD-015: Input length enforcement for `transcript` field
- **Design**:
    - **Postgres**: Add `ALTER TABLE public.sessions ADD CONSTRAINT transcript_length_check CHECK (char_length(transcript) < 100000);`.
    - **Frontend**: In `TranscriptionService.stopTranscription`, truncate `transcript` to 99,900 chars and append `... [TRUNCATED]` if it exceeds the limit before sending to RPC.
- **Rationale**: Prevents malicious or accidental database bloat while maintaining enough headroom for legitimate long sessions.

#### TD-018: Strict CORS Enforcement
- **Design**: Update `backend/supabase/functions/_shared/cors.ts` to strictly check `origin === ALLOWED_ORIGIN` when `ALLOWED_ORIGIN` is set and not `*`. Keep localhost support for development.
- **Rationale**: Enhances security by preventing unauthorized origins from calling edge functions.

#### TD-020: Migration Idempotency
- **Design**: Audit `backend/supabase/migrations/` and apply `IF NOT EXISTS` / `CREATE OR REPLACE` patterns. Focus on the most recent and critical ones.
- **Rationale**: Ensures that environment resets or multi-agent deployments don't fail due to pre-existing schema objects.

#### TD-021: React Router v7 Future Flags
- **Design**: Add missing flags to `BrowserRouter` in `main.tsx`: `v7_fetcherPersist`, `v7_normalizeFormMethod`, `v7_partialHydration`, `v7_skipActionErrorRevalidation`.
- **Rationale**: Silences console warnings and ensures a smooth transition to the next major version of React Router.

#### TD-005: Refactor Timeout Bypass
- **Design**: Remove `IS_TEST_ENVIRONMENT` check from `TranscriptionService.ts`. Rely entirely on `STT_CONFIG.LOAD_CACHE_TIMEOUT_MS` and the `window.__STT_LOAD_TIMEOUT__` override. Tests that need to disable timeout will set `window.__STT_LOAD_TIMEOUT__ = 0` (interpreted as "no timeout") or a very large number.
- **Rationale**: Decouples domain logic from test environment flags, improving architectural purity.

#### TD-010: Default to Private STT for Pro users
- **Design**: Update `useSessionStore` initial state or `SessionPage` initialization to check `subscription_status` and default `sttMode` to `private` if Pro.
- **Rationale**: Reduces operational costs (AssemblyAI credits) and reinforces the "Privacy-First" value proposition.

#### TD-011: "Vault Mode" UI
- **Design**: Add a "Vault" or "Lock" icon next to the "Recording" status in `LiveRecordingCard` when in `private` mode.
- **Rationale**: Provides visual confirmation of on-device privacy, increasing user trust.

#### TD-012: Enhanced WASM Loading UI
- **Design**: Integrate a progress bar into the `StatusNotificationBar` that consumes `modelLoadingProgress` from the store.
- **Rationale**: Better UX for heavy model downloads, reducing perceived latency.

#### TD-004: Unified Documentation Metric Sync
- **Design**: Modify `scripts/update-prd-metrics.mjs` to look for `SQM:START` and `SQM:END` markers in `README.md` and `docs/ARCHITECTURE.md` and sync the metrics block.
- **Rationale**: Ensures all high-level documentation reflects the same ground-truth health metrics.
