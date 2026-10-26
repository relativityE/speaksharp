import { render, screen } from '../../../../tests/support/test-utils';
import { TrendChart } from '../TrendChart';
import type { TrendDataPoint } from '../trendMetrics';
import { describe, it, expect, beforeAll, vi } from 'vitest';

/**
 * #1091: a session with no scorable clarity evidence must be an OMITTED point, never a fabricated
 * 0 and never a fabricated 100. This is only an honest fix if the chart actually renders such a
 * point as a GAP, so this suite VERIFIES Recharts' null handling against the installed version
 * rather than assuming it. `<Area>` leaves `connectNulls` at its default `false`.
 */

global.ResizeObserver = class ResizeObserver {
    observe() { }
    unobserve() { }
    disconnect() { }
};

// jsdom reports a zero-size box, which would short-circuit `useChartContainerReady` and skip the
// chart entirely — the assertions below would then pass vacuously. Give the container a real size.
beforeAll(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        width: 600, height: 240, top: 0, left: 0, bottom: 240, right: 600, x: 0, y: 0,
        toJSON: () => ({}),
    } as DOMRect);
});

// `date` is MM/DD; each point is its own day at noon, so every point carries a day label.
const point = (date: string, clarity: number | null): TrendDataPoint => {
    const [m, d] = date.split('/').map(Number);
    const createdAt = new Date(2026, m - 1, d, 12).toISOString();
    return { i: d - 1, dayLabel: date, createdAt, product: 'open_mic', wpm: 140, clarity, fillers: 2, pauses: 1.5 };
};

const areaPath = (container: HTMLElement) =>
    container.querySelector('.recharts-area-area')?.getAttribute('d') ?? '';

describe('#1091 TrendChart renders missing clarity as a gap, not a fabricated value', () => {
    it('renders without crashing when clarity points are null', () => {
        const { container } = render(
            <TrendChart
                title="Clarity Trend"
                data={[point('01/01', 88), point('01/02', null), point('01/03', 74), point('01/04', 80)]}
                metric="clarity"
            />,
        );
        expect(screen.getByTestId('clarity-trend-chart')).toBeInTheDocument();
        // The chart really rendered — otherwise every assertion here would be vacuous.
        expect(container.querySelector('.recharts-area')).toBeTruthy();
    });

    it('breaks the series at the null point instead of plotting a value for it', () => {
        const withGap = render(
            <TrendChart
                title="Clarity Trend"
                data={[point('01/01', 88), point('01/02', null), point('01/03', 74), point('01/04', 80)]}
                metric="clarity"
            />,
        );
        const gapPath = areaPath(withGap.container);
        withGap.unmount();

        const withZero = render(
            <TrendChart
                title="Clarity Trend"
                data={[point('01/01', 88), point('01/02', 0), point('01/03', 74), point('01/04', 80)]}
                metric="clarity"
            />,
        );
        const zeroPath = areaPath(withZero.container);
        withZero.unmount();

        expect(gapPath).not.toBe('');
        expect(zeroPath).not.toBe('');
        // A fabricated 0 and an omitted point must not draw the same shape. If Recharts silently
        // coerced null to 0 these would be identical — which is exactly the defect being fixed.
        expect(gapPath).not.toBe(zeroPath);
        // A gap is drawn as multiple subpaths; the continuous zero series is a single one.
        expect((gapPath.match(/M/g) || []).length).toBeGreaterThan(
            (zeroPath.match(/M/g) || []).length,
        );
    });

    it('does not fabricate a 100 for a missing point either', () => {
        const withGap = render(
            <TrendChart
                title="Clarity Trend"
                data={[point('01/01', 88), point('01/02', null), point('01/03', 74), point('01/04', 80)]}
                metric="clarity"
            />,
        );
        const gapPath = areaPath(withGap.container);
        withGap.unmount();

        const withHundred = render(
            <TrendChart
                title="Clarity Trend"
                data={[point('01/01', 88), point('01/02', 100), point('01/03', 74), point('01/04', 80)]}
                metric="clarity"
            />,
        );
        const hundredPath = areaPath(withHundred.container);
        withHundred.unmount();

        expect(gapPath).not.toBe(hundredPath);
    });

    it('still renders a genuine measured zero as a real point', () => {
        // A real 0% clarity is evidence and must stay on the chart. Only ABSENCE is omitted.
        const { container } = render(
            <TrendChart
                title="Clarity Trend"
                data={[point('01/01', 88), point('01/02', 0), point('01/03', 74), point('01/04', 80)]}
                metric="clarity"
            />,
        );
        expect(areaPath(container)).not.toBe('');
        expect((areaPath(container).match(/M/g) || []).length).toBe(1);
    });
});

