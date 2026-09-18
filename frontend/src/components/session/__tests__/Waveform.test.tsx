import { render, screen, cleanup } from '../../../../tests/support/test-utils';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Waveform } from '../Waveform';

/**
 * S-9 / `RECORDER_SPEC` §2 — the geometry that decides whether this reads as speech or as a fake.
 *
 * The previous implementation broke both load-bearing rules: `flex: 1; min-width: 2px` (so the lines grew
 * to ~5px blocks with 2px gaps — lines wider than their gaps) and a hardcoded ~72 bars (so the rendered
 * line-to-gap ratio became a function of container width). Both are asserted here as casualties.
 *
 * jsdom has no layout, so the track's width is stubbed; the arithmetic itself is proven in
 * `waveformGeometry.test.ts`.
 */

/** A speech-shaped envelope: bursts, word-boundary dips, and two phrase pauses at the floor. */
const envelope = (n: number): number[] => Array.from({ length: n }, (_, i) => {
    if (i % 17 === 0 || i % 17 === 1) return 0.03;          // phrase pause
    const phase = (i % 9) / 9;
    return Math.max(0.05, Math.sin(phase * Math.PI) * 0.85);
});

const TRACK_WIDTH = 480;   // → floor(480 / 4) = 120 lines

function stubTrackWidth(width: number) {
    return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        return { width, height: 34, top: 0, left: 0, right: width, bottom: 34, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
}

describe('Waveform — geometry (S-9)', () => {
    let rect: ReturnType<typeof stubTrackWidth>;
    beforeEach(() => { rect = stubTrackWidth(TRACK_WIDTH); });
    afterEach(() => { rect.mockRestore(); cleanup(); });

    it('CASUALTY: every line is exactly 2px and never grows — no `flex: 1`', () => {
        render(<Waveform amplitudes={envelope(200)} recordedCount={40} />);
        const lines = screen.getAllByTestId('waveform-line');
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines.slice(0, 20)) {
            expect(line.style.width).toBe('2px');
            expect(line.style.flexShrink).toBe('0');
            // The defect: any flex-grow at all means the lines fill the track and the gaps collapse.
            expect(line.style.flex).toBe('');
            expect(line.style.flexGrow).toBe('');
            expect(line.style.minWidth).toBe('');
        }
    });

    it('CASUALTY: the count comes from the track width, not a hardcoded number', () => {
        render(<Waveform amplitudes={envelope(400)} recordedCount={10} />);
        // floor(480 / 4) = 120 — not 72, not 76, not any constant.
        expect(screen.getAllByTestId('waveform-line')).toHaveLength(120);
        expect(screen.getByTestId('waveform')).toHaveAttribute('data-line-count', '120');
    });

    it('a narrower track renders proportionally fewer lines', () => {
        rect.mockRestore();
        rect = stubTrackWidth(320);
        render(<Waveform amplitudes={envelope(400)} recordedCount={10} />);
        expect(screen.getAllByTestId('waveform-line')).toHaveLength(80);   // floor(320 / 4)
    });

    it('never pads with invented levels: fewer samples than the track allows renders only what exists', () => {
        render(<Waveform amplitudes={envelope(30)} recordedCount={5} />);
        expect(screen.getAllByTestId('waveform-line')).toHaveLength(30);
    });

    it('the track is centre-mirrored and distributes its leftover space as gap', () => {
        render(<Waveform amplitudes={envelope(120)} recordedCount={10} />);
        const track = screen.getByTestId('waveform');
        expect(track.style.alignItems).toBe('center');          // not flex-end: a baseline is a bar chart
        expect(track.style.justifyContent).toBe('space-between');
        expect(track.style.gap).toBe('');                       // the spare space IS the gap
    });

    it('silence stays visible: a floor-amplitude line is 2px, not a gap', () => {
        render(<Waveform amplitudes={[0, 0.5]} recordedCount={2} height={34} />);
        const lines = screen.getAllByTestId('waveform-line');
        expect(lines[0].style.height).toBe('2px');
        expect(lines[1].style.height).toBe('17px');             // round(0.5 * 34)
    });

    it('is decorative: hidden from assistive tech', () => {
        render(<Waveform amplitudes={envelope(40)} recordedCount={4} />);
        expect(screen.getByTestId('waveform')).toHaveAttribute('aria-hidden', 'true');
    });
});

