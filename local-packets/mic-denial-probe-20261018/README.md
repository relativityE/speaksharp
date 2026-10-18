# Case 12a: microphone-denial harness validity (18 October 2026)

Source baseline: `7163f00d9c1b3fac36fd8cc13afd476b69f4ec0a`, the interrupted case-12 run's checkout. The probe imports `rwtLaunchArgs(loadRwtFixture('open_mic_tts'), { webgpu: false })`, matching the RWT fixture's pinned Chromium fake-media launch flags and audio file. It serves a blank page from `127.0.0.1` and calls the browser's actual `navigator.mediaDevices.getUserMedia({ audio: true })`. No SpeakSharp page, Production origin, account, credential, database, or RWT dispatch is involved.

Run from this worktree:

```text
node scripts/host-interlock.mjs hold local -- pnpm exec tsx tests/offline/mic-denial-permission-probe.mts
```

The committed [results.json](results.json) is the full requested/queried/effective matrix from macOS (`darwin`), Chromium `143.0.7499.4`, Node `v22.12.0`. The final run exited 0. Key controls:

| Launch and request | Permission query after request | Actual acquisition |
| --- | --- | --- |
| Pinned flags; context grants mic; no CDP change | `granted` | resolved, one live audio track |
| Pinned flags; context grants mic; CDP requests `denied`, then session detaches as current helper does | `prompt` | resolved, one live audio track |
| Pinned flags; context grants mic; CDP requests `denied`, session remains attached | `denied` | resolved, one live audio track |
| Pinned flags; no context grant; CDP requests `denied`, session remains attached | `denied` | resolved, one live audio track |
| Replace fake UI flag with `--use-fake-ui-for-media-stream=deny`; CDP `denied` and session held | `denied` | rejected `NotAllowedError` |
| Same `=deny` flag; CDP `granted` and session held | `granted` | rejected `NotAllowedError` |
| Same `=deny` flag; context grant, no CDP change | `granted` | rejected `NotAllowedError` |
| Remove fake UI; fake device with or without the pinned capture file | `granted`, `prompt`, or `denied` depending on CDP | rejected `NotSupportedError` on this Mac |

The current `setSiteMicrophone` helper detaches its browser CDP session immediately after `Browser.setPermission`. In this local Chromium run the query stopped reporting `denied` after detach. Even while the session was held and the query reported `denied`, the pinned fake UI made `getUserMedia` return a live track. The query alone therefore cannot validate case 12a's denied-microphone path; the live run's recording telemetry cannot establish a product permission bypass.

The explicit `=deny` fake-UI control produced a real `NotAllowedError` locally. Removing fake UI produced `NotSupportedError` here even on granted controls, so that route needs its own Linux-CI validation before use. App should make the denied variant's effective acquisition outcome observable and fail closed unless it actually rejects with `NotAllowedError`; if using CDP, hold the session through that acquisition. This packet tests the harness only. It does not establish what happened in the original Production browser, and it does not fix or qualify the 15-case campaign.
