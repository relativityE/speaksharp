import React from 'react';
import { FillerBreakdown } from './FillerBreakdown';
import type { FillerCounts } from '@/utils/fillerWordUtils';

/**
 * #1046 Focus Points — the after-only delivery strip (spec §5).
 *
 * Focus Points hides filler chrome during practice (it is a recall task; a second live scoring system
 * makes users worse at it). Delivery is still measured silently and surfaces exactly ONCE, here, as a
 * single line. The full Open-Floor-style breakdown is NOT inlined by default — it sits behind "Delivery
 * detail", revealed only on request.
 *
 * The line ties the disfluency to the coverage outcome WHEN the data supports it: with a missed point we
 * note the fillers may mark where the recall gap was; otherwise we state the plain count. We never claim
 * a linkage we cannot evidence (no per-filler timing is available in the view yet).
 */
export interface FocusDeliveryStripProps {
    fillerCount: number;
    fillerData?: FillerCounts | null;
    /** True when at least one point went uncovered — lets us honestly hint at the recall gap. */
    hasMissedPoint: boolean;
}

export const FocusDeliveryStrip: React.FC<FocusDeliveryStripProps> = ({ fillerCount, fillerData, hasMissedPoint }) => {
    const [showDetail, setShowDetail] = React.useState(false);
    const plural = fillerCount === 1 ? 'filler' : 'fillers';
    const line = fillerCount === 0
        ? 'Also worth noting: no fillers this run — clean delivery.'
        : hasMissedPoint
            ? `Also worth noting: ${fillerCount} ${plural} — some may mark where a point slipped.`
            : `Also worth noting: ${fillerCount} ${plural}.`;

    return (
        <section
            data-testid="focus-delivery-strip"
            className="mt-[14px] rounded-xl border border-[#dbe2ec] bg-white px-4 py-[15px]"
        >
            <div className="flex items-center justify-between gap-3">
                <p className="text-[14px] text-[#2b3446]">{line}</p>
                <button
                    type="button"
                    onClick={() => setShowDetail((v) => !v)}
                    data-testid="focus-delivery-detail-toggle"
                    aria-expanded={showDetail}
                    className="shrink-0 text-[13px] font-bold text-[#0d7d74] hover:underline"
                >
                    {showDetail ? 'Hide detail' : 'Delivery detail →'}
                </button>
            </div>
            {showDetail && (
                <div className="mt-3 border-t border-[#eef2f7] pt-3">
                    <FillerBreakdown fillerData={fillerData} stats={`${fillerCount} ${plural}`} />
                </div>
            )}
        </section>
    );
};

export default FocusDeliveryStrip;
