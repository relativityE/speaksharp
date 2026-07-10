# Beta-50 Option D — Private path deployed validation

**Verdict: Private path = PASS** (owner-accepted 2026-07-10).
**Caveat (non-blocking follow-up):** deterministic live harness for the forced `download-required` / remote-model path — the literal download percentage-progress branch was unit-tested but not production-reproducible on the default served model (see below).

## Deployment under test
- **Deployed SHA:** `899161b2` — `fix(session): Private first-run — click mic to download, honest pill, no crash (#957)`
- Production deployment created `2026-07-10T13:46:34Z`; new code confirmed live (`viteMode: production`; the old `download-model-button-inline` "Set up Private" button is gone).
- App: `https://speaksharp-public.vercel.app/session` · test Pro account.
- Method: read-only CDP on the instrumented Chrome (Chrome/150), passive console/network monitor running throughout.

## Desktop — CDP state log
| Phase | data-model-status | runtime | mic disabled | data-recording | pill |
|---|---|---|---|---|---|
| Private ready (pre-record) | ready | READY | false | false | "Ready to record" |
| First start → engine load | loading | ENGINE_INITIALIZING | true | false | "Download complete. Preparing Private model…" |
| Recording | ready | RECORDING | false | true | "Recording active" |
| **Post-session idle (no-lockout gate)** | **idle** | **READY** | **false** | false | "✓ Great practice! Session saved." |
| **Cached-return: click mic → 2nd take** | ready | **RECORDING** | false | **true** | "Recording active" |
| After 2nd stop | idle | READY | false | false | "✓ Great practice! Session saved." |

- **Transcript appears:** live transcript rendered real speech (test take).
- **Filler card:** present.
- **Session saves:** `PATCH /rest/v1/sessions → 204` (×2).
- **Analytics/PDF reachable:** `post-save-review-actions` present.
- **Cached-return / second recording without reload:** `RECORDING#2=OK · SAVED=OK · MIC-RE-ENABLED=OK`. The post-session `idle` state — which the earlier transient-status gate locked out as "Private not ready" — kept the mic **enabled**.
- Screenshot: `desktop-private-cached-return.jpg`

## Mobile (390×844) — CDP state log
- Mobile action bar present + visible (md:hidden → shown on mobile).
- Private idle → label "Start Recording", **enabled** → click → **runtime RECORDING (no model-less start / no crash)** → stop clean.
- Screenshot: `mobile-private-recording.jpg`

## Console / network / Sentry summary
- **No console errors.**
- Benign warnings only: `[filler-ssot] live filler snapshot absent/malformed at save — falling back to transcript recount (diagnostic)` (short/silent take); `[updateLocalUsage] QueryClient not found, skipping optimistic update`.
- Network: `OPTIONS/PATCH sessions → 200/204` (saves OK). No 4xx/5xx.
- No Sentry error surfaced during the window.

## Download-required caveat (non-blocking)
On this deployment the **default v2 model (`whisper-base.en`) is served from `/models/`** and auto-loads to `ready`/available. Clearing CacheStorage + IndexedDB returned empty yet the engine still reached `ready`, so a **persistent `download-required` state does not occur for the default model** — the first start showed only a brief "loading / Download complete. Preparing Private model…" phase. The mic-triggers-download + `%` progress pill is **code-present and unit-tested** (`LiveRecordingCard.test.tsx`, `useSessionLifecycle.test.tsx`) but manifests only for a genuinely-uncached / remote model. This is **not the observed default production path**, so it does not block Beta-50.

**Follow-up:** build a deterministic live harness that forces the `download-required` / remote-model path (e.g., a route-intercept cache-miss or `?privateModel=<remote>`) to capture the literal download → progress → ready bar end-to-end.
