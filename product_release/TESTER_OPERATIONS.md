**Status:** Authoritative (SSOT for internal tester administration and evidence handling)
**Owner:** Product Operations / Quality
**Last Reviewed:** 2026-09-15
**Last Verified:** 2026-09-16 — the two-candidate procedure (v4 provisional primary against v2 fallback, Moonshine deferred until after RWT or MVP), managed-account read-only verification path, and filler completeness were reconciled.
**Applies To:** Internal release operators, invited testers, synthetic qualification accounts, and evidence handling.
**Class:** Procedure.
**Authority:** Tester preparation, scope verification, real-device execution, cleanup, and evidence recording.
**Not Authoritative For:** product policy (→ `PRODUCT_REQUIREMENTS.md`); billing mechanics (→ `ENTITLEMENTS_AND_BILLING.md`); gate definitions (→ `RELEASE_PROCESS.md`); current release posture (→ `RELEASE_STATUS.md`).
**Supersedes:** Earlier sample, Browser/Cloud tester-wave, accumulated-quota, and v4-exposure procedures in this file.
**Evidence Sources:** `QUALITY.md`, `RELEASE_PROCESS.md`, `STT.md`, and dated artifacts indexed by `EVIDENCE_INDEX.md`.

> [!IMPORTANT]
> **Whether human qualification is currently open, paused, or resuming is not recorded here.**
> `RELEASE_STATUS.md` is the sole source for that, and a copy of it in this document is a copy that
> goes stale silently — a tester who reads a resumed posture here after it was lifted there has no
> way to tell which one is current. This document holds the procedure that is true in every posture:
>
> - **A transport 200 or an attached hook is not telemetry proof.** Evidence is event-level readback
>   with a positive AND a negative control; an accepted request only shows something was sent.
> - **Record requested identity and observed identity separately**, and bracket the user's intent
>   through review and reopen. Where they diverge is the finding.
> - **Exercise every registered runtime candidate through controlled configuration**, across Open Mic
>   and Focus Points, rather than whichever one happens to be resolved.
> - **Never ask the Product Owner to choose Preview, local, or internal testing.** The customer
>   surface is the only one their judgment is being asked about.

<!-- pm-currentization:2026-09-15 -->
> [!IMPORTANT]
> **Procedure currentized 15 Sep 2026.** Human qualification uses the canonical Production app only and remains governed by `RELEASE_STATUS.md`. A qualifying matrix must run **v4 (provisional primary) and v2 (fallback)** with requested/observed identity equality, one word-count authority, filler completeness, WER, long-form repetition/tail/stability checks, and received-event receipts. Moonshine is deferred until after RWT or MVP and is not a required row in the current matrix. Use the #1468 read-only verifier before declaring managed identities usable; account repair is a separate authorized write. Never run a Production take merely because CI or a local probe passed.
<!-- /pm-currentization:2026-09-15 -->

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

### 6.1 Authorized two-candidate Production comparison

This procedure is available only during a Product Owner-authorized comparison window. It exercises the
canonical Production deployment; a pull-request Preview, local build, URL flag, browser-storage value, or
visible customer control is not qualifying evidence.

Preparation is separate from execution:

1. The **authorization boundary is GitHub**; the **execution boundary is the Product Owner's device** (Product
   Owner decision 5651663038; PM decisions 5651830241 and 5651842972). No private key, signed envelope, public-key
   pin or second workflow exists. Each spoken take is authorized by one successful attempt of the existing
   `.github/workflows/rc-gates.yml` with `gate=comparison-authorization`, dispatched **by the repository owner
   against the exact reviewed candidate head**. Its single job refuses unless the requested release is exactly the
   commit the run executes and the release Production serves, and the owner dispatched and triggered the run. It
   then generates the one-use `comparison_nonce` and uploads a content-free, attempt-named artifact naming the
   repository, workflow path/ref/revision, run, attempt, actor, release, origin, cell and evidence document. The
   authorization has **no wall-clock expiry**: one attempt authorizes one cell, and a rerun is a new attempt with a
   new nonce. Main ancestry and accepted-tree equality are verified after the authorized merge, as closure gates.
2. Launch a dedicated browser profile and process with no other debugging tools (no DevTools, observer, extension debugger
   or second automation client), with its remote-debugging endpoint bound to loopback port 9222. Open
   exactly one `https://speaksharp-public.vercel.app` tab and sign in manually through the normal product path.
   Never expose the debugging endpoint off-device.

For each of the three registered candidates, perform one Open Mic take and one Focus Points take. The
Focus Points count is user-selected within the MVP's 1–7 range; the comparison does not prescribe four or
any other count. Every point the user enters and substantively speaks must remain present, in order, and be
evaluated. Generate one lowercase UUIDv4 as the evidence-document id and reuse that id for exactly these
six rows; a later comparison packet requires a new id. Immediately before each take:

1. Dispatch the authorization for that exact cell against the reviewed candidate head:
   `gh workflow run rc-gates.yml --ref <candidate-branch> -f gate=comparison-authorization -f comparison_cell=<candidate-id>/<open_mic|focus_points> -f comparison_release_sha=<40-char-sha> -f comparison_evidence_document_id=<uuidv4>`,
   wait for it to succeed, and note its run id and attempt.
