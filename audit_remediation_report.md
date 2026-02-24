# SpeakSharp v3.5.0 Audit Remediation Report

## 1. STT Engine Layer: CloudAssemblyAI Correctness
### Findings:
- **Data Loss on Stop:** `CloudAssemblyAI.ts` was returning an empty string in `stopTranscription()` and `getTranscript()`. While the UI largely uses incremental callbacks, the `TranscriptionService.stopTranscription()` method relies on the return value for final statistics and the terminal transcript.
- **Diarization Gap:** The engine was not requesting speaker labels (`speaker_labels=true`), and although the `TranscriptUpdate` type supported a `speaker` field, the engine was not populating it.

### Remediation:
- Implemented `transcript` accumulation within `CloudAssemblyAI.ts`.
- Enabled `speaker_labels=true` in the WebSocket URL.
- Correctly parsed the `speaker` field from AssemblyAI `FinalTranscript` messages.
- Verified fix with `TranscriptionAccuracy.integration.test.ts`.

---

## 2. FSM State Integrity: Atomic State Lock
### Findings:
- **Race Condition:** `TranscriptionService.startTranscription()` did not check for the `CLEANING_UP` state. Rapidly clicking start/stop could lead to two overlapping transcription sessions, especially with slow-destroying engines like Whisper (WASM).
- **Redundant Init:** The service was calling `engine.init()` multiple times (both in `startTranscription` and `executeEngine`), increasing startup latency.

### Remediation:
- Added a guard in `startTranscription` to reject requests if the FSM is in `CLEANING_UP`.
- Hardened `TranscriptionFSM` to remove the transition from `CLEANING_UP` to `TERMINATED` (standardizing on `IDLE` after cleanup).
- Refactored `executeEngine` to respect a `skipInit` flag, eliminating redundant calls.
- Added a unit test in `TranscriptionService.test.ts` to assert rejection during cleanup.

---

## 3. Tier Limit Enforcement & Security
### Findings:
- **Server-Side Bypass:** A recent database hardening migration (v20260212) accidentally removed the limit enforcement logic and monthly reset from the `update_user_usage` RPC.
- **Magic Numbers:** Backend limits (1800s) were out of sync with frontend constants (3600s).

### Remediation:
- Created migration `20260213000000_restore_tier_limits.sql`.
- Restored monthly reset logic (calculated at runtime during usage update).
- Implemented **Atomic Row Locking** using `SELECT ... FOR UPDATE` to prevent concurrent usage bypass.
- Synchronized limit to 3600 seconds (1 hour) to match `subscriptionTiers.ts`.
- Updated `check_usage_limit` RPC for consistency.

---

## 4. Performance & Data Correctness
### Findings:
- **Missing Index:** Paginated session history queries (`.eq('user_id', userId).order('created_at', 'desc')`) lacked a composite index, leading to O(N) scans.
- **Accuracy Inversion Risk:** WER ratios (0.0-1.0) were being converted to accuracy but lacked rounding, leading to inconsistent UI displays (e.g., 99.9999% vs 100%).

### Remediation:
- Added composite index `sessions(user_id, created_at DESC)` via migration.
- Updated `analyticsUtils.ts` to use `Math.round()` for accuracy percentages.
- Hardened `wer.test.ts` to verify 1D DP robustness for long transcripts.

---

## 5. Security & Edge Function Hardening
### Findings:
- **Open Redirect Risk:** The `stripe-checkout` function was parsing the request body, which could potentially be abused to inject a `returnUrlOrigin` override (though the code used a fallback to `SITE_URL`, removing the client-controlled parsing is safer).

### Remediation:
- Removed `req.json()` parsing from `stripe-checkout/index.ts`.
- Standardized on `SITE_URL` secret exclusively for URL construction.

---

## 6. Word Error Rate (WER) Robustness
### Findings:
- **Empty Reference Bug:** Calculation returned incorrect values when the reference string was empty.

### Remediation:
- Fixed `wer.ts` early exit to return `0` for empty/empty strings and `1.0` for empty-reference/non-empty-hypothesis strings.

---

## Design Trade-offs & Implementation Decisions

### Choice of Atomic Row Locking (`FOR UPDATE`)
- **Trade-off:** Using `FOR UPDATE` in the `update_user_usage` function ensures that if a user starts multiple sessions simultaneously, their usage is serialized.
- **Risk:** Slight increase in lock contention.
- **Decision:** Given that usage updates are per-user, contention will only occur if the same user performs rapid concurrent actions. This is an acceptable trade-off for system integrity (preventing free tier bypass).

### Reject vs. Queue (FSM Lock)
- **Trade-off:** When a user requests a start during cleanup, we currently **reject** and log a warning.
- **Alternative:** We could queue the request.
- **Decision:** Rejection is safer and simpler. Queuing introduces complexity regarding "user intent" (if they click start then cancel before cleanup finishes). Rejection allows the UI to stay in sync with the actual hardware state.

### Multi-Engine Integration Testing
- **Implementation:** Added `TranscriptionAccuracy.integration.test.ts`.
- **Trade-off:** It uses a `MockEngine` via `TestRegistry` rather than real WASM engines.
- **Decision:** This is necessary for CI stability. Real WASM engines are tested in the "Live" suite (`stt-integration.live.spec.ts`), while the integration test verifies the **data pipeline** (that `TranscriptionService` correctly captures what the engine emits).
