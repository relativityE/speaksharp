import { useEffect, useMemo, useRef, useState } from 'react';
import {
    HERO_WAVEFORM_ENVELOPE,
    buildWaveformBars,
    waveformBarCount,
    waveformHighlightCount,
} from './heroWaveform';

const RESIZE_SETTLE_MS = 150;

/**
 * #1475 — decorative hero waveform. Hidden from assistive technology, static (no animation, so reduced-motion
 * needs no special case), and re-measured only after a resize settles.
 */
export const HeroWaveform = ({ className = '' }: { className?: string }) => {
    const trackRef = useRef<HTMLDivElement>(null);
    const [barCount, setBarCount] = useState(0);

    useEffect(() => {
        const track = trackRef.current;
        if (!track) return undefined;
        const measure = () => setBarCount(waveformBarCount(track.getBoundingClientRect().width));
        measure();
        if (typeof ResizeObserver === 'undefined') return undefined;
        let settle: ReturnType<typeof setTimeout> | undefined;
        const observer = new ResizeObserver(() => {
            clearTimeout(settle);
            settle = setTimeout(measure, RESIZE_SETTLE_MS);
        });
        observer.observe(track);
        return () => {
            clearTimeout(settle);
            observer.disconnect();
        };
    }, []);

    const bars = useMemo(() => buildWaveformBars(HERO_WAVEFORM_ENVELOPE, barCount), [barCount]);
    const highlighted = waveformHighlightCount(bars.length);

    return (
        <div
            ref={trackRef}
            aria-hidden="true"
            data-testid="hero-waveform"
            className={`flex h-[84px] w-full items-center gap-[2px] overflow-hidden ${className}`}
        >
            {bars.map((height, index) => (
                <span
                    key={index}
                    className={`block w-[2px] shrink-0 rounded-full ${index < highlighted ? 'bg-landing-signature' : 'bg-landing-rule'}`}
                    style={{ height: `${height}px` }}
                />
            ))}
        </div>
    );
};
