**Owner:** [unassigned]
**Last Reviewed:** 2026-05-06
**Version:** v0.6.18 
**Last Updated:** 2026-05-06

# 🎙️ Manual Hardware Validation Checklist

CI validates the logic; this checklist validates the **Reality**. This MUST be completed on real devices before the launch window closes.

## 1. Desktop Browser Matrix
Test on: Chrome (latest), Safari (latest), Firefox (latest).

- [ ] **Mic Permission**: Verify the browser "Allow" prompt appears and session starts only after consent.
- [ ] **Hardware Mute**: Verify that clicking the physical "Mute" button on the mic/laptop doesn't crash the FSM (should just stop getting audio pulses).
- [ ] **Bluetooth Switch**: While recording, disconnect Bluetooth headphones. Verify system switches to default mic or errors gracefully (no silent hangs).
- [ ] **Private STT (WebGPU)**: Verify the "Download Required" modal appears on Chrome. Verify successful download and "Model Ready" toast.

## 2. Mobile Browser Matrix (The High-Risk Zone)
Test on: iOS Safari (mandatory), Android Chrome.

- [ ] **Audio Session Interruption**: While recording, trigger a phone call. Verify the session pauses or stops gracefully when audio focus is lost.
- [ ] **Backgrounding**: Start recording, then switch apps. Verify if audio continues (if intended) or stops without corrupting the session.
- [ ] **Low Power Mode**: Verify transcription performance doesn't lag significantly under CPU throttling.
- [ ] **Mobile RAM**: Verify `PrivateSTT` (TransformersJS) doesn't crash the tab on iOS Safari (limited RAM).

## 3. UI Stress Tests (Headed)
- [ ] **Rapid Start/Stop**: Click "Start" and "Stop" repeatedly (10x). Verify no "Identity Hijack" or overlapping session timers.
- [ ] **Tab Sleep**: Leave an active recording tab backgrounded for 2 minutes. Return and verify it is still recording or has timed out correctly.
- [ ] **Network Disconnect**: While recording with Cloud STT, disable WiFi. Verify "Connection Lost" toast and successful reconnect logic.

## 4. Hardware Evidence Logs
If any check fails:
1. Capture screen recording.
2. Export `TranscriptionService` debug logs from console.
3. Note specific hardware (e.g., "AirPods Pro Gen 2", "MacBook Pro M3").
