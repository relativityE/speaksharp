**Status:** Authoritative (SSOT for internal tester administration and evidence handling)
**Owner:** Product Operations / Quality
**Last Reviewed:** 2026-08-13
**Last Verified:** 2026-08-13 — reconciled to the Private-only active-trial and paid-continuation launch contract; execution remains authorization-gated.
**Applies To:** Internal release operators, invited testers, synthetic qualification accounts, and evidence handling.
**Class:** Procedure.
**Authority:** Tester preparation, scope verification, real-device execution, cleanup, and evidence recording.
**Not Authoritative For:** product policy (→ `PRODUCT_REQUIREMENTS.md`); billing mechanics (→ `ENTITLEMENTS_AND_BILLING.md`); gate definitions (→ `RELEASE_PROCESS.md`); current release posture (→ `RELEASE_STATUS.md`).
**Supersedes:** Earlier sample, Browser/Cloud tester-wave, accumulated-quota, and v4-exposure procedures in this file.
**Evidence Sources:** `QUALITY.md`, `RELEASE_PROCESS.md`, `STT.md`, and dated artifacts indexed by `EVIDENCE_INDEX.md`.

# SpeakSharp Tester Operations

This procedure administers testing of one Private Practice product. It never authorizes a deployment, migration, production data change, payment activation, trial activation, release tag, or tester dispatch.

---

## 1. Read current authority before acting

- Read the exact current source, deployed frontend, Edge, database, and release identities from `RELEASE_STATUS.md`.
- Confirm the Product Owner has authorized the specific operation and window.
- Use only the approved production URL for human testing. Never share a mocked/local test URL as production.
- Confirm production has no auth bypass, internal routes, test flags, mock credentials, or source maps.
- Record the exact account class used: active-trial, paid-continuation, expired, synthetic automation, owner, or invited tester.
- Do not infer acceptance from green CI or a historical artifact.

---

## 2. Scope verification

Every customer test account receives the same Private-only product while entitled.

### Primary active-trial path

- Use a newly provisioned account only after the accepted commercial-trial foundation and separately authorized activation are applied.
- Verify the immutable trial-grant marker and server-authoritative start/end values through approved read-only evidence.
- Prove Private setup, Open Mic, optional Focus Points, recording, stop, save, review, History, Progress, export, account management, and upgrade access.
- Prove the boundary immediately before, at, and after expiry.
- Prove client-clock manipulation cannot extend the trial.
- After expiry, prove new recording/save/analysis is denied while prior-session review, History, Progress, export, account management/deletion, and upgrade remain available.

### Secondary paid-continuation path

- Use only an account whose Stripe customer, subscription, configured $10 monthly Price, and database binding are authoritative and mutually consistent.
- Prove the same Private Practice journey as the active-trial account.
- Prove billing-management access and continued entitlement after the trial window would otherwise expire.
- Never create a real charge or synthetic paid binding without the exact written authorization and runbook window.

### Legacy-state negatives

For active-trial and paid accounts, prove that exhausted retired sample fields and usage above former daily/monthly thresholds do not deny, nudge, or auto-stop practice. Those fields may exist for migration compatibility but have no product authority.

---

## 3. First-time tester proof

The first-time proof must execute the current customer journey, not a retired workflow:

1. clear model storage for the disposable account/browser profile;
2. create or provision the account through the authorized path;
3. confirm the expected commercial state;
4. prepare Private STT and record on a real supported device;
5. stop, save, reopen the exact session, review Progress, and export;
6. verify no alternate transcription choice or sample/quota messaging appears; and
7. verify cleanup with a post-delete lookup when the account is disposable.

A green journey does not prove cleanup. If deletion or the post-delete lookup is skipped, fails, or is ambiguous, record the account as possibly orphaned and fail cleanup evidence.

Reusable qualification accounts are not disposable. Their purpose, owner, commercial state, and retention must be recorded explicitly.

---

## 4. Real-device matrix

CI does not qualify real microphone hardware. Execute #1258 on:

- desktop Chrome at the supported baseline;
- desktop Safari and Firefox for the documented support/failure posture;
- iPhone Safari at 320, 375, and 390 CSS pixels where applicable;
- built-in and external/Bluetooth microphones; and
- desktop layouts at 1024, 1280, and 1440 CSS pixels.

For each row capture device, OS, browser/version, microphone route, source/deployed SHA, account class, model/setup state, recording duration, transcript/save/reopen result, layout/overflow result, and sanitized failure evidence.

Required behavior includes:

- correct mic → transcript → Progress → coaching order;
- no horizontal overflow;
- accurate ready/recording/finalizing/saving states;
- immediate-speech, leading-silence, opening/tail, and long-recording cases;
- recoverable permission, model, network/setup, backgrounding, and microphone-disconnect failures; and
- no transcript/audio/raw model content in logs, analytics, screenshots, or issue payloads.

On failure, capture only content-safe diagnostics and file one narrowly reproducible issue. Never paste secrets or customer speech into GitHub.

---

## 5. Canary contract

Before GO, the deployed merge-SHA canary must contain both journeys:

1. **Primary:** active-trial Private Practice.
2. **Secondary:** paid-continuation Private Practice.

Both must prove entitlement readback, Private setup/start, transcript, save, exact-session reopen, Progress/analysis, and retained permissions appropriate to their state. The canary must reject alternate customer engines and must not bypass retired limits by merely changing the account class.

The canary may be red while the sprint corrects its underlying contract. It must be green on the integrated deployed merge SHA before GO or epic closure.

---

## 6. Private v4 administration

Private v4 is OFF. Operators must not target, expose, or activate it for customers.

- Verify the build kill switch and control-plane flags are OFF/empty as part of #1263 evidence.
- Deterministic v4 tests remain isolated internal diagnostics and do not count as customer entitlement proof.
- Any benchmark or future promotion requires separate Product Owner authorization and the comparison protocol in `STT.md`.
- A flag cleanup or production targeting change is a production mutation and requires explicit authorization.

---

## 7. Evidence and cleanup

- Record exact source, deployed frontend, Edge manifest, database migration, configuration, and account-state identities.
- Label evidence as local, mocked, preview, disposable PostgreSQL, production read-only, production journey, or real device.
- Store dated evidence under the governed evidence path and index it through `EVIDENCE_INDEX.md`.
- Record synthetic-account creation and verified cleanup. Persistent count delta must be zero unless an explicitly retained qualification account is named.
- Treat missing, stale, wrong-SHA, contaminated, or content-bearing artifacts as invalid evidence.
- Current pass/fail status belongs only in `RELEASE_STATUS.md`.

---

## 8. Stop conditions

Stop immediately on an unapproved mutation, unexpected account binding, content leak, wrong deployed SHA, ambiguous commercial state, alternate customer engine, entitlement bypass, or failure to clean up a disposable account.

Report the exact contradiction, what remained read-only, the safe remaining work, and the required Product Owner decision. Do not improvise authority or soften a failed gate.
