**Owner:** [unassigned]
**Last Reviewed:** 2026-05-06
**Version:** v0.6.18 
**Last Updated:** 2026-05-10

# Manual Hardware Validation Checklist

CI does not validate real microphone hardware. Complete this checklist before launch. Use real devices, real browser permissions, and a real authenticated user.

## Desktop Chrome

- [ ] Grant mic permission.
- [ ] Deny mic permission and verify error UX.
- [ ] Login as Pro, select Native Browser STT, grant mic, speak a clear 10-15 second sentence, and confirm non-placeholder transcript text appears live.
- [ ] Record the exact browser/version and the sentence spoken.
- [ ] Stop Native session and confirm the UI returns to the ready/start state.
- [ ] Save Native session and record the visible success/status text.
- [ ] Confirm Native session history appears after reload.
- [ ] Confirm Native analytics changed from baseline after save.
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

If any check fails:
1. Capture screen recording.
2. Export `TranscriptionService` debug logs from console.
3. Note specific hardware (e.g., "AirPods Pro Gen 2", "MacBook Pro M3").
