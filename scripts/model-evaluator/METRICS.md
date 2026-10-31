# Product model comparison measurement contract

This is a specification and instrumentation inventory, **not measured results**.
All current-candidate measurements are NOT RUN. No source preparation, synthetic
control or raw decoder score supplies missing product measurements. The retained
historical standalone results remain supplementary and keep their original limits.

The canonical evaluator mode is `product-lifecycle`: the existing SpeakSharp app,
EngineFactory → PrivateWhisper → PrivateSTT → installed architecture adapter, timed
fixture microphone frames, live windows, native Stop, drain, authoritative whole
utterance final, ordinary save, canonical attribution and exact-session reopen.
`raw-decode` uses PrivateSTT directly and transcribes one complete PCM clip with
`final:true`; its adapter `finalize()` returns that pending result. Its legacy
`finalLatencyMs` is decode-plus-adapter-finalize wall time, **not Stop latency**.

Coverage: **W** = projected by the current product driver/collector; **S** = source
signal exists but is not safely projected/joined; **G** = instrumentation gap;
**O** = outside the selected Open Mic journey. W means available in source, not
executed or validated on this candidate. A missing observation is `null` with
`status: NOT MEASURED` and a reason; an unattempted journey is `NOT RUN`. N/A is
reserved for a phase/capability that genuinely does not apply. No missing value is
zero. Do not emit audio, plaintext transcript/reference, auth headers, account IDs,
request bodies, sensitive URLs or private filesystem paths into public reports.

Every numeric field needs `value`, `unit`, `status`, `reason`, `collectorVersion`,
`clock`, `start`, `end`, `takeId`, package/source/corpus hashes and completeness.
Retain permitted per-take numeric rows before aggregation. A field listed below
is an expected schema field; G/S fields are not silently populated by estimates.

## Clock and attribution rules

P = page `performance.now()` plus recorded `performance.timeOrigin`; H = harness
monotonic wall clock; R = Resource Timing/worker monotonic timeline; O = sampled OS
clock. Differences require the same clock or an explicit recorded mapping.
Playwright request `startTime + responseEnd` is an epoch-mapped request boundary;
reject negative/incomplete timing or an unavailable mapping. Never subtract server
epoch values from page monotonic values. Worker/page intervals need paired mapping
or remain separate. End-to-end intervals overlap component intervals: report them
side by side, do not add decode, drain, init and Stop-to-save totals. Concurrent
downloads require envelope and union-of-active intervals, not a sum called elapsed.

Persisted canonical authority proves the selected declared identity for the exact
session. It does not introspect server-side weight bytes. Descriptor/inventory
hashes, loader response verification and observed backend are distinct evidence.
No model promotion follows merely from successful initialization or decode.

## Artifacts, transfer and cache

