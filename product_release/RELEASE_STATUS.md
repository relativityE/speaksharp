# Release Status

**Last updated:** 2026-06-30 · Last updated by: dev-agent (claude). **See the "UPDATE 2026-06-30" in §Current Decision for the current state — the close batch is deployed; the 90s cap is REJECTED for beta; full-5-min latency + the immediate-start re-gate are the open pre-beta items.** The §7 hardening bundle — #885 (stt-switching reliability refactor) + #886 (canary→honest-Free) + #888 (Report-Issue arm context already on `main` via #884 + v4 posture docs) — is merged to `main`. **Final signoff SHA `0c485addffcbde285b05bb1dda6c1aaa5d6632dd`.** A fresh full post-merge signoff PASSED on that exact SHA: `gate=all` all 5 gates (run `28306514090`), deploy-health canary (`28306448320`), telemetry e2e (`28306516507`), stt-switching contract **3/3** (`28306519120`/`28306525596`/`28306652236`, each Private model served-from-local 7 / missed 0), full CI (`28306448318`), `auth.users` Δ=0 (before `28306495580`=35 → after `28306772708`=35). Service-Level evidence = advisory/waived for controlled beta (per "Quality And Service-Level Evidence" + `RC_GATES.md`). **UPDATE 2026-06-28 — INVITES HELD:** an owner-driven manual human STT test (CDP-observed, prod, account `kaikinservices+protest@gmail.com`) found the **default Private v2 path drops the opening clause** (reproduced with a warm/ready model; P1 #891), which the tester guide actively promotes. Automated gates remained valid for engine liveness + metadata but **did not assert transcription completeness** (P1 test gap #892). **Tester invites are HELD until #891 lands;** then re-gate on the new signoff SHA. Native + Cloud verified good (Cloud effective-Pro confirmed). Findings: `/private/tmp/MANUAL_STT_TEST_FINDINGS_2026-06-28.md`.
**Scope:** Single source of truth for current release posture.

If this file conflicts with older files in `product_release/archive/`, this file wins. Stable contracts and procedures live in the operational docs and RC gate docs; current ship status lives here only.

## Current Decision

