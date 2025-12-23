import { useState, useRef, useEffect } from 'react';

/**
 * Hook to manage session duration timer.
 * Extracted from useSpeechRecognition to follow Single Responsibility Principle.
 */
export function useSessionTimer(isListening: boolean) {
    const [duration, setDuration] = useState(0);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (isListening) {
            timerRef.current = setInterval(() => {
                setDuration(prev => prev + 1);
            }, 1000);
        } else {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
        }
        return () => {
            if (timerRef.current) {
                clearInterval(timerRef.current);
            }
        };
    }, [isListening]);

    const reset = () => {
        setDuration(0);
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
    };

    return { duration, reset };
}
