# #1045 — Progress loop blocked by a systemic attribution finding

**Date:** 2026-08-01 · **Status:** #1045 open, ledger 14/19 · **Branch:** `test/1045-deployed-journey`
**Deployed SHA under test:** `83cace5c` (main head; Progress code + both migrations live)

---

## 1. Executive summary

**Corrected claim (an earlier version of this doc overstated it):**
> Cloud is the only engine *observed* with `verified` attribution (2 rows in the 500-row audit). **No
> engine has yet proven the complete deployed #1045 Progress journey** (eligible evaluation →
> recommendation → accepted attempt → second comparable session → server-derived outcome). The Private
> journey reached recording → save → evaluation creation, then stopped (ineligible). The historical Cloud
> test verifies attribution + persistence only — **not** the Progress loop.

The evaluation is ineligible for one reason: **Progress requires `attribution_status = 'verified'`, and
the deployed Private session resolved `unverified`.**

**Root cause (found by PO code review, confirmed below): an adapter-boundary omission, not an attribution
mystery.** `PrivateSTT.getMetadata()` already returns a complete tuple (incl. `deviceType`), but the
production factory wraps it in `PrivateWhisper`, which does **not** expose/delegate `getMetadata()`;
`IPrivateSTT` doesn't declare it; so `TranscriptionService.getMetadata()` (which asks the outer wrapper)
falls back to `null` → the verified tuple check fails → `unverified`. Cloud's `CloudAssemblyAI` wrapper
*does* expose `getMetadata()`, which is why only Cloud verifies. Native similarly lacks an exposed method.

**Fix path (per PO): correct it directly in ONE bounded PR within #1045 — do NOT run a paid Cloud journey,
do NOT open a separate issue, do NOT pursue Cloud to close the ledger.** Preserve the verified-attribution
eligibility guard.

---

## 2. How I got here (chronology)

1. **Prior failures were a harness defect (retracted my earlier "entitlement" finding).** The original
   journey spec used `verifyCredentialsAndInjectSession → setupE2EManifest`, which installs a **mocked
   `window.supabase`** and an injected `__E2E_DEPS__.fetchUsageLimit`. So `check-usage-limit` was mocked
   and never consumed the real entitlement → Private read disabled. (It also leaked the account's live
   session into the Playwright trace — remediated: artifacts deleted, sessions revoked, retention 1d.)

2. **Rewrote the harness mock-free** (`deployedLiveTest` fixture, real `/auth/signin`, service-role
   sample seed on the maintained Free account, real-network entitlement proof). First corrected run
   (`30692983282`) proved the real backend resolves entitlement:
   `entitlement={... "private_sample_available":true, "private_sample_seconds_remaining":300 ...}`.
   It then failed on a harness dropdown race (double open/escape toggled the menu shut).

3. **Fixed the dropdown handling.** Next run (`30693173740`) recorded and saved a real Private session
   (`session1=ea5e48cb…`) — then failed at gate 2: the Progress panel never rendered.

4. **Diagnosed the panel gap** (`loadSessionProgress` returns null unless an *eligible* eval exists) with
   a read-only DB dump (`30693349940`):
   - `session = { status:"completed", attribution_status:"unverified", engine:"private",
     engine_version:"transformers-js", model_name:"whisper-base.en", duration:46, word_count:135 }`
     — a real 135-word Private session.
   - `evaluation = { clarity_evidence_available:true, eligible:false,
     exclusion_reasons:["unverified_attribution"], clarity_raw:null, cohort_key:null }`
     — the consumer **did** create the eval; it's excluded solely for unverified attribution.
   - `recommendation = null` (none is created for an ineligible session).

5. **Checked whether `verified` is achievable at all** with a distribution query (`30693660695`,
   500 recent sessions):
   ```
   cloud|verified: 2          ← the ONLY verified rows
   private|unverified: 2 · private|pending: 1 · private|legacy_unknown: 50   ← 0 verified
   native|unverified: 2 · native|pending: 98 · native|legacy_unknown: 292    ← 0 verified
   cloud|pending: 2 · cloud|legacy_unknown: 51
   verified_samples: [{engine:cloud, device_type:"cloud", model:"universal-streaming-english",
                       engine_version:"assemblyai"}, …]
   ```

---

## 3. The findings (evidence-backed)

**F1 — Progress eligibility requires `verified` attribution (intentional).** Enforced in three places:
- SQL: `record_progress_evaluation` (`20260731120000…sql:197`) →
  `IF s.attribution_status IS DISTINCT FROM 'verified' THEN reasons += 'unverified_attribution'`.