| Expected field / definition | Unit | Start → end / clock | Collector and coverage | Validation control |
|---|---|---|---|---|
| `artifact.modelBytes`, unique model/frontend inventory size | bytes | sealed inventory, no elapsed clock | package/registry explicit files W | recompute sizes/hashes; de-duplicate URLs; reject conflicts |
| `artifact.runtimeBytes`, runtime/glue/WASM inventory size | bytes | installed/vendored inventory | runtime byte pins W; classification projection G | do not count runtime as weights; altered installed code refused |
| `artifact.configBytes`, tokenizer/config/vocabulary size | bytes | inventory | files W; per-class summary G | explicit classification, no filename-only guessed semantics |
| `artifact.compressedBytes`, actual stored encoding size | bytes | compressed file representation | G | record encoding/hash separately from decoded representation |
| `network.encodedBodyBytes`, `decodedBodyBytes`, `transferBytes` | bytes | completed response body / R | acquisition telemetry S, worker Resource Timing S | headers/TAO/cache restrictions; unknown transfer size is not zero |
| `network.completedAssetBytes` | bytes | first verified body byte → complete body / H or R | cached server currently schedules bytes W; **completed** delivery G | abort/truncate transfer; scheduled bytes cannot pass as completed |
| `network.requestCount`, `redirectHopCount`, statuses/aborts | count | each actual transport admission through terminal result | bounded transport W; full hop timing S | actual redirect controls; no auto-redirect escape; count denied separately |
| `network.downloadEnvelopeMs` | ms | first selected asset request → last completed selected body / one R clock | worker acquisition S | hash-verified scope; complete request population required |
| `network.activeTransferUnionMs` | ms | union of selected request intervals / R | G | overlapping downloads counted once |
| `network.requestDurationSumMs` | ms | sum of each completed request duration / R | G | clearly label work sum, never wall elapsed |
| `network.throughputBytesPerSecond` | bytes/s | completed bytes / download envelope seconds | G | denominator positive, complete byte coverage, no declared-size substitution |
| `cache.preloadState` | hit/miss/partial/unobserved | before loader dispatch | acquisition cache probe W | response re-hash; distinguish cache absence from unobservable API |
| `cache.browserHttp`, `cacheStorage`, `worker`, `osFile` | categorical | immediately before each take/load | browser context fresh W; other layers G | fresh context does not prove cold OS/HTTP/worker cache |
| `cache.persistentBytes`, per-layer entries | bytes/count | before/after snapshot | G | scoped storage only; unique entries; no unrelated personal cache scan |
| `integrity.verifyMs`, hit/miss verification cost | ms | hash start → verified digest end / P or worker | response verification implemented; timing G | tampered cached/network body fails before decoder; no corrupt-cache retry |
| `asset.coverageCount`, completeness/reason | count/status | observation window | acquisition receipts S; cached inventory W | compare observed identities with required inventory; never infer coverage from count alone |

The bounded comparison serves already retained, hash-verified files. Its loopback
delivery is **not an Internet cold-download measurement**. Two corpus trials are
not automatically cold and warm arms. Real cold-network, controlled cache eviction
or extra warmup runs need a separately selected acquisition/run budget.

## Loading and readiness

| Expected field / definition | Unit | Start → end / clock | Collector and coverage | Validation control |
|---|---|---|---|---|
| `selectionWallMs` | ms | product candidate-switch dispatch → successful switch / H | driver W | includes retirement/setup; do not label pure model load |
| `acquisition.totalMs` | ms | attempt/cache-probe begin → engine initialization return | acquisition success W | attempt ID, release/candidate/fresh epoch match |
| `acquisition.initMs` | ms | current residual total minus measured download | receipt W only complete | includes probe/import/pinning/warmup; not isolated model init |
| `load.cacheProbeMs` | ms | first lookup → final scoped lookup / P/R | S | absent observation is null; no deadline clamp |
| `load.runtimeImportMs`, worker startup | ms | import/worker create → imported/ready handshake / same clock | worker events S; projection G | separate import/worker IPC, preserve requested backend |
| `load.modelParseMs`, session creation/compile | ms | runtime phase enter → settled phase return / worker | G | runtime-specific hooks; never infer kernel time from envelope |
| `load.warmupMs`, warmup success/failure | ms/count | silence warmup invocation → return/error / worker | existing warmed signal S | keep separate from readiness if non-gating; record errors |
| `load.readyMs` | ms | acquisition intent → actual engine ready | initialization/acquisition S | DOM selector alone cannot establish ready |
| `load.reinitCount`, sequence/cause | count/category | all attempts in take | acquisition attempt trace S | count retirements/retries/fallback attempts, not configured maximum |
| `runtime.preflightMs` | ms | installed byte verification begin → end / H | implementation has pins; timing G | actual installed code/version must match; no new download |

## Recording, streaming and partial text

