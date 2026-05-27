import { useLayoutEffect, useRef, useState } from 'react';

export function useChartContainerReady() {
    const ref = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });

    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) return;

        const updateReadyState = () => {
            const rect = element.getBoundingClientRect();
            setSize({
                width: Math.max(0, Math.floor(rect.width)),
                height: Math.max(0, Math.floor(rect.height)),
            });
        };

        updateReadyState();

        if (typeof ResizeObserver === 'undefined') {
            const frame = window.requestAnimationFrame(updateReadyState);
            return () => window.cancelAnimationFrame(frame);
        }

        const observer = new ResizeObserver(updateReadyState);
        observer.observe(element);

        return () => observer.disconnect();
    }, []);

    return {
        ref,
        isReady: size.width > 0 && size.height > 0,
        size,
    };
}
