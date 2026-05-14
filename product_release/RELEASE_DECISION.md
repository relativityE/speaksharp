# Controlled Tester Release Decision

**Last updated:** 2026-05-14
**Release type:** Controlled human tester release
**Current decision:** GO
**Evidence baseline commit:** `e73408c0`
**Latest full RC gates:** `Release Candidate Gates` run `25769178359` passed on `e73408c0`

## 1. Decision

| Decision | Status | Evidence |
|---|---:|---|
| GO / GO WITH LIMITATIONS / NO-GO | GO | P0/P1 product gates are green; all five RC gates passed in run `25769178359` on `e73408c0`; Observability API Smoke passed in run `25764783852`. |

## 2. P0 Blockers Only

| P0 Blocker | Status | Evidence |
|---|---:|---|
| Expired promo/free downgrade trust | ✅ Clear | `Expired Promo Live Smoke` run `25704192079` |
| Latest CI release integrity | ✅ Clear | `CI - Test Audit` run `25710289706` on `56843a18` |
| Deploy/canary | ✅ Clear | Deploy `25710289702`, canary `25710289703` |
| Cloud artifact path if included | ✅ Clear | `Pro STT Artifact Matrix` run `25710568638` on `56843a18` |
| Native if included | ✅ Clear with limitation | Chrome real-mic proof recorded; disclose Chrome/browser dependency |
| Observability triage route | ✅ Clear | `Observability API Smoke` run `25764783852` passed; manual tester-feedback fallback also exists |

## 3. P1 Risks And Tester-Facing Mitigations

| P1 Risk | Mitigation |
|---|---|
| Native STT varies by browser | Tester instructions must say Native is Chrome/browser-dependent. |
| Backend tier remains internally `free` while UI says Basic | Tester-facing UI says Basic; backend migration is intentionally deferred. |
| Cloud provider limits/rate/concurrency | Cloud is caveated for this controlled tester round. Private is the primary validated Pro STT path; Cloud may be tried as a limited provider-backed path and any missing transcript/provider issue should be reported. |
| Observability dashboards can still have provider-side delay | Use `Observability API Smoke` as automated readback evidence and `.github/ISSUE_TEMPLATE/tester-feedback.yml` as human fallback during the trial. |

## 4. Known Limitations To Disclose

- Native browser STT varies by browser and is validated for Chrome.
- Cloud is caveated for controlled testers: Cloud selection, runtime authority, metadata, and no-speech guard are validated, but the latest Chrome CDP live pass did not prove real-human-speech Cloud transcript cradle-to-grave. Treat Cloud as an optional limited validation path, not the primary Pro path.
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
| Feedback channel ready | ✅ Observability API Smoke `25764783852` plus manual fallback |
| Gate 4 SCA critical audit recorded | ✅ Full RC run `25769178359` |
| Gate 5 UX smoke recorded | ✅ Full RC run `25769178359` |
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
| Is Cloud included or excluded from tester instructions? | Caveated / optional. Private is the primary validated Pro STT path for this controlled tester round. Cloud selection, runtime authority, metadata, and empty/no-speech guard passed, but real-human-speech Cloud transcript cradle-to-grave remains unproven from the agent-run Chrome CDP pass. | B-001 Chrome CDP evidence: `/private/tmp/speaksharp-b001-cloud-1778787039911/report.json`; Cloud artifact run `25710568638` remains supplemental automation evidence. |
| Is Private first-use understandable? | Automated UX smoke says the first-use/core journey is usable; subjective copy polish remains P2. | Private cache proof plus `pnpm rc:gate:5:ux` passing 14/14. |
| Is there a manual feedback fallback if observability readback is incomplete? | Yes. | `.github/ISSUE_TEMPLATE/tester-feedback.yml`. |

## GO Conditions

GO is recorded for controlled human tester release because:

1. All five RC gates passed in GitHub run `25769178359` on `e73408c0`.
2. Observability API Smoke passed in GitHub run `25764783852`.
3. Manual tester-feedback fallback remains available during the trial.

## RC Gate Evidence Added 2026-05-12

| Gate | Command | Result |
|---|---|---:|
| Full RC | `Release Candidate Gates` workflow run `25769178359` on `e73408c0` | ✅ Gate 1 Product Truth, Gate 2 SAST/OWASP, Gate 3 DAST, Gate 4 SCA, and Gate 5 UX all passed |
| Observability API Smoke | `Observability API Smoke` workflow run `25764783852` | ✅ Passed |
| Gate 2 SAST | `pnpm rc:gate:2:sast` and RC workflow Gate 2 | ✅ Passed, including production hardening check for E2E/test branches |
| Gate 4 SCA | `pnpm rc:gate:4:sca` and RC workflow Gate 4 | ✅ Passed for critical advisories after patching `jspdf`, `jspdf-autotable`, `basic-ftp`, and `protobufjs`; remaining advisories are low/high, no critical |
| PDF compatibility | `pnpm exec vitest run --config frontend/vitest.config.mjs --coverage.enabled=false frontend/src/lib/__tests__/pdfGenerator.test.ts frontend/src/constants/__tests__/subscriptionTiers.test.ts` | ✅ Passed, 28/28 |
| Build compatibility | `pnpm build:test` | ✅ Passed |
| Gate 5 UX | `pnpm rc:gate:5:ux` and RC workflow Gate 5 | ✅ Passed |
