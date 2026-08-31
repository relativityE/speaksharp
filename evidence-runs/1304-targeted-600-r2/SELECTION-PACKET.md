# Targeted 600 (r2) — selection packet

**Run:** `evidence-runs/1304-targeted-600-r2/targeted-finalists.json`
**sha256:** `44e7c5fc796e2099e0a948885a153a8d0e8292e12c3898e55b3c94e9ba340253`
**executionSha:** `7f6e5d37` · **productBaseline:** `024b574f` · **plan:** `targeted-finalists-v1`
**Command:** `npx tsx scripts/run-browser-matrix.mts --set=corpus --mode=pinned --selection-plan=targeted-finalists-v1 --product-baseline=024b574f --out=evidence-runs/1304-targeted-600-r2/targeted-finalists.json`

**This packet does not select a model.** It reports what the run measured and stops.

## Acceptance criteria — all met

| # | Criterion | Result |
|---|---|---|
| 1 | Preserve and checksum before analysis | done; artifact set read-only, `SHA256SUMS.txt` written first |
| 2 | Validate all 15 planned rows exactly once | 15 rows: **4 measured + 11 dispositions** |
| 3 | Four measured arms at 600/600 | all four **600/600** |
| 4 | Every observed reliability counter zero | `threw`/`emptyOutput`/`missing`/`timedOut`/`audioRejected`/`truncated` = **0** on all four |
| 5 | Pin verification | `pinVerification.ok = true` on all four; `assetFailures: []`, `pinViolations` none |

## Accuracy — pooled WER and paired bootstrap

600 utterances, 10,000 resamples, deterministic seed `0x1304600`, pooled WER = Σ(S+D+I)/Σ(refWords).

| Arm | Pooled WER |
|---|---:|
| **moonshine:streaming-medium** | **0.06187** |
| v4:base:int8 | 0.06811 |
| v2:base.en *(shipping)* | 0.06903 |
| v4:base:q4 | 0.06985 |

| Comparison | Difference | 95% CI | Verdict |
|---|---:|---|---|
| v2 vs q4 | −0.00083 | [−0.00451, +0.00293] | not distinguishable |
| v2 vs int8 | +0.00092 | [−0.00199, +0.00406] | not distinguishable |
| q4 vs int8 | +0.00174 | [−0.00133, +0.00485] | not distinguishable |
| **v2 vs moonshine** | **+0.00716** | [+0.00084, +0.01381] | **distinguishable** |
| **q4 vs moonshine** | **+0.00799** | [+0.00167, +0.01436] | **distinguishable** |
| **int8 vs moonshine** | **+0.00624** | [+0.00018, +0.01227] | **distinguishable** |

**v2, q4 and int8 are mutually indistinguishable.** Moonshine-medium is distinguishably more accurate
than all three. Note that int8's browser execution is confirmed here: `executionBackend`
`browser_wasm`, 600/600, counters zero.

## The leading "yeah" — a HARNESS defect, and my earlier framing was wrong

Moonshine-medium's rows carry 213 Track-B insertions, of which **"yeah" x100**, against 106-113 for
every other arm. The full analysis is in `YEAH-CLASSIFICATION.md`. In summary:

- **It is our harness, not the model.** Same clips, same audio, same model: one reused transcriber
  produces the leading "yeah" (3/8), a fresh transcriber per clip produces **none** (0/8).
  `run-browser-matrix.mts` loads ONE `Transcriber` per arm and reuses it for all 600 clips with no
  reset, and a STREAMING decoder leaks state across clip boundaries.
- **Consequence: moonshine's 0.06187 is a PENALTY, not a fault.** ~101 of its 212 Track-A insertions
  are harness-induced. Removing them implies ~0.05260 from this same run, which WIDENS its margin
  over v2 rather than narrowing it.

### Two claims I made earlier that were WRONG, corrected here

1. **"It inflates SpeakSharp's headline filler metric."** FALSE. `frontend/src/config.ts` defines
   `TRUE_FILLER_WORDS = [um, uh, ah]` and `DISCOURSE_MARKER_WORDS = [like, you know, so, actually, oh,
   I mean, basically, literally, kind of, sort of]`. **"yeah" is in neither**, and the headline is
   true-fillers plus the user's own custom words. An inserted "yeah" damages transcript truth and user
   trust, and would matter only to a user who added "yeah" as a custom word. It does **not** move the
   default headline number. "yeah" is NOT being added to the product vocabulary to make a diagnostic
   catch it — that would change product behaviour to suit an instrument.
2. **"Spontaneous speech is likely worse."** WITHDRAWN as unsupported. Nothing here measures
   spontaneous speech; it may be worse, better, or simply different.

### What is NOT yet established

The mechanism is **indicated, not proven**. The probe covers 8 clips in two conditions (A and B of the
required matrix). Still open: shared transcriber with reordered/affected-first clips, an explicit
reset path if the runtime exposes one, benchmark arm vs the Moonshine PRODUCT engine, full-buffer vs
3-second-window decoding, and identical audio repeated in one process. **No Moonshine disposition —
select or reject — is supported by this packet.**

## Evidence class — NOT wholly selection-grade

| Field | v2:base.en | v4:base:q4 | v4:base:int8 | moonshine-medium |
|---|---|---|---|---|
| WER / reliability / hypotheses / insertions | usable | usable | usable | usable |
| **Latency (`wallClockMs`, `clipTimings`)** | **CONTAMINATED** | **CONTAMINATED (~4 min)** | clean | clean |

Cause and exact overlap windows: `HOST-CONTAMINATION.md`. Host load rose from 4.43 at start to 6.15
at end.

**Mixed promotion is not supported by this schema.** Each row carries `wallClockMs` and `clipTimings`
with **no per-arm or per-field disposition**, so promoting the artifact would publish contaminated v2
and q4 latency as canonical with nothing in the file marking it. Therefore:

- **RETAIN** this artifact as accuracy/reliability evidence for all four arms, plus clean latency for
  int8 and moonshine;
- **DO NOT** promote it as the unqualified selection-grade artifact;
- to replace v2 and q4 latency, rerun those two arms on a quiet host and reconcile all 600 utterances
  on id, S/D/I, reliability and WER before substituting the timing fields.

The accuracy conclusion is unlikely to move — the contamination affects timing, not decoding — but
that is a reason to trust the WER, not a reason to publish the latency.

## Reproduce

```
node scripts/analysis/paired-bootstrap.mjs \
  evidence-runs/1304-targeted-600-r2/targeted-finalists.json 10000 0x1304600
```

Output retained as `bootstrap.txt`; per-arm insertion profiles extracted to `insertion-profiles.json`.
The "yeah" classification probe is `scripts/probe-moonshine-yeah.mts`, its artifact
`evidence-runs/1304-yeah-classification.json`.

## Stopping here

No model is selected, activated, or defaulted. `PRIVATE_STT_MODEL_IN_USE` remains `v2:base.en`.

Current posture, stated so it is not read as a ruling: v2 is the operational default and NOT a newly
selected winner; moonshine-medium is the accuracy-leading prospect on HOLD pending causal
classification; v4:base:int8 is a browser-capable human-test prospect that has NOT meaningfully beaten
v2; q4 is a reference control.