| Expected field / definition | Unit | Start → end / clock | Collector and coverage | Validation control |
|---|---|---|---|---|
| `startToRecordingMs` | ms | trusted Start capture listener → RECORDING + during state / P | passive timeline W | reject untrusted synthetic intent and missing/negative clocks |
| `startToFirstFrameMs` | ms | trusted Start → first accepted product mic frame / P | capture signal S | same capture/session, not fixture injection completion |
| `recordingWallMs` | ms | recording state observed → Stop state observed / P | timeline W | exclude post-Stop processing; observer resolution disclosed |
| `audio.fixtureSeconds` | seconds | WAV decoded sample count / sample rate | fixture/playback W | exact WAV hash; media duration and PCM duration compared |
| `audio.playbackWallMs` | ms | actual fixture play event → ended event / P | fixture controller S | report playback underrun/drift rather than assuming real time |
| `audio.receivedSamples`, frames, rate | samples/count/Hz | capture before playback → capture after ended / P | capture receipt W | same capture, at least approved coverage; counts are not PCM hash |
| `audio.modelInputSha256` | hash | exact post-preprocessing decoder input bytes | raw diagnostic W; full product terminal PCM G | equal WAV hash does not prove equal post-trim PCM |
| `audio.decodedUtteranceSeconds`, trim/cap loss | seconds/samples | actual final call PCM length / rate | final duration W; separate trim/cap deltas G | denominator must be actual decoded duration; flag truncation/capture cap |
| `firstPartialAfterRecordingMs` | ms | recording state → first nonblank observed live DOM text / P | timeline W | pre-Stop, hash+length, same take; DOM coalescing limitation |
| `firstPartialAfterSpeechMs` | ms | product speech anchor → first provisional / P | private timing W | retain `anchor: speech|stream`; do not combine unequal anchors |
| `firstEngineFinalMs` | ms | declared anchor → first engine final segment / P | private timing W | a live segment is not terminal Stop final |
| `firstUsefulPartialMs` | ms | acoustically annotated target event → useful hypothesis | G | requires declared usefulness rubric and aligned truth |
| `partials.count`, timestamps, inter-update cadence | count/ms | successive nonblank DOM changes / P | hash/length timeline W; cadence summary G | differentiate DOM observation from worker emission frequency |
| `partials.stability`, revised/deleted tokens | tokens/rate | aligned transient hypothesis pairs / P | G | hashes/lengths cannot reveal token stability; private transient scoring needed |
| `partials.wordLagMs`, emission lag | ms | annotated audio word end → matching emitted word | G | acoustic alignment and shared clock required; no text-only guess |

## Stop, finalization, persistence and reopen

