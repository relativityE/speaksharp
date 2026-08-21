import { useMemo, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { calculateTranscriptStats } from '../../utils/fillerWordUtils';
import logger from '../../lib/logger';
import { useProfile } from '../useProfile';
import { toast } from '@/lib/toast';

import { useTranscriptionState } from './useTranscriptionState';
import { useFillerWords } from './useFillerWords';
import { useTranscriptionControl } from './useTranscriptionControl';
import { useTranscriptionCallbacks } from './useTranscriptionCallbacks';
import { useVocalAnalysis } from '../useVocalAnalysis';
import { useUsageLimit } from '../useUsageLimit';
import type { UseSpeechRecognitionProps, TranscriptStats, TranscriptionPolicy, Chunk } from './types';
import type { SttStatus } from '@/types/transcription';
import { E2E_DETERMINISTIC_NATIVE, buildPolicyForUser } from './types';
import type { FillerCounts } from '../../utils/fillerWordUtils';
import { useSessionStore } from '@/stores/useSessionStore';
import { speechRuntimeController } from '../../services/SpeechRuntimeController';
import { getEffectiveSubscriptionStatus, isPro } from '@/constants/subscriptionTiers';

// Error handling helper
function handleTranscriptionError(err: Error) {
    const rawMessage = err.message || '';
    const normalized = rawMessage.trim();
    const isMicPermissionError =
        err.name === 'NotAllowedError' ||
        err.name === 'PermissionDeniedError' ||
        /permission|notallowed|mic_stream_unavailable|media devices/i.test(normalized);
    const message = normalized && normalized !== 'Error occurred'
        ? normalized
        : isMicPermissionError
            ? 'Microphone access is blocked. Allow microphone access and try again.'
            : 'Transcription could not start. Try again, or switch speech mode for this session.';
    logger.error({ err }, 'Transcription Error');
    toast.error(message, { id: 'stt-error-toast', duration: 5000 });
}

/**
 * Orchestrator Hook: useSpeechRecognition (Production)
 * Following "Strangler Fig" Pattern: Compose atomic hooks into a unified public API.
 * 
 * Responsibility: Coordinating lifecycle, state, and specialized services (VocalAnalysis, SessionTimer).
 */
export const useSpeechRecognition_prod = (props: UseSpeechRecognitionProps = {}) => {
    const userWords = useMemo(() => props.userWords || [], [props.userWords]);
    const userVocabulary = useMemo(() => props.userVocabulary || [], [props.userVocabulary]);
    const { session } = props;
    const { profile } = useProfile();
    const { data: usageLimit } = useUsageLimit();
    const navigate = useNavigate();

    // Select strictly from store (Read-Only)
    const store = useSessionStore();
    const toastIdRef = useRef<string | number | null>(null);
    const pauseMetricsSnapshotRef = useRef<string>('');
    const fillerSnapshotRef = useRef<string>('');

    // 1. Core Service Hooks (Projections)
    const stt = useTranscriptionState(); // Already refactored to read from store
    const {
        isRecording: storeIsListening,
        interimTranscript: storeInterim,
        finalChunks,
        state: runtimeState
    } = stt;

    // Mapping for backward compatibility within this hook
    const storeTranscript = { partial: storeInterim };

    // Additional store access for specialized fields not in stt hook
    const {
        isReady: storeIsReady,
        sttStatus,
        sttMode,
        modelLoadingProgress,
        elapsedTime,
    } = store;
    const effectiveSubscriptionStatus = getEffectiveSubscriptionStatus(usageLimit?.subscription_status, profile);
    const isEffectiveProUser = isPro(effectiveSubscriptionStatus);
    void sttMode;
    // Commercial state cannot widen the customer engine set. The session lifecycle's can_start result
    // remains recording authority; this compatibility hook always publishes the Private-only policy.
    const transcriptionPolicy = useMemo(
        () => buildPolicyForUser(isEffectiveProUser, 'private'),
        [isEffectiveProUser],
    );
    useTranscriptionControl();
    const fillerSourceChunks = useMemo(() => {
        const transcriptText = stt.transcriptText.trim();
        if (transcriptText) {
            return [{
                id: 'visible-transcript',
                transcript: transcriptText,
                timestamp: Date.now(),
                isFinal: true,
            }] as unknown as Chunk[];
        }

        return finalChunks as unknown as Chunk[];
    }, [finalChunks, stt.transcriptText]);
    const filler = useFillerWords(fillerSourceChunks, storeTranscript.partial, userWords);
    const vocal = useVocalAnalysis();
    // timer logic is centralized in useSessionStore.tick (driven by useSessionLifecycle)

    // 2. Specialized Callbacks (Controller Auth)

    // 3. Callback Synchronization with Authoritative Controller
    useTranscriptionCallbacks({
        onTranscriptUpdate: () => {
            // Master Invariant: SpeechRuntimeController pushes to store directly.
            // This hook and the UI it serves will react via useSessionStore reactivity.
        },
        onAudioData: vocal.processAudioFrame,
        session: session ?? null,
        navigate,
        userWords: userVocabulary,
        policy: transcriptionPolicy,
        onReady: () => {
            logger.info('[useSpeechRecognition] Service ready signal received');
        },
        onStatusChange: (status: SttStatus) => {
            if (status.type === 'error') handleTranscriptionError(new Error(status.message));
            if (status.type === 'info') toast.info(status.message);
            if (status.type === 'warning') toast.warning(status.message);
        },
        onError: handleTranscriptionError
    });

    // 4. Lifecycle Sync (Source of Truth for Vocal)
    useEffect(() => {
        vocal.setIsActive(storeIsListening);
    }, [storeIsListening, vocal]);

    useEffect(() => {
        if (vocal.micWarning) {
            toast.warning(vocal.micWarning, { id: 'mic-warning-toast', duration: 4000 });
        }
    }, [vocal.micWarning]);

    useEffect(() => {
        const nextSnapshot = JSON.stringify(filler.counts);
        if (fillerSnapshotRef.current === nextSnapshot) return;

        fillerSnapshotRef.current = nextSnapshot;
        useSessionStore.getState().updateFillerData(filler.counts);
    }, [filler.counts]);

    useEffect(() => {
        const nextSnapshot = JSON.stringify(vocal.pauseMetrics);
        if (pauseMetricsSnapshotRef.current === nextSnapshot) return;

        pauseMetricsSnapshotRef.current = nextSnapshot;
        useSessionStore.getState().setPauseMetrics(vocal.pauseMetrics);
    }, [vocal.pauseMetrics]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            // Signal the controller that this specific subscriber is gone.
            // The controller decides whether to reset based on active session state.
            speechRuntimeController.reset('subscriber_unmount');
        };
    }, []);

    // 5. Public Actions (Controller Triggers)
    const reset = useCallback(() => {
        speechRuntimeController.reset('manual_reset');
        if (toastIdRef.current) {
            toast.dismiss(toastIdRef.current);
            toastIdRef.current = null;
        }
    }, []);

    const startListening = useCallback(async (policy: TranscriptionPolicy = E2E_DETERMINISTIC_NATIVE) => {
        await speechRuntimeController.startRecording(policy);
    }, []);

    const stopListening = useCallback(async (): Promise<(TranscriptStats & { filler_words: FillerCounts }) | null> => {
        if (toastIdRef.current) toast.dismiss(toastIdRef.current);

        const result = (await speechRuntimeController.stopRecording()) as TranscriptStats | null;

        if (result) {
            return {
                ...result,
                filler_words: filler.counts,
            };
        }
        return null;
    }, [filler]);

    // 6. Derived Props (Pure Projection)
    const transcriptStats = useMemo(() => {
        return calculateTranscriptStats(
            finalChunks as unknown as Array<{ transcript: string }>,
            [], // wordConfidences expected as WordConfidence[]
            storeTranscript.partial,
            elapsedTime
        );
    }, [finalChunks, storeTranscript.partial, elapsedTime]);

    return {
        transcript: transcriptStats,
        chunks: finalChunks,
        interimTranscript: storeTranscript.partial,
        fillerData: filler.counts,
        isListening: storeIsListening,
        isReady: storeIsReady,
        error: sttStatus.type === 'error' ? new Error(sttStatus.message) : null,
        isSupported: true,
        mode: runtimeState === 'RECORDING' ? 'active' : 'idle',
        sttStatus: sttStatus,
        modelLoadingProgress: modelLoadingProgress,
        startListening,
        stopListening,
        reset,
        pauseMetrics: vocal.pauseMetrics,
        micWarning: vocal.micWarning,
        micLevel: vocal.micLevel,
        hasSpeechActivity: vocal.hasSpeechActivity,
    };
};
