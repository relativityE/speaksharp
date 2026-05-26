**Owner:** [unassigned]
**Last Reviewed:** 2026-05-26
**Version:** v0.6.19-rc0
**Last Updated:** 2026-05-26

# Manual Hardware Validation Checklist

> Manual validation checklist, not release status.
> Current ship posture, blockers, and latest run IDs live only in `RELEASE_STATUS.md`.

CI does not validate real microphone hardware. Complete this checklist before launch. Use real devices, real browser permissions, and a real authenticated user.

## Desktop Chrome

- [x] Grant mic permission.
- [ ] Deny mic permission and verify error UX.
- [x] Login as Pro, select Native Browser STT, grant mic, speak a clear 10-15 second sentence, and confirm non-placeholder transcript text appears live.
- [x] Record the exact browser/version and the sentence spoken.
- [x] Stop Native session and confirm the UI returns to the ready/start state.
- [x] Save Native session and record the visible success/status text.
- [x] Confirm Native session history appears after reload.
- [x] Confirm Native analytics changed from baseline after save.
- [ ] Refresh during recording.
- [ ] Switch STT mode only via explicit user action.
- [ ] Start Private STT through the launch-default CPU/Transformers.js path.
- [ ] If model assets/cache are missing, verify explicit setup/download/progress/ready flow.
- [ ] Verify cached model is reused on second Private STT start.
- [ ] Separately enable/force the WebGPU/WhisperTurbo accelerated path on supported hardware and verify it either starts quickly or fails fast to an explicit recovery state.

## Desktop Safari

- [ ] Grant mic permission.
- [ ] Login as Pro, select Native, and verify whether browser speech recognition is supported.
- [ ] If supported, speak for 10-15 seconds and confirm transcript appears live.
- [ ] Stop/save session and confirm history/analytics update.
- [ ] Verify no crash on AudioContext initialization.
- [ ] If unsupported or unreliable, document the browser support limitation and verify fallback messaging.

## Firefox

- [ ] Grant mic permission.
- [ ] Start/stop session.
- [ ] Verify browser compatibility messaging if unsupported.

## iPhone Safari

- [ ] Open app.
- [ ] Auth flow works.
- [ ] Mic permission prompt appears.
- [ ] Optional for launch: verify Native transcript if browser speech recognition is supported.
- [ ] If STT unsupported, UX explains limitation.
- [ ] Background app during recording and verify recoverable stop/pause behavior.

## Bluetooth / External Mic

- [ ] Start with built-in mic.
- [ ] Start with external mic.
- [ ] Disconnect external mic mid-session.
- [ ] Verify recoverable error behavior.

## Stress / Degraded Conditions

- [ ] Rapid start/stop 10 times; verify no overlapping timers or duplicate active sessions.
- [ ] Leave active recording tab backgrounded for 2 minutes; verify expected recording or timeout behavior.
- [ ] Disable WiFi during Cloud STT; verify connection-loss messaging and recovery/failure path.
- [ ] Trigger hardware mute during recording; verify no crash or unrecoverable FSM state.

## Hardware Evidence Logs
Native Browser STT launch proof must come from real Chrome microphone behavior. GitHub Chromium fake-audio only counts as readiness/no-crash/save diagnostics because Web Speech transcript production is browser/vendor dependent.

2026-05-12 Chrome production proof:

- Browser: Google Chrome via Playwright `channel=chrome`, headed.
- Mic path: real browser `getUserMedia`, no fake audio flags.
- Account: fresh trial sign-up `native-proof-1778546140280@example.com`.
- Spoken sentence attempted: `Native Chrome microphone proof. The quick brown fox reads clear speech for SpeakSharp release validation.`
- Live transcript: non-placeholder transcript appeared from the real mic path; captured sample was ambient speech rather than the scripted sentence, so `transcriptMatchesScript=false`.
- Stop/save/history/analytics: all true.
- Evidence file: `/private/tmp/native-chrome-proof.json`.

If any check fails:
1. Capture screen recording.
2. Export `TranscriptionService` debug logs from console.
3. Note specific hardware (e.g., "AirPods Pro Gen 2", "MacBook Pro M3").