| Expected field / definition | Unit | Start → end / clock | Collector and coverage | Validation control |
|---|---|---|---|---|
| `stopToEngineEntryMs` | ms | trusted Stop → PrivateWhisper.onStop entry / P | Stop W; entry trace S | do not replace native click with awaited helper return |
| `stopToFinalAcceptedMs` | ms | trusted Stop → authoritative whole-utterance acceptance / P | acceptance trace S; joined numeric field G | exact terminal replacement, not first nonempty live final |
| `stopToFinalVisibleMs` | ms | trusted Stop → terminal accepted content visible in DOM / P | G | match terminal hash; DOM mutation cannot prove pixel presentation |
| `finalizeWaitMs` | ms | onStop entry → whole-utterance commit call / P | private timing W | includes live drain/cleanup; overlaps Stop envelope |
| `finalize.drainWaitMs`, capped/still-processing | ms/boolean | Stop drain begin → idle or existing 5s cap / P | trace S | Stop during in-flight inference; no cap relaxation; cap is censored wait |
| `finalizePrepMs` | ms | commit call entry → facade transcribe invocation / P | private timing W | concatenate/trim/VAD/prepare, not model inference |
| `finalizeDecodeMs` | ms | facade final transcribe invocation → return / P | private timing W | includes scheduling/IPC/runtime pre/postprocess, not pure GPU kernel |
| `rtf` | ratio | final decode ms / (actual decoded seconds × 1000) | private timing W | positive actual duration, same capture/fresh summary; no input-duration substitution |
| `finalize.flushMs`, queue/stream closure | ms | explicit runtime flush enter → return / runtime clock | G or N/A for no distinct flush | per-runtime lifecycle hook, do not invent a phase |
| `finalize.kernelInferenceMs` | ms | backend dispatch → device completion | G | GPU query/ORT profiler if supported; wall time is not kernel time |
| `finalize.postprocessMs` | ms | final decoder return → accepted authoritative text / P | G | whitespace/repetition handling separately traceable |
| `finalize.fallbackCount`, fallback wall duration | count/ms | actual fallback invocation → return | trace S | empty primary result can trigger fallback; count actual calls |
| `stopToSaveIssuedMs` | ms | trusted Stop → complete_session_v2 request issuance | request timing S | exact take/session/status completed, common clock mapping |
| `save.requestMs`, acknowledgment | ms | actual request start → successful full-body completion | Playwright network S | await `finished()`, successful retained status, no header-only ack |
| `stopToCompletionMs` | ms | trusted Stop → successful full response body | driver W | mapped page/network clocks; content equality with completion observed |
| `stopToDurableReadbackMs` | ms | trusted Stop → exact-session matching persisted read result | G | successful ack alone is not independent durable read proof |
| `persistedReadRoundTripMs` | ms | exact-session read issued → complete matching result / H | driver W | includes harness/transport/parse; own-user/exact-ID read |
| `persistence.databaseCommitMs` | ms | DB commit begin → committed transaction | G | cannot infer from client acknowledgment or read latency |
| `authority.readMs`, canonical verdict | ms/category | exact-session authority read → terminal matching row | authority identity W; duration G | absent/wrong/duplicate authority never passes; legacy pending field not substituted |
| `reopenToTranscriptMs` | ms | session navigation dispatch → exact saved content visible / H | driver W | same session/content hash across completion/read/reopen; no length-only equality |
| `retention.expiredCount`, tombstone effects | count | observed retention response / scoped retained evidence | S/G | explicit prior consent; distinguish expired text from deleted row; no destructive cleanup for measurement |
| `content.stageMatch` | boolean/hash | accepted completion → persisted → reopened | collector W | missing/wrong attribution, same-length content and session substitutions fail |

## Transcript accuracy and failure modes

| Expected field / definition | Unit | Reference/output boundary | Collector and coverage | Validation control |
|---|---|---|---|---|
| `trackA.S`, `D`, `I`, `N`, `wer` | word counts/ratio | written reference vs saved completed transcript | shipping wordErrorRate W | official English normalizer `openai/whisper@5f86d1d86363843179951550570367b37c5d6f78`; fillers removed; scorer hash retained |
| `trackB.S`, `D`, `I`, `N`, `wer` | word counts/ratio | independently normalized filler-preserving reference/output | shipping scorer W | never mix tracks; pooled sum(S+D+I)/sum(N), not mean per-clip WER |
| `cer.edits`, `referenceChars`, `cer` | characters/ratio | declared Unicode/space/case/punctuation normalization | G | predeclare code points vs graphemes; empty reference gives undefined ratio |
| `lexical.omittedTokens`, inserted tokens | tokens/count | edit-aligned reference/output | D/I W; aligned spans G | deletion ≠ proven acoustic omission; insertion ≠ semantic hallucination |
| `hallucination.semanticCount`, acoustic errors | count/rubric | audio-truth reviewed spans | G | audio-grounded rubric and adjudication; no inference from WER alone |
| `repetition.risk`, spans/count | status/tokens | raw final + reference-relative repeated spans | helper S; driver projection G | non-mutating metric; legitimate repeated reference phrases are controls |
| `punctuation.P/R/F1`, sentence boundaries | ratio/count | aligned punctuation independent of lexical normalization | `punct_v1` helper S | declare marker types; boundary helper does not measure comma/case accuracy |
| `casing.correct`, eligible tokens, accuracy | count/ratio | aligned matching lexical tokens preserving original case | G | separate denominator and normalization from punctuation-insensitive WER |
| `emptyOutputCount` | count | observed empty terminal vs absent result | current driver rejects empty; explicit quality row G | known empty hypothesis has D=N; unavailable output is not scored as empty |
| `truncatedOutputCount`, explicit capture/model caps | count/status | captured/decoded coverage and terminal suffix | S/G | label heuristic separately; short transcript alone does not prove truncation |
| `filler.reference/detected/byKey` | counts | written reference/raw final | shipping regex helper S | corpus acoustic filler labels unverified; no human-speech claim |
| `normalization`, reference/scorer hashes | IDs/hashes | before scoring | W | retain raw/normalized hashes privately as permitted; no reference changes per arm |