> **Two distinct verdicts — do not conflate** (release-owner framing; updated 2026-06-26). A code-readiness review clears *source posture only*; it does **not** clear operational gates. Source readiness ≠ release approval.
>
> - **Source-code posture — ✅ no confirmed P0/P1.** Independent main-branch reviews + dev verification found no confirmed source-code P0/P1 defect. Non-blocking follow-ups tracked in `BACKLOG.md`. The 2026-06 DB hygiene + recurring-drift fix is complete (production `auth.users` 1,445 → 35; see RELEASE_CLOSEOUT_LEDGER §E).
> - **Operational release posture — ⛔ controlled-beta INVITES HELD (owner decision 2026-06-28).** Automated gates passed on `0c485add` (`gate=all` `28306514090`, canary, telemetry e2e, stt-switching 3/3, full CI, `auth.users` Δ=0) — but a manual human STT test found a **P1 in the default Private path (observed most clearly on v2): the opening clause can be dropped by a shared capture-path bug** ([#891](https://github.com/relativityE/speaksharp/issues/891), reproduced warm-model), plus a **P1 STT test gap** ([#892](https://github.com/relativityE/speaksharp/issues/892): assertions check keyword-presence, not opening/coverage — which is why 3/3 green didn't catch it). v4 captured the opening in that take, but the opening-loss is a **shared Private capture-path** class (observed clearest on v2), **not strictly v2-specific**; v4's phrase-repetition is a separate artifact and v4 stays a flag-gated/targeted candidate (controlled exposure for promotion data, not shelved). **HOLD invites until #891 lands + re-gated.** **UPDATE 2026-06-29:** root cause proven capture-side on a real failing take; fix = **capture-from-start** ([#898](https://github.com/relativityE/speaksharp/pull/898), DRAFT — locally validated old→new on real audio, NOT yet on `main`, pending the deployed saved-History re-gate). #892 now also rejects ≥5-word verbatim loops (engine-agnostic, guards v4 duplication). Private finalization **latency ≤5s is a separate, still-open gate** ([#900](https://github.com/relativityE/speaksharp/pull/900) + threading + segmentation). Native + Cloud are good. Payments stay hidden/`stripeKeyClass="test"`; paid launch is a separate Ops cutover (RELEASE_CLOSEOUT_LEDGER §D). **UPDATE 2026-06-30:** #898 (capture-from-start) **and the full immediate-start close batch are MERGED + DEPLOYED** — #902 (mic-ready gate), #903 (90s-cap *safety switch* + repetition collapse made **flag-only at BOTH saved-path sites** PrivateWhisper+TranscriptionService, zero saved-text mutation), #904 (prominent amber→green "Ready — speak now" cue), #905 (state-colored status pill + hide the wrong rolling draft during finalize), #906 (dimmed-draft finalize + honest progress). Opening-loss: **delayed/soft-onset PROVEN fixed**; the **immediate-start fix is deployed but UNPROVEN on a real immediate-start take → that re-gate is the ONE open pre-beta validation**. **LATENCY — owner RULING (2026-06-30): the 90s per-recording cap is REJECTED as beta behavior** (internal safety switch only); **a full 5-minute single recording with <30s post-stop is REQUIRED pre-beta.** Primary path under evaluation = **Moonshine v2 (streaming) prototype on a branch**; fallback = **segmented finalization**; COOP/COEP multithread is coded but **inert in prod** (headers off — Layer-1 audit done, jsDelivr ORT WASM is the #1 target). **INVITES REMAIN HELD** pending BOTH (a) the immediate-start re-gate AND (b) the full-5-min latency solution.

| Release Track | Status | Why |
|---|---|---|
| Controlled private beta / early-access (non-payment) | ⛔ INVITES HELD — P1 in default Private v2 path ([#891](https://github.com/relativityE/speaksharp/issues/891)) | Automated signoff PASSED on `0c485add` (`gate=all` `28306514090`, canary `28306448320`, telemetry `28306516507`, stt-switching 3/3, CI `28306448318`, `auth.users` Δ=0) — but manual human STT test found Private **v2 drops the opening clause** (#891, warm-model) and the STT tests assert keyword-presence not completeness (#892). Native + Cloud good; Cloud effective-Pro verified. **Hold invites until #891 fixed + re-gated.** Payments hidden (`stripeKeyClass="test"`). |
| Paid public launch (live checkout open) | NO-GO until Ops config cutover | Billing journey is PROVEN (test mode = accepted proof). Going live is an **Ops key swap** (`sk_live`/`pk_live`/live `whsec`/live price IDs + register live webhook + verify `stripeKeyClass==="live"`), not a further proof. Until done, do not open live checkout. |
| Broad public launch | NO-GO | Mobile/broad-public gates are broader than the controlled tester scope and remain separately gated. |

## Latest Evidence

| Area | Latest Evidence | Status |
|---|---|---:|
| RC gates | ✅ All 5 gates GREEN on **final signoff SHA `0c485add`** — `gate=all` run `28306514090` (2026-06-27): Gate 1 Product / 2 SAST / 3 DAST (live) / 4 SCA / 5 UX all success. Before/after hygiene audit proved **0 gate-induced `auth.users` drift** (35 → 35; before `28306495580`, after `28306772708`). CURRENT signoff evidence — every gate run is on the exact post-merge SHA. Prior all-green `28235534502` (2026-06-26) superseded. | PASS (2026-06-27) — final signoff SHA |
| Post-merge live proofs | ✅ On `0c485add`: deploy-health canary `28306448320` (Free canary verified) · telemetry e2e `28306516507` · stt-switching contract **3/3** (`28306519120`/`28306525596`/`28306652236`; each Private model served-from-local 7, missed 0, distinct Cloud/Private persisted metadata `assemblyai` vs `private_v2:whisper-base.en`) · full CI `28306448318`. | PASS (2026-06-27) |
| DB hygiene | ✅ Production `auth.users` cleaned **1,445 → 35** ahead of onboarding: **34 KEEP** (soak registry, stable canary, reviewer/CI) + **1 HELD/PRESERVED** (`***@gmail.com` — known live-Stripe real account, intentionally preserved + hardcoded-protected; the audit classifier still buckets it INVESTIGATE on its real-domain/Stripe signals, but operationally it is HELD, **not** "needs investigation"). **DELETE 0 · NORMALIZE 0 · legacy-canary residue 0 · first-time-tester residue 0.** Root-cause drift fix: 5 accumulator live-specs now reuse stable `-reuse@speaksharp.app` accounts (or first-time-tester create-and-delete via #869); classifier KEEPs the `-reuse` convention. | DONE (2026-06-26) |
| Stripe (billing journey) | ✅ Checkout → webhook → billing-portal **journey PROVEN in Stripe TEST mode = the accepted proof** (release-owner ruling, `RELEASE_CLOSEOUT_LEDGER.md` §D; runs `27441691671` / `27173676657`). Live keys are **not** money-tested and not required as a proof. Going to **paid** launch = an **Ops config cutover** (set `sk_live`/`pk_live`/live `whsec`/live price IDs, register the live webhook, verify `stripeKeyClass==="live"`) — a launch-day step, **not** a pending Dev/QA test. Current prod runtime: `stripeKeyClass="test"` (payments hidden/controlled). | PROVEN (test mode); live = config cutover |
| CI/Test Audit | Green on `main` (run `27684865346` @`b18220da`; #820/#821/#822 each passed required CI before squash-merge) | GREEN |
| Production smoke | ✅ Deploy-health `Production Canary Smoke Test` GREEN on `0c485add` (run `28306448320`); canary account now honest-Free (#886), smoke passes as Free with `auth.users` Δ=0 | PASS (2026-06-27) |
| Supabase deploy | Push-triggered deploy workflow remains the backend/Edge deploy proof when backend paths change | IN PROGRESS / CHECK GITHUB |
| Ops health | Hosted ops status is a high-level display fed by the authoritative GitHub/Supabase JSON evidence path | CHECK CURRENT DASHBOARD |
| Software quality | `SOFTWARE_QUALITY.operational.md`; generated artifacts `product_release/evidence/software-quality.latest.*` uploaded by CI | ADVISORY / EVIDENCE |
| Service levels | `SERVICE_LEVELS.operational.md`; backend stress and browser endurance artifacts from `stress-endurance.yml` | ADVISORY UNLESS PROMOTED |
| Private deployed worker | Gate 3 passed after the Vite `?worker&url` worker fix | PASS |
| Native Browser STT | Chrome desktop real mic uses `continuous=true`, `interimResults=true`, `maxAlternatives=1`; Native corpus/WER is not a benchmark gate | PASS WITH BROWSER CAVEAT |
| Cloud STT | Cloud-only Pro STT Artifact Matrix run `26762814579` passed after Supabase migration/function deploy run `26762736418`; transcript, save/history/detail, AI suggestions, and PDF export completed on `main` commit `7431e843` | PASS FOR CLOUD PRO PATH |
| Benchmarks | Vendor numbers verified + INTERNAL-ONLY (no customer vendor-vs-SpeakSharp comparison); v4 reproducible facts = WebGPU floors + Gate 2 + Gate B (`tests/STT_BENCHMARKS.json` `_measurement_framing`). v4 Node-ceiling re-measure = post-launch backlog. Native excluded from WER claims. | ADVISORY / INTERNAL |
| Gate B (v4 A/B) | Read-only verified for operator `22899590` (selectionSource=posthog_flag, base_q4, no fallback, sessions saved); flag OFF/0% for everyone else | VERIFIED — A/B flip = owner's call |

## Current Blockers

| Priority | Blocker | Required Closure |
|---|---|---|
| ✅ RESOLVED | Latest pushed `main` green required workflows | Full CI + `gate=all` green on the post-merge signoff SHA `0c485add` (gate=all `28306514090`, CI `28306448318`); 0 `auth.users` drift (35→35). |
| ✅ RESOLVED | RC gates must pass on the **final signoff SHA** | DONE — `gate=all` all 5 green on the exact post-merge signoff SHA `0c485add` (run `28306514090`), with deploy-health canary, telemetry e2e, stt-switching 3/3, and full CI all on the same SHA, `auth.users` Δ=0. No gate pending; tester-invite go/no-go is the release-owner's decision. |
| P1 | Stress/endurance evidence is newly structured | Use `stress-endurance.yml` artifacts for backend p50/p95/counts and browser endurance memory evidence; advisory unless stability is release risk. |
| P1 | Private and Native STT remain below the Cloud proof standard | Private needs timing/parity fixes; Native needs live-text consistency and punctuation/readability proof before either can be claimed as launch-quality. |
| P2 | Ops health display is intentionally high-level | If hosted ops status is red/yellow, inspect the richer GitHub/Supabase JSON evidence rather than reconciling a second query source. |

## STT Release Positioning

| Engine | Release Role | Current Claim Boundary |
|---|---|---|
| Private v2 | Controlled, benchmarkable local STT path | In our control; suitable for benchmark automation once current artifacts are refreshed. |
| Private v4 | Controlled, benchmarkable worker-backed local STT path | In our control; WIP benchmark evidence must replace mini-corpus seed data. |
| Cloud | Controlled, provider-backed STT path | Current strongest/pristine STT candidate. Cloud-only Pro artifact run `26762814579` passed live transcript, stop/save, history/detail, AI suggestions, and PDF export. Paid Early Access entitlement required. |
| Native Browser | Browser-dependent convenience STT | Chrome desktop recommended. Do not use Native fixture/WER as release benchmark evidence unless the exact audio route is proven. |

## Known Limitations

- **Private (Whisper) short-clip repetition.** On short or ambiguous audio, Whisper may repeat a phrase in the transcript (a known model failure class around silence/non-speech regions), which can inflate filler counts and short-clip WER. Long-form transcription is unaffected (Washington fixture ~98.95%). For this release we **preserve the raw model output rather than deleting text that may reflect real speech** — prior aggressive de-duplication was reverted for data integrity, and decode-param tuning A/B'd worse. The saved transcript is flagged (non-mutating `detectRepetitionRisk` → `repetitionRisk` evidence fields), not altered. **The principled fix (VAD / audio segmentation) is queued as the next STT reliability lane (STT-P5).**

## Tester Scope

Send testers the plain-language `SOFT_RELEASE_TESTER_INSTRUCTIONS.md`; operators run the validation per `INTERNAL_TEST_PROTOCOL.md`. The tester path is:

1. Fresh account starts with free Browser transcription.
2. Private sample model download/setup if prompted.
3. Private sample recording, transcript, stop/save, history/detail, analytics.
4. Custom word added through UI and spoken during recording.
5. PDF export from saved session.
6. Optional Browser transcription in Chrome with browser-dependent wording.

## Evidence Freshness Contract

Each release gate is green only when the definition of green is backed by a named artifact that a reviewer can inspect without relying on operator memory. The active artifact is always the latest complete passing run. If a newer run fails any required criterion, the parent gate returns to red until a later complete run passes every criterion. Every artifact update must record `Last updated by: [initials] [date] [artifact path]`.

## Quality And Service-Level Evidence

Quality and service-level data are evidence, not PRD content:

- Product promises and user-visible guarantees live in `PRD.operational.md`.
- Quality interpretation lives in `SOFTWARE_QUALITY.operational.md`.
- SLO/SLC/SLA definitions and target interpretation live in `SERVICE_LEVELS.operational.md`.
- Generated software-quality artifacts are produced under `product_release/evidence/` during CI and uploaded as artifacts.
- Backend stress and browser endurance artifacts are produced by `stress-endurance.yml` and are advisory unless explicitly promoted by this file or `RC_GATES.md`.

## Named STT Gate Artifacts

| Gate | Required Current Artifact |
|---|---|
| G6 Fresh Trial Private STT Transcript/Save/History Path | `/private/tmp/speaksharp-private-human-[timestamp].json`; must include `SESSION_LIFECYCLE_WARMUP`, model setup/download state, chunk RMS/duration rows, first partial timestamp/text, console events, save result, and history/detail proof. |
| Native Browser Chrome human-mic proof | `/private/tmp/speaksharp-native-[timestamp].json`; must include event order from `onspeechstart -> first onresult`, selected transcript on stop, save/history/detail proof, analytics proof, and no unintended 4-word sequence appearing more than once. |
| Cloud Pro proof | `/private/tmp/cloud-artifact-[timestamp].log` (latest: GitHub Actions run `26762814579`, artifact `/private/tmp/pro-stt-artifact-matrix-26762814579/`); must show AssemblyAI token HTTP 200, transcript/save/history/detail proof, AI suggestions, PDF export, and Pro entitlement context. |
| Custom word analytics proof | Browser/session artifact showing words such as `like = 1` or `basically = 1` after adding the custom word through the UI, then saving and opening detail/analytics. |
| PDF export proof | Saved-session PDF artifact whose transcript, duration, WPM, filler/custom word counts, and session metadata match the saved detail view within ±15%. |
| Session Status UX | Screenshot/video or browser trace showing one clear status/progress surface, Private setup/download/ready states, and no duplicate or internal FSM/debug status obstructing the user flow. |

## Update Rule

Only this file should receive changing release status, latest run IDs, blocker state, or go/no-go decisions. Other Markdown files should be stable contracts, procedures, tester copy, or archived evidence.
