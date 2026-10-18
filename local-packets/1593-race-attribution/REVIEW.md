# Independent race and attribution review

Reviewed #1656 exact `f4d4bad906d6f736f384fbc45ca88164ca6c197b`, against served-source baseline `968e67a45604cab23cb2aa5b82035471182c3ee1`. This is CLI's evidence-only packet requested at15:09; no App implementation is edited and no competing PR is opened.

## Executed independent controls

Run `node --test --import tsx local-packets/1593-race-attribution/review.test.mjs` from this checkout with existing dependencies. Baseline source/dependencies are materialized byte-for-byte from the exact local Git objects; no network or provider call. **4/4 PASS**, with deterministic mocked Date/timers:

1. Original tap: A starts; settle1000ms starts; B arrives at999ms; A answers. The original closes B at age0/1ms and ignores B's successful answer10ms later. PASS means the original unsafe behavior was reproduced, not accepted.
2. Head tap, same schedule: B remains nonterminal/in flight at the deadline, with age1ms and both hashed identifiers in receipt evidence. The budget remains HOLD; B's later successful answer becomes its one terminal record.
3. Head tap, response body pending: status200 and age/hash remain observable without inventing body completion; eventual body completion yields exactly one terminal B record and no duplicate in-flight entry.
4. Existing product telemetry seam: capture A's real journey/attempt, create a late A callback, begin B's journey/attempt, then build the event's real ambient envelope. The callback acquires B's ambient journey/attempt while keeping A's synthetic diagnostic reference. This is a reproduction of the source-level envelope seam, **not** a full React integration or proof of live ingestion. `AISuggestions.tsx` emits the diagnostic for a superseded result; `practiceLoopTelemetry.ts` passes it to AnalyticsBuffer, whose push builds this ambient envelope. The existing product gap remains for App's separate patch; #1656 is test-harness scope and does not claim to fix it.

Saved `review.tap` contains the complete independent run. No raw account/session/diagnostic identifiers from production are used; fixture labels are synthetic and published correlation values are hashes. The Node MockTimers warning is about that test API's stability, not a product failure.

Also independently executed the two maintained exact-head unit files: `coachingGenerationTapSettle1474.test.ts` **8 PASS** and `rwtHarnessSettleIdentity1593.test.ts` **9 PASS**, separate successful invocations, total17. Sparse-checkout setup initially omitted `frontend/tests` and `tests/helpers`; those collection failures were corrected by including the existing tracked paths, without source/dependency edits. The8 passing tests were not needlessly repeated when rerunning the other file. No full-suite, quality or live-evidence rerun is claimed here.

## Source findings

No additional blocking finding in the reviewed #1656 correction. Each sent request is judged against its own allowance; new requests wake settle, and a younger request remains open at the caller's deadline. Deadline/allowance are separate. `inFlightTimeline` captures the request-event snapshot separately from terminal `exchangeTimeline`; pending requests preserve unknown-cost/HOLD rather than becoming answered or zero. The persistence identity is reread after the bounded wait and before repeat, correcting the stale snapshot. Immediate-repeat behavior and per-case maxima/readback rules are unchanged.

The case1 unmatched browser exchange is still not conclusively joined to a server diagnostic. Offline reproduction does not establish that this specific race caused that specific missing browser exchange. Sam's source acceptance and exact-head CI/Code/Security qualification remain separate; this packet grants no merge, deployment, retry or live rerun authority. The existing campaign remains halted.

## Product-patch review contract

App's separate origin/lifecycle implementation must preserve A's **origin** journey/boot/recording attempt even when the ambient context is B. A reports explicit supersession without claiming A rendered; B's complete chain occurs once. Request receipt/validation, persistence, readiness and visible rendering are separate observations; an ended lifecycle is not another terminal provider result. Missing telemetry is unknown. Validate never-settling invocation, malformed response, unmount/retry cancellation, below-fold readiness and StrictMode replay. Outside Session no new STT/coaching begins; supported local abort/teardown is distinct from independently proving already-accepted server work settled.

Deletion policy is account-only: verified explicit confirmation → durable pending → reject new admission → allow accepted tasks to settle → delete/verify. Already-sent save/Gemini work may complete. There is no global shutdown requirement. CLI's separate #1643 packet will map the concrete remaining admission/settlement gaps; it will not duplicate App's Session lifecycle implementation.