WER may exceed 100% when insertions are large. N=0 has no defined WER; preserve
edit counts and a separate silence policy. No raw transcript/audio in public
evidence. Current synthetic source: retained macOS Samantha-generated fixtures,
one speaker cluster, three unique utterances, repeated twice per arm. Licensing
and source notices must accompany the retained corpus; do not invent a permissive
redistribution license or verified acoustic labels.

## Reliability, UI, transport and resources

| Expected field / definition | Unit | Start → end / scope | Collector and coverage | Validation control |
|---|---|---|---|---|
| `population.planned/started/decoded/saved/attributed/reopened/failed/unattempted` | counts | campaign plan → terminal owned cleanup | rows/budget W; full stage funnel G | denominator per stage; unattempted is not failed decode or successful latency |
| `successRate`, stage rate | ratio | successful observations / actual attempts at that stage | derive W/G | zero attempts is undefined; expose missing/censored counts |
| `timeouts`, deadline source | count/category | existing case/run/phase limits | runner W | right-censored latency, never set value equal to timeout cap |
| `retries`, fallback, auth/token attempts | count/category | actual transport/engine attempts | endpoint budgets W; unified engine attempts S | configured maximum or retry policy is not actual retry count |
| `errors.phase/code`, first cause | bounded categories | availability/consent/integrity/init/capture/decode/finalize/save/authority/reopen/bounds/cleanup | phase W, detailed sanitized codes G | no plaintext error bodies; preserve first cause even if later calls fail |
| `network.logicalRequests/actualHops`, total API/read/write counts | counts | transport boundary through full run | budgets W | include retries/preflights; per-take and whole-run caps unchanged |
| `network.apiBytes`, WebSocket bytes/messages | bytes/count | completed permitted transport | sockets/admissions W; bytes/messages G | do not log auth payloads; separate connection count from messages |
| `provider.forwarded/blockedAttempts` | counts | guarded endpoint boundary | blocked counts W | no constant zero as observation; no paid call selected |
| `cleanup.verified`, duration, owned survivor count | boolean/ms/count | termination issued → owned processes/groups proven absent | cleanup barrier W; duration G | adversarial descendants/uncertainty retain host exclusion; never release on uncertainty |
| `cpu.processCpuMs`, normalized utilization | ms/% | owned process CPU deltas over sampled wall interval / O | G | disclose one-core normalization (>100% possible), child ownership, sample frequency |
| `memory.rssBytes`, sampled peak, PSS if supported | bytes | baseline/interval/end OS samples | G | sampled peak is lower bound; summing shared RSS can double-count |
| `memory.jsHeapUsed/limit`, sampled peak | bytes | browser engine observations / P | G | excludes WASM/native/GPU; API availability explicit |
| `memory.wasmLinearBytes`, committed pages | bytes/pages | actual runtime memory observations | G | binary asset size is not allocated memory |
| `memory.gpuAllocatedBytes`, utilization | bytes/% | supported device/tool observation | G | adapter presence does not report VRAM or utilization |
| `peakBufferedSeconds` | seconds | actual max retained audio buffer | private timing W | audio-duration buffer measure, not total process memory |
| `ui.longTaskCount/totalMs/maxMs` | count/ms | main-thread PerformanceObserver >50ms tasks | G | threshold/window declared; worker activity not directly represented |
| `ui.inputDelayMs`, handler time | ms | event start → handler start → end / Event Timing | G | supported trusted events only; no helper await duration substitution |
| `ui.rafGapMs`, responsiveness | ms/count | successive visible frame callbacks | G | observed cadence, no assumed 60Hz; background/headless state disclosed |
| `environment.thermalState`, throttle observations | category | supported OS/device observation | G | slow decode does not establish thermal throttling |
| `energy.joules`, power/battery cost | J/W/% | calibrated permitted instrumentation | N/A unless genuinely instrumented | never derive energy from CPU time or assume battery API accuracy |

