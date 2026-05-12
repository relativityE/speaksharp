# Controlled Tester Release Decision

**Last updated:** 2026-05-12
**Release type:** Controlled human tester release
**Current decision:** GO WITH LIMITATIONS
**Target decision:** GO after observability API readback secrets are configured and `Observability API Smoke` passes, or the owner formally accepts manual fallback as sufficient for this tester cohort.

## 1. Decision

| Decision | Status | Evidence |
|---|---:|---|
| GO / GO WITH LIMITATIONS / NO-GO | GO WITH LIMITATIONS | P0/P1 product gates are green; Gate 2 SAST, Gate 4 SCA critical, and Gate 5 UX smoke are now recorded green. Observability currently relies on manual fallback until API readback secrets are installed. |

## 2. P0 Blockers Only

| P0 Blocker | Status | Evidence |
|---|---:|---|
| Expired promo/free downgrade trust | ✅ Clear | `Expired Promo Live Smoke` run `25704192079` |
| Latest CI release integrity | ✅ Clear | `CI - Test Audit` run `25710289706` on `56843a18` |
| Deploy/canary | ✅ Clear | Deploy `25710289702`, canary `25710289703` |
| Cloud artifact path if included | ✅ Clear | `Pro STT Artifact Matrix` run `25710568638` on `56843a18` |
| Native if included | ✅ Clear with limitation | Chrome real-mic proof recorded; disclose Chrome/browser dependency |
| Observability triage route | ✅ Clear with limitation | Manual tester-feedback fallback exists; API readback pending secrets |

## 3. P1 Risks And Tester-Facing Mitigations

| P1 Risk | Mitigation |
|---|---|
| Native STT varies by browser | Tester instructions must say Native is Chrome/browser-dependent. |
| Observability API readback incomplete | Use `.github/ISSUE_TEMPLATE/tester-feedback.yml` until Sentry/PostHog readback passes. |
| Backend tier remains internally `free` while UI says Basic | Tester-facing UI says Basic; backend migration is intentionally deferred. |
| Cloud provider limits/rate/concurrency | Tell testers Cloud is included but provider-backed; retry/report if provider errors appear. |
| Observability API readback incomplete | Add Sentry/PostHog readback secrets and run `Observability API Smoke`; manual fallback remains available until then. |

## 4. Known Limitations To Disclose

- Native browser STT varies by browser and is validated for Chrome.
- Cloud is provider-backed and may be rate/concurrency limited.
- Observability API readback is pending Sentry/PostHog secrets unless completed before URL send.
- Backend still uses internal `free` tier while UI labels the baseline tier as Basic.
- Large group concurrency is outside this controlled trial.
- Production paid billing beyond test-mode Stripe flow is outside this controlled trial.

## 5. Must Not Be Touched Before Release

- Do not refactor STT lifecycle/FSM.
- Do not reopen Cloud internals unless a fresh Cloud-focused run fails.
- Do not perform backend `free` -> `basic` migration.
- Do not upgrade dependency majors for non-critical advisories.
- Do not change entitlement/quota logic without rerunning expired promo, Cloud token gates, CI, deploy/canary, and Cloud artifact proof.

## 6. Final Checklist Before Sending URL

| Checklist Item | Status |
|---|---:|
| P0 gates green | ✅ |
| Cloud/Private scope defined | ✅ |
| Native browser-dependent disclaimer ready | ✅ Captured in release limitations and RC Gate 5 UX smoke |
| Feedback channel ready | ✅ Manual fallback, 🟡 API readback pending secrets |
| Gate 4 SCA critical audit recorded | ✅ `pnpm rc:gate:4:sca` passed after critical dependency patches |
| Gate 5 UX smoke recorded | ✅ `pnpm rc:gate:5:ux` passed, 14/14 tests |
| Final release matrix updated with RC gate columns | ✅ |

## Direct Security Answers

| Question | Direct Answer | Regression Evidence |
|---|---|---|
| Could expired promo or stale profile grant Pro access? | Current evidence says no. | Live expired promo smoke plus unit tests force effective tier to `free`, hide Pro UI, and force Native/free-safe mode. |
| Could quota fail open? | Current SAST evidence says quota/token checks fail closed; live token gate covers over-quota Cloud denial. | `assemblyai-token` unit tests, `check-usage-limit` unit tests, `cloud-token-gates.live.spec.ts`. |
| Could Cloud token be minted by Free/expired user? | Current evidence says no. | Free user denied in `assemblyai-token/index.test.ts`; expired promo denied in unit and live tests. |
| Could test/E2E mode leak to production? | Current Gate 2 evidence says no known leak. | Env detection tests, production build/CI validation, and `pnpm rc:gate:2:sast`. |
| Are Stripe/Gemini/AssemblyAI secrets server-only? | Current architecture expects server-only provider secrets; Sentry/PostHog public keys are frontend-safe observability keys. | Edge Function tests and env validation; final SAST should inspect no provider secret is exposed as `VITE_*`. |
| Is Native clearly browser-dependent? | Yes, for release materials: Native is Chrome/browser-dependent. | Native manual proof, release decision limitation, and Gate 5 UX smoke. |
| Is Cloud included or excluded from tester instructions? | Included. | Latest Cloud artifact run `25710568638` passed. |
| Is Private first-use understandable? | Automated UX smoke says the first-use/core journey is usable; subjective copy polish remains P2. | Private cache proof plus `pnpm rc:gate:5:ux` passing 14/14. |
| Is there a manual feedback fallback if observability readback is incomplete? | Yes. | `.github/ISSUE_TEMPLATE/tester-feedback.yml`. |

## GO Conditions

To move from GO WITH LIMITATIONS to GO:

1. Observability API readback passes, or the owner formally accepts manual fallback as enough for this tester cohort.

## RC Gate Evidence Added 2026-05-12

| Gate | Command | Result |
|---|---|---:|
| Gate 2 SAST | `pnpm rc:gate:2:sast` | ✅ Passed |
| Gate 4 SCA | `pnpm rc:gate:4:sca` | ✅ Passed for critical advisories after patching `jspdf`, `jspdf-autotable`, `basic-ftp`, and `protobufjs`; remaining advisories are low/high, no critical |
| PDF compatibility | `pnpm exec vitest run --config frontend/vitest.config.mjs --coverage.enabled=false frontend/src/lib/__tests__/pdfGenerator.test.ts frontend/src/constants/__tests__/subscriptionTiers.test.ts` | ✅ Passed, 28/28 |
| Build compatibility | `pnpm build:test` | ✅ Passed |
| Gate 5 UX | `pnpm rc:gate:5:ux` | ✅ Passed, 14/14 |
