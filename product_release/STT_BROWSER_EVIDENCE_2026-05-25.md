# STT Browser Evidence - 2026-05-25

This evidence was captured against local `4173` using Chrome CDP on `9222`, real backend mode (`VITE_SKIP_MSW=true`, `VITE_USE_LIVE_DB=true`), and macOS `say` as the synthetic speaker.

Signed-in account:

- `stt-browser-proof-1779702930@speaksharp.app`
- Profile displayed as Pro.
- Private and Cloud mode options were enabled after switching away from the stale browser account.

Input phrase:

> um the stale smell of old beer like lingers. uh a dash of pepper spoils beef stew. like the box was thrown beside the parked truck.

## Summary

| Mode | Artifact | First Visible Text | Final/Before-Stop Transcript | Console Errors | Page Exceptions | Network Failures | Verdict |
|---|---|---:|---|---:|---:|---:|---|
| Private | `/private/tmp/speaksharp-private-say-trace-1779704296945.json` | `9.783s` | `on the stale smell of old beer like lingers out of dash of pepper spoils beef stew like the box was thrown beside the park` | 0 | 0 | 0 | Functional, but latency remains above the `<6s` synthetic target. |
| Native Browser | `/private/tmp/speaksharp-native-say-trace-1779704244115.json` | `8.655s` | `on the` | 0 | 0 | 0 | Not green. Chrome produced only a weak partial despite clean mic capture. |
| Cloud | `/private/tmp/speaksharp-cloud-say-trace-1779704015373.json` | `9.670s` | `On the stale smell of old beer like lingers a dhash of pepper spoils beef stew like the box was thrown beside the park truck.` | 0 | 0 | 0 | Provider path works: token fetch and AssemblyAI websocket opened. Synthetic timing still slow. |

## Findings

1. The earlier Cloud failure was a test-account precondition, not an AssemblyAI/provider failure.
   - The browser was still signed in as `v4journey.1779641988398@speaksharp.app`.
   - That account showed a Pro badge but did not expose Cloud entitlement in the UI.
   - After signing in as the workflow-created Pro cloud-entitled account, Cloud mode became selectable and the token/websocket path worked.

2. Native Browser STT remains the weakest current STT path.
   - Latest artifact has no console errors after reclassifying recoverable `no-speech` as a warning/trace event.
   - The transcript result is still not useful: only `on the`.
   - Native remains RC-red until a real Chrome pass produces coherent transcript evidence or the product labels Native as browser-dependent/experimental.

3. Private STT is technically stable but still slow with synthetic `say`.
   - Latest artifact has no console errors, page exceptions, or network failures.
   - Transcript is recognizable and mostly tracks the input phrase.
   - First visible text at `9.783s` does not meet the `<6s` target.
   - This is not enough to close the Private timing gate; it does support the need for the Private UX bridge/copy and a real human voice pass.

4. The STT trace harness was hardened during this pass.
   - Failure artifacts now include phase, URL, DOM state, disabled mode state, console logs, page exceptions, failed requests, and engine traces.
   - AssemblyAI websocket tokens are redacted in captured URLs.

## Gate Impact

- Gate 1 / Product Truth: still not fully green because Native is red and Private synthetic first text is late.
- Gate 3 / DAST Running App: Cloud provider path is no longer blocked by AssemblyAI token failure when using a Pro cloud-entitled account.
- Gate 5 / UX Smoke: mode labels and disabled Private explanation are improved, but full tester journey is still open.

## Next Required Evidence

1. Real human Private pass:
   - Target: chunk 0 RMS `>= 0.05`, first partial `<6s`, recognizable words.
   - Purpose: distinguish synthetic `say` latency from real microphone user experience.

2. Real human Native pass:
   - Target: coherent words from the spoken phrase, no repetition, no unrecovered `onerror`.
   - Purpose: decide whether Native can be recommended for Chrome/Edge or must be downgraded.

3. Analytics usefulness pass:
   - Use the clean Cloud transcript path as baseline.
   - Verify filler counts, WPM, clarity explanation, and user-actionable guidance.
