import { render, screen } from '../../../../tests/support/test-utils';
import { TrendChart } from '../TrendChart';
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

const point = (date: string, clarity: number | null) => ({
    date, wpm: 140, clarity, fillers: 2, pauses: 1.5,
});

const areaPath = (container: HTMLElement) =>
    container.querySelector('.recharts-area-area')?.getAttribute('d') ?? '';

describe('#1091 TrendChart renders missing clarity as a gap, not a fabricated value', () => {
    it('renders without crashing when clarity points are null', () => {
        const { container } = render(
            <TrendChart
                title="Clarity Trend"
                data={[point('01/01', 88), point('01/02', null), point('01/03', 74)]}
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
                data={[point('01/01', 88), point('01/02', null), point('01/03', 74)]}
                metric="clarity"
            />,
        );
        const gapPath = areaPath(withGap.container);
        withGap.unmount();

        const withZero = render(
            <TrendChart
                title="Clarity Trend"
                data={[point('01/01', 88), point('01/02', 0), point('01/03', 74)]}
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
                data={[point('01/01', 88), point('01/02', null), point('01/03', 74)]}
                metric="clarity"
            />,
        );
        const gapPath = areaPath(withGap.container);
        withGap.unmount();

        const withHundred = render(
            <TrendChart
                title="Clarity Trend"
                data={[point('01/01', 88), point('01/02', 100), point('01/03', 74)]}
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
                data={[point('01/01', 88), point('01/02', 0), point('01/03', 74)]}
                metric="clarity"
            />,
        );
        expect(areaPath(container)).not.toBe('');
        expect((areaPath(container).match(/M/g) || []).length).toBe(1);
    });
});