/** #1258 D8 — three measured points before a trend is drawn; a missing pause measurement is left out, never a 0. */
describe('#1258 D8 TrendChart minimum and pause evidence', () => {
    const at = (i: number, day: number, hour: number, pauses: number | null): TrendDataPoint => {
        const createdAt = new Date(2026, 9, day, hour).toISOString();
        return { i, dayLabel: '', createdAt, product: 'open_mic', wpm: 120, clarity: 95, fillers: 1, pauses };
    };

    it('two measured points: no chart, one line saying one more session is needed', () => {
        const { container } = render(<TrendChart metric="wpm" data={[at(0, 1, 9, 1), at(1, 2, 9, 1)]} bare />);
        expect(screen.getByText('Appears after 1 more session')).toBeInTheDocument();
        expect(container.querySelector('.recharts-area')).toBeNull();
        expect(screen.queryByText(/Not enough data yet|Complete at least 2/)).toBeNull();
    });

    it('CASUALTY (flat 0/min line): every session without pause evidence draws no line and needs 3 more sessions', () => {
        const { container } = render(<TrendChart metric="pauses" data={[at(0, 1, 9, null), at(1, 2, 9, null), at(2, 3, 9, null), at(3, 4, 9, null)]} bare />);
        expect(screen.getByText('Appears after 3 more sessions')).toBeInTheDocument();
        expect(container.querySelector('.recharts-area')).toBeNull();
    });

    it('4 sessions, 2 with pause evidence: still 1 more session needed (only measured points count)', () => {
        render(<TrendChart metric="pauses" data={[at(0, 1, 9, 2), at(1, 2, 9, null), at(2, 3, 9, 1), at(3, 4, 9, null)]} bare />);
        expect(screen.getByText('Appears after 1 more session')).toBeInTheDocument();
    });

    it('bare renders without the card title; three points draw the chart', () => {
        const { container } = render(<TrendChart metric="wpm" title="Speaking pace" data={[at(0, 1, 9, 1), at(1, 2, 9, 1), at(2, 3, 9, 1)]} bare />);
        expect(screen.queryByText('Speaking pace')).toBeNull();
        expect(container.querySelector('.recharts-area')).toBeTruthy();
    });

    it('the x-axis prints one date per day: a second session on the same day has no tick label', () => {
        const data = [at(0, 1, 9, 1), at(1, 1, 18, 1), at(2, 2, 9, 1)].map((p, i) => ({ ...p, dayLabel: ['1 Oct', '', '2 Oct'][i] }));
        const { container } = render(<TrendChart metric="wpm" data={data} bare />);
        // Recharts splits a tick into word <tspan>s, so compare without whitespace ("1 Oct" reads "1Oct").
        const ticks = [...container.querySelectorAll('.recharts-xAxis-tick-labels text')].map((t) => (t.textContent ?? '').replace(/\s/g, ''));
        expect(ticks).toEqual(['1Oct', '', '2Oct']);
        expect(ticks.some((t) => /T\d{2}:|\d{4}-\d{2}-\d{2}/.test(t ?? ''))).toBe(false);
    });
});
