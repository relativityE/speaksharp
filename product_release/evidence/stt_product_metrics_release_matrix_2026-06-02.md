# STT Product Metrics Release Matrix — Current

**Updated:** 2026-06-04T13:20Z  
**Purpose:** One-page current STT release status. Older proof history is intentionally removed from this active matrix; use git history only if a prior artifact must be audited.

## Current Classification

| STT | Status | Why | Next owner/action |
| --- | --- | --- | --- |
| Cloud baseline | Closest to release-green | Baseline is near corrected AssemblyAI target and is the paid quality path. Keyterms are stopped for standard fillers. | test-release-agent / Codex: current-head baseline app-path proof with timeline, tail, readability, save/history/detail. |
| Private v2 | Not release-green | Human proof after explicit setup consent produced `56.36%` accuracy, missed `um`, substituted `main idea/every transcript` with `memory transcript`, and detail transcript was empty. | @dev-agent: fix content loss/substitution, first-visible draft gating, and detail boundary. |
| Private v4 | Not 24h path | Browser worker/runtime has not produced a scoreable non-empty save candidate in prior runs. | Hold unless product reopens v4 runtime work. |
| Native Chrome | Not release-green | Real mic proof captured/saved full 55-word transcript and formatter ran fast, but detail was empty and truecasing/readability still failed (`Starts Now`). | @dev-agent: fix detail boundary and general truecasing/readability; test reruns real mic. |

## Current Human Proofs

| Engine | Artifact | Result |
| --- | --- | --- |
| Native | `/private/tmp/speaksharp-native-human-20260604-rerun2.json` | Full capture/save/history/analytics, formatter `853ms`, but detail empty and readability/truecasing failed. |
| Native formatter plumbing | automated Vitest + edge tests | Frontend formatter suites `35/35`; edge functions `73/73`. Plumbing verified; quality/detail still not green. |
| Private | `/private/tmp/speaksharp-private-human-20260604-rerun.json` | Setup consent proven, but 56.36% accuracy, `um` missed, detail empty, live progress suspect. |
| Private decode A/B | `/private/tmp/speaksharp-private-decode-ab-h1_6-real-auth` | h1_6 baseline `75.00%`; anti-hallucination decode options `0.00%`. Candidate rejected; keep current defaults. |
| Session → Analytics coherence | targeted Vitest + Playwright | Analytics dashboard/page/score math `66/66`; user-facing regression `9/9`; analytics suite/truth `13/13`. Score caveats, transcript quality, filler/readability signals, detail navigation, reload/export, and session-to-analytics parity are currently covered by automated proof. |
| Browser UX bug hunt | Playwright full-suite subset | Primary journeys, user features, custom filler words, goals, and error states `19/19`. No new automated UX bug surfaced; human STT quality/detail/trust findings remain the controlling blockers. |

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

## Trust-Copy Contract

| Engine | Allowed | Forbidden |
| --- | --- | --- |
| Private | `Listening locally…`, `Processing speech locally…`, `Finalizing local transcript…`, `Draft transcript` for visible provisional words | Server/Gemini formatter by default; formatter hiding semantic STT substitutions |
| Native / Cloud | `Draft transcript`, `Processing transcript…`, `Finalizing transcript…`, normal final styling | `local`, `locally`, or `on this device` for STT processing |

## Current Dev/Test Handoff

| Owner | Work |
| --- | --- |
| @dev-agent | Native detail empty; Native truecasing/readability; Native trust-label spacing; Private accuracy/substitution; Private detail empty; Private first-visible draft gating. |
| test-release-agent / Codex | Own tasks #1-#7 below: Private decode-parameter A/B; Native formatter verification; Private VAD test plan; Session-to-Analytics coherence; browser UX bug hunt; Cloud baseline proof; report/backlog hygiene. |
| product | Keep Cloud baseline only for launch; keep Private formatter local-only; decide whether Native raw-at-Stop plus async formatting is acceptable if quality improves. |

## Test-Release Agent / Codex Task Queue

| # | Task | Status |
| --- | --- | --- |
| 1 | Private decode-parameter A/B | h1_6 complete: anti-hallucination candidate rejected; expand only for a new dev-proposed candidate |
| 2 | Native raw-first async formatter verification | Automated plumbing verified; human/browser rerun still needed after dev fixes quality/detail |
| 3 | Private VAD prototype test plan | Plan complete; execution waits for named dev VAD prototype flag |
| 4 | Session-to-Analytics coherence pass | Complete: `66/66` targeted Vitest, `9/9` user-facing browser regressions, `13/13` analytics suite/truth |
| 5 | Browser UX bug hunt | Complete: `19/19` Playwright across primary journey, user features, filler words, goals, and error states; no new automated UX bug found |
| 6 | Cloud baseline proof | Assigned to test-release-agent / Codex |
| 7 | Report/backlog hygiene | Assigned to test-release-agent / Codex |

Coordination protocol: do work on a temporary branch; when complete and verified, merge to `main`, delete the temp branch, and update the owning evidence file with the merge commit. Do not leave release fixes stranded on long-lived branches.
