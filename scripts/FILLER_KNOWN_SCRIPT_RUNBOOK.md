# Filler known-script take — Reviewer/QA diagnostic runbook

**Source of truth is DECIDED and not in question here:** the **live filler counter is canonical**; the
**transcript recount is diagnostic/fallback only** (used only when the canonical live/persisted filler data
is absent/malformed). There is **no source decision pending** and **nothing is enabled by this runbook** — it
only *measures* live vs recount vs a known ground truth for validation/monitoring.

**Operator: Reviewer/QA, not the Product Owner.** Reviewer/QA drives the mic / Start-Stop; Dev only reads
numbers over read-only CDP. This is optional diagnostics — skip it unless you are validating the recount
fallback or investigating a discrepancy.

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
   - For Script 2, add `honestly` to the custom filler words first.
2. Read a script **verbatim** in the target mode; press **Stop** normally; wait for finalize.
3. From a terminal, run the collector (read-only — it does not touch the browser):
   ```
   CDP_URL=http://127.0.0.1:9222 MODE=private SCRIPT=1 GROUND_TRUTH=9 \
     node scripts/filler-known-script-collector.mjs
   ```
   (set `MODE`/`SCRIPT`/`GROUND_TRUTH` per take). It writes a sanitized JSON to `/private/tmp/STT_RUNS/`.
4. Repeat for each script × mode.

## Sanitized artifact schema (numbers-only — NO transcript text, NO page URL)
```jsonc
{
  "capturedAt": "ISO",
  "pageKind": "session",                // enum, not a URL
  "mode": "private|cloud|native",
  "script": "1|2|3",
  "groundTruthFillerCount": 9,          // declared
  "artifact": {
    "engine": "private",
    "selectedSource": "service_result", // enum, not text
    "liveFillerCount": 4,               // CANONICAL user-facing source
    "recountFillerCount": 1,            // diagnostic only
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

## What the numbers are for (diagnostic — NOT a source decision)
- `liveFillerCount` is what the product shows/saves (canonical). `recountFillerCount` is a diagnostic
  comparison only — it never overrides the live count for users.
- Large `delta` in a mode is a signal worth investigating (e.g. a live-counter or engine bug), not a trigger
  to switch sources. The recount is used in product ONLY as the save/analytics/PDF fallback when the canonical
  live/persisted data is absent/malformed.

## Guardrails
Read-only CDP only (Reviewer/QA drives Start/Stop — **not** the Product Owner). Numbers-only artifacts; no
transcript/partial text; custom words anonymized in-app. Nothing is enabled; live stays the only user-facing
source; no writer deletion; no release-readiness claim.
