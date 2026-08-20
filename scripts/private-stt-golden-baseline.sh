#!/usr/bin/env bash
# Private-STT golden baseline (#1314 → Cloud/Native cleanup precondition).
#
# Proves the Private path is intact BEFORE and AFTER every Cloud/Native deletion slice:
# setup/record/stop/finalize/save/recovery/review, metrics + filler consistency + banner
# lifecycle, Private engine-selection authority, and the Private engine internals. Zero
# Cloud/AssemblyAI/Web-Speech network requests are additionally proven by the deployed
# live zero-cloud gate (later acceptance), and locally by the selection-authority tests
# below (Private is the only constructable production engine).
#
# Usage: bash scripts/private-stt-golden-baseline.sh
# Rule:  run at the pre-deletion SHA to FREEZE the baseline, then rerun after each slice.
#        Any Private regression STOPS and REVERTS that slice.
set -euo pipefail

FILES=(
  frontend/src/services/__tests__/SpeechRuntimeController.test.ts
  frontend/src/services/__tests__/SpeechRuntimeController.finalizeTimeout.test.ts
  frontend/src/services/__tests__/SpeechRuntimeController.finalizeBannerLifecycle.test.ts
  frontend/src/services/__tests__/SpeechRuntimeController.statetruth.test.ts
  frontend/src/services/__tests__/SpeechRuntimeController.idleReclamation.test.ts
  frontend/src/services/__tests__/SpeechRuntimeController.objectiveGate.test.ts
  frontend/src/services/__tests__/SpeechRuntimeController.progressRetryGate.test.ts
  frontend/src/services/__tests__/SpeechRuntimeController.fillerDivergence.test.ts
  frontend/src/services/transcription/__tests__/EngineFactory.test.ts
  frontend/src/services/transcription/__tests__/STTStrategyFactory.realEngine.test.ts
  frontend/src/services/transcription/__tests__/STTRegistry.test.ts
  frontend/src/services/transcription/__tests__/SttSafeguards.test.ts
  frontend/src/services/transcription/__tests__/TranscriptionPolicy.test.ts
  frontend/src/services/transcription/__tests__/TranscriptionPolicy.callers.characterization.test.ts
  frontend/src/services/transcription/__tests__/sttIdentity.test.ts
  frontend/src/services/transcription/__tests__/TranscriptionAccuracy.integration.test.ts
  frontend/src/services/transcription/__tests__/TranscriptionService.test.ts
  frontend/src/services/transcription/__tests__/TranscriptionService.heartbeat.test.ts
  frontend/src/services/transcription/__tests__/TranscriptionService.maxAttempts.test.ts
  frontend/src/services/transcription/__tests__/TranscriptionService.pause.test.ts
  frontend/src/services/transcription/__tests__/TranscriptionService.race.test.ts
  frontend/src/services/transcription/__tests__/TranscriptionService.startError.test.ts
  frontend/src/services/transcription/__tests__/TranscriptionService.zombie.test.ts
  frontend/src/services/transcription/engines/__tests__/PrivateSTT.test.ts
  frontend/src/services/transcription/engines/__tests__/PrivateSTT.v4DecodeFallback.test.ts
  frontend/src/services/transcription/engines/__tests__/TransformersJSEngine.test.ts
  frontend/src/services/transcription/engines/__tests__/TransformersJSEngine.worker.test.ts
  frontend/src/services/transcription/engines/__tests__/TransformersJSV4Engine.worker.test.ts
  frontend/src/services/transcription/engines/__tests__/progressAggregator.test.ts
  frontend/src/services/transcription/engines/__tests__/whisperDecodeOptions.test.ts
  frontend/src/hooks/__tests__/useSessionLifecycle.test.tsx
  frontend/src/hooks/__tests__/useSessionLifecycle.foregroundReload.test.ts
  frontend/src/hooks/__tests__/useSessionLifecycle.reclamationIntegration.test.tsx
  frontend/src/hooks/__tests__/useUnresolvedRecovery.integration.test.tsx
  frontend/src/hooks/useSpeechRecognition/__tests__/integration.test.tsx
  frontend/src/hooks/useSpeechRecognition/__tests__/useTranscriptionService.test.ts
  frontend/src/hooks/useSpeechRecognition/__tests__/useTranscriptionService.component.test.tsx
  frontend/src/utils/__tests__/sessionAnalysis.test.ts
  frontend/src/utils/__tests__/finalizedSessionAnalysis.test.ts
  frontend/src/utils/__tests__/fillerTiers.test.ts
  frontend/src/utils/__tests__/fillerWordUtils.test.ts
  frontend/src/utils/__tests__/fillerBoundary.test.ts
  frontend/src/components/session/__tests__/SessionOverhaulView.test.tsx
)

# Only run files that still exist (a slice may legitimately delete a retired-mode test).
EXISTING=()
for f in "${FILES[@]}"; do [ -f "$f" ] && EXISTING+=("$f"); done

echo "[golden-baseline] SHA=$(git rev-parse HEAD)  files=${#EXISTING[@]}/${#FILES[@]}"
CI=true pnpm exec vitest run --config frontend/vitest.config.mjs --coverage.enabled=false "${EXISTING[@]}"
