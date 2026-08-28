# Beta-50 Option D — functional-QA sell-off

> **HISTORICAL EVIDENCE — point-in-time measurement, NOT current release truth.**
> This report records what was measured on its own date. It is **not** rewritten to look current, and it
> must not be: a measurement edited to match today's posture stops being evidence of anything.
> Current release posture: [`RELEASE_STATUS.md`](../../RELEASE_STATUS.md). Current work sequencing:
> [`ACTIVE_COORDINATION.md`](../../ACTIVE_COORDINATION.md).
> STT model selection is **not complete** — no Private model has been chosen; any model ranking below
> predates the #1304 certified harness and its frozen corpus.

**Scope:** the Option D functional QA gates (Browser · Private · Cloud paths + supporting surfaces), validated on the **deployed** production build. This is the **QA-gate verdict only** — the overall Beta-50 invite / release decision (incl. any latency / Ops gates) remains the release owner's call and is tracked in `RELEASE_STATUS.md`.

**Deployed under test:** `899161b2` (`https://speaksharp-public.vercel.app`), test Pro account, read-only CDP on the instrumented Chrome, passive console/network monitor. Date: 2026-07-10.

## Sell-off table

| # | Gate | Result | Evidence |
|---|---|---|---|
| 1 | **Cloud path** | ✅ PASS | Mode select → real transcript via AssemblyAI streaming; `assemblyai-token → 200` → **WSS `streaming.assemblyai.com/v3/ws`** → `sessions → 204`; filler card present |
| 2 | **Filler SSOT §6** | ✅ PASS | Displayed card `(4)` breakdown `like×2 / so×2 / um0 / uh0` **==** saved payload `filler_words.total.count:4` same per-word breakdown — surfaces consistent |
| 3 | **PDF proof** | ✅ PASS (affordance + reachable) | `/analytics` loads 103 sessions, each with per-session `download-pdf-btn-<id>` (desktop) + "Download Session PDF" (mobile). Generation not click-triggered (avoids a file download) — affordance + reachability is the proof |
| 4 | **Report Issue** | ✅ PASS | "Browser QA 50" row triage-verified: new slug `recording_transcription` + `user_id` present + full metadata + `include_transcript=false`/`transcript_excerpt=null`/`include_audio=false`/`audio_attachment_note=null` |
| 5 | **Console / network / Sentry** | ✅ PASS | No console errors across Private/Cloud/filler takes; saves `204`; only benign diagnostics (`[filler-ssot]` recount fallback on silent take; `[updateLocalUsage] QueryClient not found`); no Sentry error |
| 6 | **Private path** | ✅ PASS | #957 deployed validation (see `PRIVATE_PATH_VALIDATION.md`): no post-session lockout, cached-return (second recording, no reload), mobile start (no model-less crash), transcript/filler/save, analytics reachable |
| — | Browser path (prior QA) | ✅ PASS · caveat | Web Speech filler undercount + no punctuation — non-blocking product-quality note |
| — | Mobile | ✅ PASS | Mobile action bar starts Private without a model-less crash |

## Non-blocking caveats (with follow-ups)
1. **Browser Web-Speech filler undercount + no punctuation** — product-quality limitation of the browser provider; non-blocking.
2. **`download-required` progress bar not live-reproducible** on the served default model (`whisper-base.en` auto-loads from `/models/`). Unit-tested; deterministic live harness tracked as a follow-up. See `PRIVATE_PATH_VALIDATION.md`.

## Engine posture (unchanged)
- **v2 / `whisper-base.en` remains the Beta-50 Private default.** v4 is **not** switched into the release path (flag-gated candidate only).

## Final recommendation (Option D functional QA)
🟢 **QA-GO** — all Option D functional gates PASS on the deployed build. Private/Cloud/Browser each record → transcript → filler → save; Report Issue, Analytics, and PDF paths reachable; no console/network/Sentry blockers; mobile safe. Remaining items are non-blocking caveats with logged follow-ups. The overall invite/release decision stays with the owner (`RELEASE_STATUS.md`).
