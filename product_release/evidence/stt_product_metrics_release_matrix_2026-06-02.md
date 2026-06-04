# STT Product Metrics Release Matrix — Current

**Updated:** 2026-06-04T15:50Z
**Purpose:** One-page current STT release status. Older proof history is intentionally removed from this active matrix; use git history only if a prior artifact must be audited.

## Current Classification

| STT | Status | Why | Next owner/action |
| --- | --- | --- | --- |
| Cloud baseline | Closest to release-green, lower release priority than Native/Private | Baseline is near corrected AssemblyAI target and is the paid quality path. Current-head deployed smoke passed; keyterms are stopped for standard fillers. | Pause further Cloud work until Native/Private blockers move, except richer baseline metrics if explicitly requested. |
| Private v2 | Not release-green | Human proof after explicit setup consent produced `56.36%` accuracy, missed `um`, substituted `main idea/every transcript` with `memory transcript`, and detail transcript was empty pre-#29 fix. Product bar: Private must meet/beat the better of same-model/drop-in and Native human Chrome mic baseline. | test-release-agent / Codex re-proofs current-main #29 detail fix + Fix-A-v2; @dev-agent owns content loss/substitution, first-visible draft gating, and any named VAD/model candidate. |
| Private v4 | Not 24h path | Browser worker/runtime has not produced a scoreable non-empty save candidate in prior runs. | Hold unless product reopens v4 runtime work. |
| Native Chrome | Not release-green | Real mic proof captured/saved full 55-word transcript and formatter ran fast, but detail was empty and truecasing/readability still failed (`Starts Now`) before current-main re-proof. | test-release-agent / Codex reruns real mic on current main to verify #29 detail fix, trust spacing, and truecasing/readability. |

## Current Human Proofs

| Engine | Artifact | Result |
| --- | --- | --- |
| Native | `/private/tmp/speaksharp-native-human-20260604-rerun2.json` | Full capture/save/history/analytics, formatter `853ms`, but detail empty and readability/truecasing failed in the pre-reproof artifact. Current-main re-proof is required. |
| Native formatter plumbing | automated Vitest + edge tests | Frontend formatter suites `35/35`; edge functions `73/73`. Plumbing verified; quality/detail still not green. |
| Private | `/private/tmp/speaksharp-private-human-20260604-rerun.json` | Setup consent proven, but 56.36% accuracy, `um` missed, detail empty pre-#29 fix, live progress suspect. Current-main re-proof is required. |
| Private decode A/B | `/private/tmp/speaksharp-private-decode-ab-h1_6-real-auth` | h1_6 baseline `75.00%`; anti-hallucination decode options `0.00%`. Candidate rejected; keep current defaults. |
| Session → Analytics coherence | targeted Vitest + Playwright | Analytics dashboard/page/score math `66/66`; user-facing regression `9/9`; analytics suite/truth `13/13`. Score caveats, transcript quality, filler/readability signals, detail navigation, reload/export, and session-to-analytics parity are currently covered by automated proof. |
| Browser UX bug hunt | Playwright full-suite subset | Primary journeys, user features, custom filler words, goals, and error states `19/19`. No new automated UX bug surfaced; human STT quality/detail/trust findings remain the controlling blockers. |
| Cloud baseline local + deployed smoke | Vitest + GitHub Actions live proof | Local contract/timing stack `44/44`; deployed app-path smoke run `26960691857` passed (`1/1`, `46.2s`) with provider partial/final/terminated events, save, and analytics history. This is smoke evidence, not full WER/tail/readability green. |

## Release Metrics Required Per STT

| Group | Required fields |
| --- | --- |
| Setup | auth/tier, STT mode, provider/model ready, mic/input route, runtime telemetry |
| Timing | first progress, first useful text, finalization wait, stop-to-detail |
| Accuracy | WER/accuracy, word completeness, semantic substitutions, drop-in/customer delta |
| Product signals | filler recall, false filler insertion, transcript confidence |
| Readability | terminal punctuation, sentence count, max run-on words, capitalization/truecasing defects, duplicate detection |
| Journey | visible transcript, authoritative save candidate, saved row, history, detail, score/analytics alignment |
| Trust UX | correct Draft/Processing/Final labels and no false local-processing claims |

Private-specific release comparison:

```text
Private green requires app-vs-drop-in delta and app-vs-Native-baseline delta.
Do not classify Private green on privacy value alone.
```

## Trust-Copy Contract

| Engine | Allowed | Forbidden |
| --- | --- | --- |
| Private | `Listening locally…`, `Processing speech locally…`, `Finalizing local transcript…`, `Draft transcript` for visible provisional words | Server/Gemini formatter by default; formatter hiding semantic STT substitutions |
| Native / Cloud | `Draft transcript`, `Processing transcript…`, `Finalizing transcript…`, normal final styling | `local`, `locally`, or `on this device` for STT processing |

## Current Dev/Test Handoff

| Owner | Work |
| --- | --- |
| @dev-agent | Private accuracy/substitution; Private first-visible draft gating; #30 setup CTA; return-timestamps audit; named VAD flag; any Fix-A-v2/VAD/model candidate must be named, flagged, and browser-proven against drop-in and Native baseline. |
| test-release-agent / Codex | Re-proof current-main Native #29/detail, trust spacing, and truecasing; re-proof current-main Private #29/detail and Fix-A-v2; run v4 containment; then run VAD/model proofs after dev ships named candidates. |
| product | Keep Cloud baseline only for launch; keep Private formatter local-only; decide whether Native raw-at-Stop plus async formatting is acceptable if quality improves. |

## Test-Release Agent / Codex Task Queue

| # | Task | Status |
| --- | --- | --- |
| 1 | Private decode-parameter A/B | h1_6 complete: anti-hallucination candidate rejected; expand only for a new dev-proposed candidate |
| 2 | Native raw-first async formatter verification | Automated plumbing verified; human/browser rerun still needed after dev fixes quality/detail |
| 3 | Private VAD prototype test plan | Plan complete; execution waits for named dev VAD prototype flag |
| 4 | Session-to-Analytics coherence pass | Complete: `66/66` targeted Vitest, `9/9` user-facing browser regressions, `13/13` analytics suite/truth |
| 5 | Browser UX bug hunt | Complete: `19/19` Playwright across primary journey, user features, filler words, goals, and error states; no new automated UX bug found |
| 6 | Cloud baseline proof | Local contract complete: `44/44`; current-head deployed smoke passed `1/1`; full metric proof deferred behind Native/Private |
| 7 | Report/backlog hygiene | Complete: stale backlog/report signals pruned; active reports retain current blockers, owners, artifacts, and proof gates |

Coordination protocol: do work on a temporary branch; when complete and verified, merge to `main`, delete the temp branch, and update the owning evidence file with the merge commit. Do not leave release fixes stranded on long-lived branches.