## Identity, aggregation and journey applicability

| Expected field / definition | Unit | Source / boundary | Coverage | Validation control |
|---|---|---|---|---|
| `packageDigest`, model/revision/export/quantization, profile | IDs/hashes | same sealed descriptor for eval/adoption | W | body and asset digests; unsupported format refused, no metadata-only promotion |
| `runtime.requested/installed/observed`, backend and threads | versions/IDs/count | installed executable pins + actual service evidence | W/S | stale installed version/bytes rejected; exact backend checked, no silent fallback |
| `environment.browser/OS/hardware/driver` | IDs/values | browser version, userAgent, host inventory | UA/concurrency/isolation W; detailed inventory G | record browser channel/headed mode, CPU/RAM/GPU/driver/power; no inferred Apple GPU requirement |
| `cacheState`, visibility, run order | categorical | per-take environment | context fresh/run order W; all cache layers G | same declared conditions; disclose order/thermal/cache drift |
| `source.head/tree/delta/untracked/served/driver/lock` | hashes | admission-time and execution-time postimages | existing source binding W | pre/post hashes plus actual wrapper admission/owner/allocation receipt; no retroactive proof |
| `input.wav/reference/normalizedPCM/scorer` | hashes | corpus and actual decoder input | WAV/reference/scorer W; product final PCM G | same fixture/trial pairing; source license/acoustic truth limits retained |
| `identity.session/capture/authority` | private hashes/status | recorded capture and canonical exact-session authority | W | content/session mismatch or wrong model cannot pass; declared vs observed distinction preserved |
| `stats.valid/missing/censored`, raw values | count/value array | each metric population | row W; complete distribution projection G | every metric reports its own valid sample count |
| `stats.median/min/max`, optional mean/SD | metric units | finite valid observations | median W; min/max/raw arrays G | tiny repeated corpus is descriptive; do not report fake P95/P99 or population confidence |
| `paired.delta`, ratio | same metric units/ratio | same fixture+trial matched arms | G | complete pairs only; positive denominator, expose dropped pairs/backend differences |
| `population.uniqueClips/speakers/trials` | counts | corpus manifest | W | default18 =3 models×3 clips×2 trials: n6/arm, only3 unique clips, one speaker cluster |
| `focus.coverage/precision/recall`, live-window latency | ratio/count/ms | selected Focus fixture windows → live/final saved statuses | collector supports rubric S; current Open Mic O | separate selected journey/truth/windows; Stop-only score cannot prove live coverage |
| `coaching.latency/usage/cost/rubric` | ms/tokens/currency/rating | separately selected provider journey | O | requires explicit provider/spend budget and independent rubric; currently NOT RUN |

Publish per-model side-by-side values only after execution, with failures, sample
counts, runtime/backend differences and evidence hashes. Descriptive paired deltas
cannot compensate for one-speaker dependence, unverified acoustic labels, missing
metrics or unequal cache/hardware conditions. A smoke comparison is not a
promotion qualification or proof of zero incumbent performance regression.
