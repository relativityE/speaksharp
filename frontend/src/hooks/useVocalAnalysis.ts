import { useRef, useEffect, useState } from 'react';
import { PauseDetector, PauseMetrics } from '@/services/audio/pauseDetector';

export const useVocalAnalysis = () => {
    const [isActive, setIsActive] = useState(false);
    const pauseDetectorRef = useRef<PauseDetector | null>(null);
    const [micLevel, setMicLevel] = useState(0);
    const [hasSpeechActivity, setHasSpeechActivity] = useState(false);
    const [pauseMetrics, setPauseMetrics] = useState<PauseMetrics>({
        totalPauses: 0,
        averagePauseDuration: 0,
        longestPause: 0,
        pausesPerMinute: 0,
        silencePercentage: 0,
        transitionPauses: 0,
        extendedPauses: 0,
    });
    const [micWarning, setMicWarning] = useState<string | null>(null);

    const clippingFramesRef = useRef(0);
    const lowVolumeStartRef = useRef<number | null>(null);
    const lastMicLevelUpdateRef = useRef(0);
    const speechActivityTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const resetWarnings = () => {
        clippingFramesRef.current = 0;
        lowVolumeStartRef.current = null;
        setMicWarning(null);
    };

    useEffect(() => {
        if (isActive && !pauseDetectorRef.current) {
            pauseDetectorRef.current = new PauseDetector();
            lowVolumeStartRef.current = Date.now();
        }

        if (!isActive && pauseDetectorRef.current) {
            // Get final metrics before resetting
            const finalMetrics = pauseDetectorRef.current.getMetrics();
            setPauseMetrics(finalMetrics);
            pauseDetectorRef.current = null;
            resetWarnings();
            setMicLevel(0);
            setHasSpeechActivity(false);
            if (speechActivityTimeoutRef.current) {
                clearTimeout(speechActivityTimeoutRef.current);
                speechActivityTimeoutRef.current = null;
            }
        }
    }, [isActive]);

    // Update metrics every second while listening
    useEffect(() => {
        if (!isActive || !pauseDetectorRef.current) return;

        const interval = setInterval(() => {
            if (pauseDetectorRef.current) {
                setPauseMetrics(pauseDetectorRef.current.getMetrics());
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [isActive]);

    const calculateRMS = (audioData: Float32Array): number => {
        const sum = audioData.reduce((acc, val) => acc + val * val, 0);
        return Math.sqrt(sum / audioData.length);
    };

    const calculatePeak = (audioData: Float32Array): number => {
        let max = 0;
        for (let i = 0; i < audioData.length; i++) {
            const abs = Math.abs(audioData[i]);
            if (abs > max) max = abs;
        }
        return max;
    };

    const processAudioFrame = (audioData: Float32Array) => {
        if (!isActive) return;
        
        // Feed frame to pause detector
        pauseDetectorRef.current?.processAudioFrame(audioData);

        // Perform mic quality checks
        const rms = calculateRMS(audioData);
        const peak = calculatePeak(audioData);
        const now = Date.now();

        if (now - lastMicLevelUpdateRef.current >= 100) {
            const nextLevel = Math.min(rms * 8, 1);
            setMicLevel((previous) => (previous * 0.65) + (nextLevel * 0.35));
            lastMicLevelUpdateRef.current = now;
        }

        if (rms >= 0.01) {
            setHasSpeechActivity(true);
            if (speechActivityTimeoutRef.current) {
                clearTimeout(speechActivityTimeoutRef.current);
            }
            speechActivityTimeoutRef.current = setTimeout(() => {
                setHasSpeechActivity(false);
                speechActivityTimeoutRef.current = null;
            }, 1200);
        }

        // 1. Clipping Warning
        if (peak >= 0.98) {
            clippingFramesRef.current += 1;
            if (clippingFramesRef.current >= 3) {
                setMicWarning('Audio is clipping. Please speak further from the microphone.');
            }
        } else {
            clippingFramesRef.current = 0;
        }

        // 2. Low Volume Warning
        if (rms <= 0.003) {
            if (lowVolumeStartRef.current === null) {
                lowVolumeStartRef.current = now;
            } else if (now - lowVolumeStartRef.current >= 5000) {
                setMicWarning('Microphone volume too low.');
            }
        } else {
            lowVolumeStartRef.current = null;
            if (micWarning === 'Microphone volume too low.') {
                setMicWarning(null);
            }
        }

        // 3. Noise / Hum Warning
        const isPauseDetectorSilent = pauseDetectorRef.current?.isMeaningfullySilent() ?? false;
        if (isPauseDetectorSilent && rms >= 0.025) {
            setMicWarning('High background noise/hum detected.');
        } else if (micWarning === 'High background noise/hum detected.') {
            setMicWarning(null);
        }
    };

    const reset = () => {
        pauseDetectorRef.current?.reset();
        setPauseMetrics({
            totalPauses: 0,
            averagePauseDuration: 0,
            longestPause: 0,
            pausesPerMinute: 0,
            silencePercentage: 0,
            transitionPauses: 0,
            extendedPauses: 0,
        });
        resetWarnings();
        setMicLevel(0);
        setHasSpeechActivity(false);
        if (speechActivityTimeoutRef.current) {
            clearTimeout(speechActivityTimeoutRef.current);
            speechActivityTimeoutRef.current = null;
        }
    };

    return {
        pauseMetrics,
        micWarning,
        micLevel,
        hasSpeechActivity,
        processAudioFrame,
        reset,
        setIsActive
    };
};
