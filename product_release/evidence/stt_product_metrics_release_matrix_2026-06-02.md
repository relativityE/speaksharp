# STT Product Metrics Release Matrix — Current

**Updated:** 2026-06-04T11:45Z  
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
| Private | `/private/tmp/speaksharp-private-human-20260604-rerun.json` | Setup consent proven, but 56.36% accuracy, `um` missed, detail empty, live progress suspect. |

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
| test-release-agent / Codex | Rerun Native real mic and Private human proof after dev fixes; run Cloud baseline current-head proof after higher-priority Native/Private blockers. |
| product | Keep Cloud baseline only for launch; keep Private formatter local-only; decide whether Native raw-at-Stop plus async formatting is acceptable if quality improves. |