describe('Waveform — colour is a separate lookup from height (S-9)', () => {
    let rect: ReturnType<typeof stubTrackWidth>;
    beforeEach(() => { rect = stubTrackWidth(TRACK_WIDTH); });
    afterEach(() => { rect.mockRestore(); cleanup(); });

    it('during: recorded lines take the signature, the tail takes the one inactive grey', () => {
        render(<Waveform amplitudes={envelope(120)} recordedCount={40} />);
        const lines = screen.getAllByTestId('waveform-line');
        expect(lines.filter((l) => l.getAttribute('data-recorded') === 'true')).toHaveLength(40);
        expect(lines[0].style.backgroundColor).toBe('var(--brand-signature)');
        // The data role, NOT a border token that happens to hold the same value.
        expect(lines[119].style.backgroundColor).toBe('var(--brand-metric-inactive)');
    });

    it('after: the whole shape is the inactive grey, with filler positions overriding colour AND height', () => {
        render(<Waveform amplitudes={envelope(120)} fillerBars={[3, 60]} height={34} />);
        const lines = screen.getAllByTestId('waveform-line');
        expect(lines[3]).toHaveAttribute('data-filler', 'true');
        expect(lines[3].style.backgroundColor).toBe('var(--brand-signature)');
        expect(lines[3].style.height).toBe('34px');             // full-height override, unmissable
        expect(lines[4].getAttribute('data-filler')).toBeNull();
        expect(lines[4].style.backgroundColor).toBe('var(--brand-metric-inactive)');
        // No played/unplayed split exists in `after`.
        expect(lines.some((l) => l.getAttribute('data-recorded') !== null)).toBe(false);
    });

    it('CASUALTY: there is no playhead and no seekable line in any state — the absence is structural', () => {
        const { container } = render(<Waveform amplitudes={envelope(120)} fillerBars={[3]} />);
        expect(screen.queryByTestId('waveform-playhead')).toBeNull();
        // A seek target would have to be a button; the track renders spans only.
        expect(container.querySelectorAll('button')).toHaveLength(0);
    });
});

describe('Waveform — a narrow track shows the WHOLE take (S-9 P1)', () => {
    let rect: ReturnType<typeof stubTrackWidth>;
    beforeEach(() => { rect = stubTrackWidth(120); });   // floor(120 / 4) = 30 lines for a 72-level source
    afterEach(() => { rect.mockRestore(); cleanup(); });

    const quiet = (n: number) => Array.from({ length: n }, () => 0.05);

    it('CASUALTY: the END of the recording survives — the source is resampled, never truncated', () => {
        const take = quiet(72);
        take[71] = 1;   // the last moment of the take is loud
        render(<Waveform amplitudes={take} fillerBars={[]} height={34} />);
        const lines = screen.getAllByTestId('waveform-line');
        expect(lines).toHaveLength(30);
        // Truncation would render only the leading 30 quiet levels and lose this.
        expect(lines[29].style.height).toBe('34px');
    });

    it('CASUALTY: a late filler still lands on the shape', () => {
        render(<Waveform amplitudes={quiet(72)} fillerBars={[70]} height={34} />);
        const lines = screen.getAllByTestId('waveform-line');
        expect(lines[29]).toHaveAttribute('data-filler', 'true');
        expect(lines.filter((l) => l.getAttribute('data-filler') === 'true')).toHaveLength(1);
    });

    it('during: the recorded boundary scales with the compression', () => {
        render(<Waveform amplitudes={quiet(72)} recordedCount={36} />);
        const lines = screen.getAllByTestId('waveform-line');
        // Half of the source is recorded → half of the 30 lines.
        expect(lines.filter((l) => l.getAttribute('data-recorded') === 'true')).toHaveLength(15);
    });
});
