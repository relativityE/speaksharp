# Case 3 marker observation increment

2026-10-19 14:18 UTC. CLI Dev is preparing the new isolated observer and test within Sam's 14:12 bounded manifest. Branch `cli-dev/1593-marker-timeline-20261019`, base `83029ebb67216b2690eeff59e4ec1730d5f6ffe8`.

New paths: `tests/live/helpers/rwtMarkerTimeline.ts`, `tests/unit/rwtMarkerTimeline1593.test.ts`, this packet. Retained non-merge branch history has no edits to these new paths. The existing shared `tests/live/helpers/rwtFocusPointsJourney.ts` remains App-owned and untouched pending its explicit all-branch/slice handoff and CLI ACK. Do not publish a scaffold PR or claim caller integration before that handoff.

Diagnostic probe `/private/tmp/cli-case3-observation-clock-probe-20261019.mjs` executes jsdom MutationObserver semantics and transpiles/renders actual LiveTranscript source; 4/4 controls PASS. Confirmed limits: callbacks provide upper observation bounds rather than exact mutation times; old values retain intermediate transitions; close must drain pending records; same URL does not prove document identity; provisional/committed filler can render identically. These are offline observation limits, not historical lateness attribution or product-fix acceptance.

Collector plan: pre-arm before any first activation, preserve document/window token, old-value transition intervals and observation loss, capture exact in-window acquisition candidates and content-free rendered transcript timing, close synchronously after draining records. Do not label rendered non-interim text authoritative committed text or a getUserMedia request timestamp verified audio onset. Preserve historical verdict/deadline; hold ambiguous identity/clock/observation results.

Checkpointed at 14:21 UTC, before returning to Sam's bounded #1667 correction. New collector controls: 23/23 PASS (`collector-green.json`); scoped ESLint exit 0. Earlier first collector run: 20/20 PASS. No full quality checkpoint or caller integration yet. JSON reports normalized, raw originals retained privately. No process or live operation is running.

App explicitly froze the shared Focus file at 14:20, retaining 218 unmerged #1662 lines, and offered integrate after #1662 (preferred) or stack on it. Sam's route decision remains pending; CLI has not edited that shared file. The new observer/test work is locally preserved and held. Resume it only after completing #1667's in-scope human-reflex and capture-time corrections. No scaffold PR is open for this incomplete increment. Next CLI actual correction evidence by 14:31 UTC.
