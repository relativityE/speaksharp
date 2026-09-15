import { useEffect, useMemo, useRef, useState } from 'react';
import {
    waveformHighlightCount,
    waveformLineCount,
    waveformLineHeights,
    waveformTrackHeight,
} from './heroWaveform';

const RESIZE_DEBOUNCE_MS = 100;

/**
 * #1475 G12 Rev 2 §4 — the decorative hero waveform. Lines are 2px and never flex; the track spreads the leftover
 * width into gaps and mirrors lines around its centre axis. Static (no animated variant) and hidden from assistive
 * technology. On resize the line count is recomputed and the envelope regenerated with the same seed.
 */
export const HeroWaveform = ({ className = '' }: { className?: string }) => {
    const trackRef = useRef<HTMLDivElement>(null);
    const [geometry, setGeometry] = useState({ lineCount: 0, trackHeight: waveformTrackHeight(Number.POSITIVE_INFINITY) });

    useEffect(() => {
        const track = trackRef.current;
        if (!track) return undefined;
        const measure = () => setGeometry({
            lineCount: waveformLineCount(track.getBoundingClientRect().width),
            trackHeight: waveformTrackHeight(typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerWidth),
        });
        measure();
        if (typeof ResizeObserver === 'undefined') return undefined;
        let debounce: ReturnType<typeof setTimeout> | undefined;
        const observer = new ResizeObserver(() => {
            clearTimeout(debounce);
            debounce = setTimeout(measure, RESIZE_DEBOUNCE_MS);
        });
        observer.observe(track);
        return () => {
            clearTimeout(debounce);
            observer.disconnect();
        };
    }, []);

    const heights = useMemo(
        () => waveformLineHeights(geometry.lineCount, geometry.trackHeight),
        [geometry.lineCount, geometry.trackHeight],
    );
    const highlighted = waveformHighlightCount(heights.length);

    return (
        <div
            ref={trackRef}
            aria-hidden="true"
            data-testid="hero-waveform"
            className={`flex w-full items-center justify-between overflow-hidden ${className}`}
            style={{ height: `${geometry.trackHeight}px` }}
        >
            {heights.map((height, index) => (
                <span
                    key={index}
                    className={`block w-[2px] shrink-0 rounded-[1px] ${index < highlighted ? 'bg-landing-signature' : 'bg-landing-ink-hairline'}`}
                    style={{ height: `${height}px` }}
                />
            ))}
        </div>
    );
};
