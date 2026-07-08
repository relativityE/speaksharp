# Filler known-script take — owner runbook (Phase 5.8 Step 1)

Goal: decide whether the **transcript recount** is a *correct* filler source or whether Whisper's committed
re-decode cleans out real spoken fillers. Owner drives the mic; Dev only reads numbers over read-only CDP.

**Nothing is enabled by this.** The flag stays default OFF; this only *measures*.

## Two flag states (read before recording)

- **Product / default state — flag OFF.** `VITE_FILLER_RECOUNT_SSOT` stays default OFF. Nothing is broadly
  enabled; production behavior is unchanged. The numbers-only artifacts below are produced regardless of the
  flag (the diagnostic computes live *and* recount either way).
- **Owner LOCAL validation state — flag ON (dev-only).** For **one** local dev run, the owner starts the dev
  build with `VITE_FILLER_RECOUNT_SSOT=true` purely to **visually** confirm coherence of:
  `FillerWordsCard` detail rows · aggregate filler count · clarity · score · selected-source.
  This is **local dev-only validation — NOT production enablement and NOT a broad flag flip.** It changes only
  what *this local build* displays.

## Known scripts (read each verbatim; declared ground truth)

- **Script 1 — static fillers (ground truth = 9):**
  > So, um, today I want to cover the plan. Basically, it's, like, um, the key thing. And, uh, we should, like, focus here. So, um, that's the point.
  Distribution: `um×3, so×2, like×2, uh×1, basically×1`.

- **Script 2 — custom word (ground truth = 3; add custom word `honestly`):**
  > Honestly, this is the update. Honestly, we're on track. And honestly, the numbers look good.
  Distribution: `honestly×3` (custom → appears as `custom_1` in artifacts).

- **Script 3 — no-filler control (ground truth = 0):**
  > The quarterly results exceeded our targets. Revenue grew across every region. The team executed on schedule.

## Steps (per mode: Private, Cloud, Native-if-feasible)

1. Start the dev build on port **5174** (Chrome launched with `--remote-debugging-port=9222`).
   - The `fillerDivergence` hook is dev/test-gated; it only appears in a dev/test build.
   - For Script 2, add `honestly` to your custom filler words first.
2. Read a script **verbatim** in the target mode; press **Stop** normally; wait for finalize.
3. From a terminal, run the collector (read-only — it does not touch your browser):
   ```
   CDP_URL=http://127.0.0.1:9222 MODE=private SCRIPT=1 GROUND_TRUTH=9 \
     node scripts/filler-known-script-collector.mjs
   ```
   (set `MODE`/`SCRIPT`/`GROUND_TRUTH` per take). It writes a sanitized JSON to `/private/tmp/STT_RUNS/`.
4. Repeat for each script × mode.
5. **Dev-only flag-ON visual check (once, optional but recommended):** restart the LOCAL dev build with
   `VITE_FILLER_RECOUNT_SSOT=true`, re-read one script, and **visually** confirm that the `FillerWordsCard`
   detail rows, aggregate filler count, clarity, score, and selected-source all agree (recount source).
   This is **local dev-only** — it does not enable the flag in production or for anyone else.

## Sanitized artifact schema (numbers-only — NO transcript text, NO page URL)
```jsonc
{
  "capturedAt": "ISO",
  "pageKind": "session",                // enum, not a URL
  "mode": "private|cloud|native",
  "script": "1|2|3",
  "groundTruthFillerCount": 9,          // owner-declared
  "artifact": {
    "engine": "private",
    "selectedSource": "service_result", // enum, not text
    "liveFillerCount": 4,
    "recountFillerCount": 1,
    "delta": -3,                        // recount − live
    "clarityLive": 18, "clarityRecount": 68, "clarityDelta": 50,
    "scoreLive": 3, "scoreRecount": 4.3, "scoreDelta": 1.3,
    "usedCustomWords": false,
    "liveDetail":    { "um": 4 },                 // allowlisted labels + custom_N only
    "recountDetail": { "um": 1 }
  }
}
```
Detail keys are ONLY: `um, uh, ah, like, You Know, so, actually, oh, I Mean, basically, literally, Kind Of, Sort Of`, or anonymized `custom_1..N` / `custom_other`. Raw custom words never appear.

## The gate (what we decide from the numbers)
- **recount ≈ ground truth** (and live over-counts) → recount is the better source → **proceed to Step 2 fork**.
- **recount materially < ground truth** (Whisper cleaned real fillers) → **STOP and re-scope** — recount would under-report; the live counter may be better for coaching.
- **live closer than recount in a specific mode** → document that mode's behavior before any enablement.

## Guardrails
Read-only CDP only (owner drives Start/Stop). Numbers-only artifacts; no transcript/partial text; custom
words anonymized in-app. Flag stays OFF; no writer deletion; no SSOT claim; no release-readiness claim.
