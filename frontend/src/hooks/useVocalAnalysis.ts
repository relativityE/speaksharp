import { useRef, useEffect, useState } from 'react';
import { PauseDetector, PauseMetrics } from '@/services/audio/pauseDetector';

export const useVocalAnalysis = () => {
    const [isActive, setIsActive] = useState(false);
    const pauseDetectorRef = useRef<PauseDetector | null>(null);
    const [pauseMetrics, setPauseMetrics] = useState<PauseMetrics>({
        totalPauses: 0,
        averagePauseDuration: 0,
        longestPause: 0,
        pausesPerMinute: 0,
        silencePercentage: 0,
        transitionPauses: 0,
        extendedPauses: 0,
    });

    useEffect(() => {
        if (isActive && !pauseDetectorRef.current) {
            pauseDetectorRef.current = new PauseDetector();
        }

        if (!isActive && pauseDetectorRef.current) {
            // Get final metrics before resetting
            const finalMetrics = pauseDetectorRef.current.getMetrics();
            setPauseMetrics(finalMetrics);
            pauseDetectorRef.current = null;
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

    const processAudioFrame = (audioData: Float32Array) => {
        if (!isActive) return;
        pauseDetectorRef.current?.processAudioFrame(audioData);
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
    };

    return {
        pauseMetrics,
        processAudioFrame,
        reset,
        setIsActive
    };
};
