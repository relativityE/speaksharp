**Owner:** [unassigned]
**Last Reviewed:** 2026-05-06
**Version:** v0.6.18 
**Last Updated:** 2026-05-07

# Manual Hardware Validation Checklist

CI does not validate real microphone hardware. Complete this checklist before launch. Use real devices, real browser permissions, and a real authenticated user.

## Desktop Chrome

- [ ] Grant mic permission.
- [ ] Deny mic permission and verify error UX.
- [ ] Start Native STT session.
- [ ] Stop session.
- [ ] Save session.
- [ ] Refresh during recording.
- [ ] Switch STT mode only via explicit user action.
- [ ] Start Private STT with WebGPU available.
- [ ] If model is missing, verify explicit download/progress/ready flow.
- [ ] Verify cached model is reused on second Private STT start.

## Desktop Safari

- [ ] Grant mic permission.
- [ ] Start/stop session.
- [ ] Verify no crash on AudioContext initialization.
- [ ] Verify fallback messaging.

## Firefox

- [ ] Grant mic permission.
- [ ] Start/stop session.
- [ ] Verify browser compatibility messaging if unsupported.

## iPhone Safari

- [ ] Open app.
- [ ] Auth flow works.
- [ ] Mic permission prompt appears.
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
If any check fails:
1. Capture screen recording.
2. Export `TranscriptionService` debug logs from console.
3. Note specific hardware (e.g., "AirPods Pro Gen 2", "MacBook Pro M3").
