# Case1 fresh-run diagnosis and resumable handoff

Browser PM,19 October2026, completed12:30UTC. Sam's two-lane assignment: independent diagnosis only. No shared implementation files changed or owned by PM. All new files are under local-packets/1593-case1-diagnosis-20261019. No new live, provider, model, hosted-database, account or retention operation. Offline PGlite uses synthetic data only.

## Exact evidence and observed sequence

[Run39215823020/job117939313670](https://github.com/relativityE/speaksharp/actions/runs/39215823020/job/117939313670), attempt1, workflow rc-gates.yml. Executed head and receipt release **ba1a9f5ad31778460a4ea9e383a08be14b3222f6**. Created07:24:52UTC, completed07:37:07UTC. Diagnostic workflow failure is not a standalone case verdict.

1. The first take saved once and rendered two9-word coaching phrases, HTTP200/provider200. Visible pair matched saved pair. This is not the historical provider429 failure.
2. The Practice-again save take persisted as a distinct session. Its own review's repeat action became enabled after the legitimate gate cleared and started another recording. The helper deliberately presses this action as soon as offered, before waiting for its coaching response.
3. Boundary request#2 started07:28:13.350 and answeredHTTP200 at07:28:44.317. The next recording had already started07:28:17.971 and stopped07:28:18.569. Request#3 started07:28:21.699 and answeredHTTP200 at07:28:53.155. All3 browser coaching exchanges answered200;5 provider attempts reported in total; no unanswered or browser-failed request at the bound. These timestamps come from the retained request timeline and phase logs, not a new execution.
4. Read-two-takes returned bothPairsSaved=false/evidenceDiffers=true after its bounded wait. The public row does not say whether first or second pair was absent.
5. Sent review counters were requested3/completed1/persisted1/rendered1/failed0. Those are current mounted-view counters, not a server persistence audit. AISuggestions emits completed/persisted only when isCurrentRequest(); a valid late superseded response is separately diagnosed and cannot publish into the successor's UI.
6. Actual PostHog readback ran: first session_after_open_mic/analytics journey QUALIFIED, repeat session_during+session_interrupted_repeat+practice_again journey HOLD with missing practice_loop on three readbacks, feedback/PDF journey QUALIFIED. Do not call the whole readback absent or failed.
7. Prompt binding HOLD named saved_prompt_inputs_unavailable for the first take. The reader collapses read error, missing row and non-string/missing transcript; this code alone does not prove deletion, a database error or lack of all reconstruction.

## Finding A: confirmed interrupted-stage versus global-gate conflict

Actual source **frontend/src/services/telemetry/completenessGate.ts** defines session_interrupted_repeat without practice_loop, consistent with the deliberately interrupted view. Its dedicated test asserts that absence. But requiredFamiliesForStages returns the full REQUIRED_EVENT_FAMILIES for any recording declaration; that global list includes practice_loop. Therefore the exact fresh-run declaration still requires the supposedly excluded family.

[Executed source probe](source-probe-results.json): the real exported stage says stageRequiresPracticeLoop=false, while the real exported requiredFamiliesForStages(['session_during','session_interrupted_repeat','practice_again']) says globalRequiresPracticeLoop=true. This matches the precise fresh-run readback failure. It is a source-contract defect, not merely missing proof of generic telemetry delivery.

**Smallest receiving change:** make the global required-family calculation agree with the explicitly bound interrupted-repeat contract, while preserving ordinary completed-review requirements, identity/positive-control receipts, recording spine, accepted-work terminal evidence and stale-application negatives. Do not remove practice_loop globally or label a lifecycle-only interrupted outcome as successful useful coaching. Empty/unknown declarations must remain fail-closed. A declaration containing a full after-review stage must still require its review evidence. The interrupted stage's lifecycle/identity invariants must still be evaluated and qualify; removing this one contradictory prerequisite alone is not case closure.

**Regression map:** run the exact mixed declaration above, not only the isolated stage object; ordinary full Open Mic, full Focus, mixed interrupted+full-after, empty and unknown declarations; missing lifecycle/identity; stale response applied to a successor; valid supersession with no fabricated rendered review. Sam should name the receiving writer after checking App/CLI's unpublished-file manifests. PM has not edited the gate.

## Finding B: confirmed retention-valid counterexample to the simultaneous-pairs oracle

Actual migration20260810120000_retention_purge_ai_suggestions.sql nulls ai_suggestions when transcript_state becomes expired. Later newest-one expiry code ranks completed transcripts and expires rows outside the newest eligible one. readTwoTakesCoaching polls for BOTH current saved pairs; takesDifferVerdict HOLDs if either is absent. This can conflate policy-correct loss of the older pair with failure to persist the repeat pair.

The offline probe applies the **actual purge migration** to a minimal in-memory synthetic PGlite sessions table. Both pairs initially exist. An explicit expiry input onA removesA's pair and preservesB's pair; the actual takesDifferVerdict then returns HOLD. Controls PASS. This executes the purge trigger, not the whole retention-ranking chain, RPC save stack or hosted database. It establishes a valid causal alternative/source-oracle conflict; it does not establish which historical row was missing or the exact expiry transaction in this run.

This also makes normal first-take expiry a plausible contributor to the later prompt-input HOLD. The existing collapsed reader result cannot distinguish it from missing row/read error. Do not claim this historical cause is proved without that discriminator.

**Smallest next check:** preserve separate firstPairPresent/secondPairPresent, each row's transcript_state, bound session identity and closed read-result category before cleanup. Verify retention chronology/authority where retained, without retrieving or republishing speech. Under an already approved restricted synthetic-evidence scope, a comparison may capture each eligible generation while it exists and then compare immutable, correctly bound evidence; Sam must confirm that scope and the receiving oracle before implementation. Do not retain user content longer, disable expiry, recreate an old provider answer, or introduce a recipe archive merely to make this test pass. The separate real-user recipe retention proposal remains separate.

## What the response and view evidence does, and does not, establish

Under the exact Edge source's successful fresh-response path, parsed suggestions are saved and read back before HTTP200. The cache path also serves existing validated suggestions. The client deliberately withholds completed/persisted/rendered view events once a request is superseded. Hence HTTP200 + only one current-view completion is not sufficient evidence of lost accepted server work. The repeat response arrives roughly26s after the successor started; supersession is expected to matter. The actual historical response-body/authority/session tuple and retained per-attempt lifecycle are still needed to distinguish valid settled accepted work, later retention, parse failure or an actual persistence defect. No second provider request is needed to manufacture that diagnosis.

App/CLI should join the existing exact request/attempt/session digests, accepted-work lifecycle and authority outcomes; never borrow the next take's success. Keep first-review and feedback positives credited. A valid interrupted/superseded terminal state is not a rendered second coaching pair, and it does not close human usefulness or input/output traceability.

## Executed work, boundaries and receiving handoff

- Read current authorized run metadata, decoded job log, public content-free receipt and readback records; inspected exact historical Git objects rather than current working-tree source by assumption.
- Executed node scripts/host-interlock.mjs hold local -- node local-packets/1593-case1-diagnosis-20261019/probe-source.mjs. Four grouped controls PASS: mixed stage/global requirement conflict, both pairs before expiry, actual expiry-trigger purge, actual comparison HOLD afterward. Dependency imports outside the family-selection paths are inert test stubs; their behavior is not qualified by this probe.
- [Probe source](probe-source.mjs) hashes every inspected source. [Retained summary](retained-summary.json) carries allowlisted facts only; no raw transcript, coaching text, email, credential or private account/session identifier is copied.
- These are independent PM findings. Other owners' earlier case9/11 changes, Stop-order work and case7/10 findings remain theirs and are not repeated as new PM implementations.

**For Sam:** accept/return these bounded findings; assign the disjoint gate/oracle/diagnostic changes against actual file manifests and incorporate this fresh-run diagnosis into the one15-case ledger. App/CLI remain the implementation lanes. No new live test, merge, deployment, migration apply, provider spending, privacy policy or destructive cleanup is authorized here.

**Resumable state:** this diagnosis packet is complete. Remaining evidence is the separate historical first/second pair/state/read-result and accepted-work authority join; the mixed-stage correction needs assigned ownership and reviewed source. PM owns no implementation file. All probes have ended; no new process is left running. At the end of this active session PM is **STOPPED**, not an unattended background lane. Resume from this packet and the latest Slack/file manifests; no future timed wake or active checkpoint is promised by that stopped handoff.
