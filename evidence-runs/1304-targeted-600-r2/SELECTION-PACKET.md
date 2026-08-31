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

## The leading "yeah" — persistent transcriber state, and my earlier framing was wrong

Full analysis and the withdrawn claims: `YEAH-CLASSIFICATION.md`.

**Supported:** persistent state in the Moonshine transcriber changes the output of subsequent decode
calls, and this benchmark violated independent-clip semantics by reusing ONE transcriber across all
600 clips with no reset. Shared instance produces a leading "yeah" (3/8); a fresh instance per clip
produces none (0/8).

**NOT supported, and withdrawn:** that it "is not the model" (the probe separates reused from fresh
instances, not runtime from weights); that a corrected WER is 0.05260; that the accuracy ordering is
strengthened; that only the leading token changed. The probe's own output shows a NON-"yeah"
recognition difference in `1221-135767-0022` ("struggle for." vs "struggle for subjection."), so
subtracting tokens from the numerator does not produce a WER.

**Count correction:** 101 hypotheses begin with "yeah"; **100** are Track-B insertions. Clip
`5484-24318-0015` aligns its leading "yeah" as substitutions (S/D/I = 2/0/0).

**Directly relevant to the product, not only the harness:** `MoonshineStreamingEngine` has the same
shape — one transcriber, repeated overlapping three-second windows, then a full-buffer decode on that
same instance at `stop()`. Whether the product path shows the same or another state artifact is OPEN.

## Evidence class — NOT wholly selection-grade

| r2 field | v2 / q4 / int8 | moonshine-medium |
|---|---|---|
| Accuracy (WER) | **usable** | **INVALID for independent-clip selection** |
| Bootstrap comparisons | usable among v2/q4/int8 | **invalid for selection** (diagnostic only) |
| Reliability counters | usable | diagnostic, lifecycle-dependent |
| Hypotheses / insertion profile | usable | retained **diagnostic** evidence |
| Latency | v2 **CONTAMINATED**, q4 **CONTAMINATED (~4 min)**, int8 clean | host-uncontaminated but **methodology-invalid** until the isolation/reset cost is known |

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

`bootstrap.txt` reproduces byte-identically from that command — the script now prints its own
reproduce footer, which an earlier revision appended by hand while claiming byte-identity. Per-arm
insertion profiles are extracted to `insertion-profiles.json`.
The "yeah" classification probe is `scripts/probe-moonshine-yeah.mts`, its artifact
`evidence-runs/1304-yeah-classification.json`.

## Stopping here

No model is selected, activated, or defaulted. `PRIVATE_STT_MODEL_IN_USE` remains `v2:base.en`.

Current posture, stated so it is not read as a ruling: v2 is the operational default and NOT a newly
selected winner; moonshine-medium's r2 accuracy row is INVALID for selection and it remains a prospect
on HOLD; v4:base:int8 is a browser-capable human-test prospect that has NOT meaningfully beaten v2;
q4 is a reference control.

**r2 is not the selection artifact.** It is the run that discovered invalid Moonshine methodology. A
corrected four-arm r3 — after the benchmark isolation fix and a retained shared-state preflight — will
be the canonical selection evidence. r2 must not be mathematically adjusted into that role.

## Identity of this packet vs the run

| | |
|---|---|
| Benchmark execution SHA | `7f6e5d37` |
| Product baseline | `024b574f` |
| Evidence-packet commit | the commit introducing this directory — `git log -1 -- evidence-runs/1304-targeted-600-r2/` |

The two are deliberately distinct: the run was executed at `7f6e5d37`, and the analysis in this packet
was written and CORRECTED afterwards. Citing one SHA for both would imply the analysis was produced by
the run.
