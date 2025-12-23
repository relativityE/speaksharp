import { useRef, useEffect, useState } from 'react';
import { PauseDetector, PauseMetrics } from '@/services/audio/pauseDetector';

export const useVocalAnalysis = (isListening: boolean) => {
    const pauseDetectorRef = useRef<PauseDetector | null>(null);
    const [pauseMetrics, setPauseMetrics] = useState<PauseMetrics>({
        totalPauses: 0,
        averagePauseDuration: 0,
        longestPause: 0,
        pausesPerMinute: 0,
    });

    useEffect(() => {
        if (isListening && !pauseDetectorRef.current) {
            pauseDetectorRef.current = new PauseDetector();
        }

        if (!isListening && pauseDetectorRef.current) {
            // Get final metrics before resetting
            const finalMetrics = pauseDetectorRef.current.getMetrics();
            setPauseMetrics(finalMetrics);
            pauseDetectorRef.current = null;
        }
    }, [isListening]);

    // Update metrics every second while listening
    useEffect(() => {
        if (!isListening || !pauseDetectorRef.current) return;

        const interval = setInterval(() => {
            if (pauseDetectorRef.current) {
                setPauseMetrics(pauseDetectorRef.current.getMetrics());
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [isListening]);

    const processAudioFrame = (audioData: Float32Array) => {
        pauseDetectorRef.current?.processAudioFrame(audioData);
    };

    const reset = () => {
        pauseDetectorRef.current?.reset();
        setPauseMetrics({
            totalPauses: 0,
            averagePauseDuration: 0,
            longestPause: 0,
            pausesPerMinute: 0,
        });
    };

    return {
        pauseMetrics,
        processAudioFrame,
        reset,
    };
};