- TS: `buildProgressEvaluation.ts:135` → `if (e.attributionStatus !== 'verified') reasons.push('unverified_attribution')`.
- DB CHECK `spe_eligible_payload`: an eligible row **must** carry `attribution_status = 'verified'`.
  This was a deliberate integrity guard (gaps #2/#6): only trustworthy engine identities may enter the
  comparison, so cross-engine/untrustworthy sessions can't corrupt the clarity metric.

**F2 — `verified` requires a complete live-engine identity tuple.** `captureFinalizingIdentity`
(`SpeechRuntimeController.ts:941-981`) marks VERIFIED only when the live `getMetadata()` returns
**non-blank `engine_version` AND `model_name` AND `device_type`** (plus: known engine token, producer
integrity intact, finalizing mode == latched producer). Anything unconfirmable → `unverified`, and it
does **not** overwrite the placeholder identity — so the `engine_version`/`model_name` seen on an
unverified session row are placeholders, not proof of verification.

**F3 — In production, only Cloud verifies.** Cloud/AssemblyAI supplies all three fields
(`device_type:"cloud"`, `model:"universal-streaming-english"`, `engine_version:"assemblyai"`) → verified.
**Private and Native have never produced a verified session** in the 500-session sample.

**F4 — Everything else in #1045 works on the deployed app:** real entitlement resolution, Private model
load, recording, save, the save-time consumer that creates the evaluation, and the migrations/tables.

---

## 4. Root cause — proven vs hypothesized

- **Proven:** Private/Native never reach `verified`; the block is `unverified_attribution`; Cloud verifies.
- **Hypothesized (NOT yet confirmed — will not assert without proof):** the Private (transformers.js /
  whisper) engine's `getMetadata()` does not return a non-blank `device_type` (and/or `meta` is absent at
  finalize), so the tuple check at `SpeechRuntimeController.ts:970` fails. The controller's per-branch
  `logger.error` reason is the definitive signal; in production the logger may not emit to the browser
  console, so confirming it needs a targeted console/`__SPEECH_RUNTIME_DEBUG__` capture during a recording.
- **Caveat on the sample:** 393/500 rows are `legacy_unknown` (pre-#1033 enrichment) and many are
  `pending` (never finalized). Among sessions that reached terminal attribution post-#1033 the n is small
  (cloud 2 verified; private 2, native 2 unverified) but **consistent and with zero counterexamples**.

---

## 5. Impact

- **Progress is effectively Cloud/Pro-only.** Free/Private and Native users — the primary local-first
  audience — will never see the Progress panel, its takeaways, or "Practice this next," because their
  sessions never become eligible. This likely undercuts the feature's intended reach.
- **Broader than #1045:** any current or future **verified-gated** capability inherits this limitation,
  and it bears on **#1033 attribution truthfulness** (is "unverified" the honest, correct outcome for a
  legitimate Private session, or a gap in identity reporting?).

---

## 6. Proposed options — completing #1045

**Option A — Fix Private/Native verification (highest value; recommended for the feature's purpose).**
Confirm why Private resolves `unverified` (targeted capture of `captureFinalizingIdentity`'s reason /
`getMetadata()` output), fix the engine so a legitimate Private session reports its full identity
(likely `device_type`), then re-run the journey to close #1045.
- *Pro:* Progress actually works for the primary audience; strengthens #1033 truthfulness.
- *Con:* scope unknown until the reason is confirmed; touches attribution (#1033) code, not just #1045.

**Option B — Prove #1045 now via a Cloud/Pro verified journey; track Private separately.**
Run the deployed journey on the maintained Pro account's Cloud path (the only engine that verifies today)
→ eligible eval → Progress panel → accept → next session → server-derived outcome → close #1045 (15/19).
File the Private/Native never-verifies gap as its own high-priority issue.
- *Pro:* closes #1045's loop proof on the deployed app now, honestly, without weakening any guard.
- *Con:* Progress stays dead for Private/Native until Option A lands; Cloud journey has more moving parts
  (Pro entitlement + AssemblyAI token + streaming) and reframes the sample-based Private harness.

**Option C — Both (recommended overall): prove via Cloud now, fix Private next.**
Close #1045's loop proof via Option B (→ 15/19), AND open the Option-A follow-up so Progress reaches the
free audience. Sequences the ledger without shipping a feature that's silently dead for most users.

**Option D — Relax eligibility to accept `unverified` (NOT recommended).**
Fastest green, but undoes integrity gaps #2/#6 — lets untrustworthy/cross-engine sessions into the
comparison and can corrupt the clarity metric. I would not do this without an explicit, eyes-open
decision to change the integrity model.

---

## 7. Proposed options — filing the finding

The "Private/Native never verify" finding is bigger than #1045.

- **R1 (recommended) — New high-priority issue:** "Private/Native sessions never reach `verified`
  attribution in production," with the 500-session distribution, the `captureFinalizingIdentity` tuple
  requirement, the `getMetadata` device_type hypothesis, and the impact on Progress + any verified-gated
  feature. Cross-link #1045 and #1033.
- **R2 — Fold into #1033** (engine-pure attribution), since verified-attribution assignment is its domain.
- **R3 — Memory only** until the #1045 path is chosen.

My recommendation: **Option C + R1** — close the loop proof via Cloud now to advance the ledger, and file
a dedicated high-priority issue to fix Private/Native verification so Progress delivers to the audience it
was built for.