2. Prepare the take, with the GitHub CLI authenticated to read the repository and its Actions artifacts:
   `node scripts/human-test/prepare-take.mjs --candidate <candidate-id> --journey <open_mic|focus_points> --release <40-char-sha> --authorization-run <run-id> --authorization-run-attempt <attempt> --out /absolute/evidence/control.json`.
   It live-reads that exact attempt from GitHub first: `rc-gates.yml`, manual dispatch, completed successfully,
   executed revision equal to the release and to the artifact's workflow ref, actor and triggering actor equal to
   the repository owner, and jobs showing one successful `Model Comparison Authorization` job with every other gate
   skipped. The artifact must name this candidate, journey, release and origin; on any mismatch it HOLDs without
   attaching. It then installs only the one-use authorization, boots one fresh document, removes the installer,
   switches the candidate, requires requested = observed = expected on the authorized release, and **disconnects**.
   It never pauses workers, enables network observation, or injects a tripwire (RWT-01, PO/PM 5663876247).
3. Start only after it prints `DISCONNECTED` — no debugger attachment was observed before arming or after control disconnect. The endpoint cannot prove exclusive
   custody, so keep that browser free of other debugging tools for the whole take. Use the product
   normally: start, speak, stop, wait for persistence and review, inspect Focus Points when applicable, and use
   Practice again/Retry where the run requires it. Do not refresh or reuse an authorization; it is removed after the
   first document, and its nonce is evidence for exactly one take.

**Privacy evidence is separate.** Run the privacy diagnostic in a separate browser profile and process, never against the take's
debugging endpoint. Audio-egress verification runs in its own session with
`corepack pnpm human-test:observe -- --privacy-diagnostic …`. That observer pauses workers and replaces network APIs
to inspect payloads, so its receipt is stamped `evidenceKind: privacy_diagnostic` and can never qualify a
comparison row or supply journey, performance or model-quality evidence.

The first successful authorized switch for the evidence document automatically emits the governed
`telemetry_positive_control`; the other five switches do not. Set the packet's `positiveControlNonce`
to the evidence-document UUID reported by the control receipt. For each candidate row, copy
`comparisonNonce` from that row's control receipt, then copy `journeyId`, `attemptId`, and `attemptSeq`
from the trusted readback's `session_started` event carrying that `comparisonNonce`. Those three values are
the app's native telemetry identity, not values derived from the nonce; the validator refuses any row whose
copies differ from the authenticated readback, so operator-authored correlation cannot substitute for
emitted telemetry.

A candidate row counts only when requested, expected, and observed identities agree for the whole take;
the saved session has a named persistence ID; the receipt is a non-dry-run `PASS` pre-take control that
disconnected before the take; and the #1421 decoded
PostHog readback links the same release, evidence document, candidate, journey, attempt, sequence, and
run-issued comparison nonce. A SHA-256 binding over pinned canonical bytes (version, nonce, persisted UUIDv4)
proves the exact saved session without putting the raw database session ID in PostHog. Gemini evidence
binds that persisted ID independently. A missing binding HOLDs the row; it never degrades or scores a model.

Run `corepack pnpm human-test:validate-downselection -- /absolute/evidence/model-downselection.json --telemetry-authority /absolute/trusted/posthog-readback.json --gemini-authority /absolute/trusted/gemini-session-readback.json` only
after all six candidate/journey cells and the locked Gemini evidence are present. It reads every receipt's
authorization attempt and its jobs back from GitHub and refuses a missing run record, an attempt that is not the
owner-dispatched and owner-triggered, successful `comparison-authorization` job at the exact release, a run reused
by another row (including through a rerun attempt), or any candidate, journey, release, origin, document, nonce, or
session-binding mismatch. The validator must remain
`HOLD` until a separate Product Owner-authored approval artifact names distinct primary, fallback, and
sits-out roles and cites the exact completed packet digest. The validation command requires authenticated
GitHub CLI read access (or `GH_BIN` pointing to it), plus the separately downloaded artifacts from the
trusted default-branch readback job. It compares the retained approval to the live comment and both inline
evidence sections to those independent authorities;
a local or edited JSON file cannot substitute because the command verifies GitHub artifact attestations for
both authority files before reading them. Generate those files by dispatching
`model-downselection-authority.yml` from the default branch against the commit containing the completed
packet, then download the attested artifact without editing it;
a local JSON file claiming `OWNER` authority cannot pass by itself. A passing packet is decision evidence; it is not
merge, deployment, migration, or runtime-promotion authorization.

**#1437 journey diagnostic (nonqualifying, committed audio).** Dispatch `rc-gates.yml` against the exact
candidate head with `gate=gate-3-dast`, `diagnostic_dast_spec=tests/live/practice-loop-journey.live.spec.ts`,
`diagnostic_dast_grep` naming exactly one candidate (for example `candidate v2:base.en`),
`comparison_cell=<that candidate>/open_mic`, `comparison_release_sha` and `comparison_evidence_document_id`. The
Gate 3 job mints the nonce in its own run attempt before the spec starts, and the spec live-reads that
in-progress attempt before navigating. Missing, stale or inconsistent run or release metadata HOLDs with a named
reason before any product step. The job keeps its deliberate terminal rejection: the diagnostic creates and
qualifies no four-cell evidence, and it never replaces a Product Owner spoken cell.

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
