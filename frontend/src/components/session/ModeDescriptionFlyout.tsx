import React from 'react';
import { createPortal } from 'react-dom';

/**
 * ONE controlled description surface for the STT mode dropdown.
 *
 * Design principle: one menu, one active row, one help bubble. There is exactly ONE flyout element
 * at any time; its content follows the single `mode` prop (the currently hovered/focused row). It is
 * NEVER three independently-rendered bubbles.
 *
 * Geometry contract (enforced here + asserted in E2E):
 *  - The flyout is rendered in a body portal as position:fixed and is geometrically DISJOINT from the
 *    dropdown menu — placed beside it with an 8–12px gap, never intersecting the menu, its rows, or a
 *    caller-supplied "avoid" region (Live Coaching).
 *  - Placement side is chosen by available space (prefer left of the right-aligned menu, else right).
 *    If NO non-overlapping side fits, the desktop flyout is suppressed (hidden) and callers fall back
 *    to the single "About transcription modes" help surface.
 *  - It stays fully inside the viewport and is pointer-events:none, so it can never steal hover or
 *    obscure the control it explains.
 *
 * Desktop only: shown where hover + a fine pointer exist. Touch devices get the About panel instead.
 */

export const STT_FLYOUT_ID = 'stt-mode-flyout-desc';
const FLYOUT_WIDTH = 248;
const GAP = 10; // 8–12px visible gap between the menu and the bubble
const MARGIN = 8; // viewport-edge safety margin

function useHoverCapable(): boolean {
    const query = '(hover: hover) and (pointer: fine)';
    const get = () =>
        typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            ? window.matchMedia(query).matches
            : false;
    const [capable, setCapable] = React.useState<boolean>(get);
    React.useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const mq = window.matchMedia(query);
        const onChange = () => setCapable(mq.matches);
        onChange();
        mq.addEventListener?.('change', onChange);
        return () => mq.removeEventListener?.('change', onChange);
    }, []);
    return capable;
}

interface ModeDescriptionFlyoutProps {
    /** Menu is open AND a row is active. */
    open: boolean;
    /** The dropdown menu content DOM node the bubble positions beside. */
    anchorRef: React.RefObject<HTMLElement>;
    /** Active row identity — drives content and `data-mode`. */
    mode: string | null;
    title: string;
    body: string;
    /** CSS selector for a region the bubble must never overlap (Live Coaching). */
    avoidSelector?: string;
}

type Placement = { top: number; left: number } | 'none' | null;

export const ModeDescriptionFlyout: React.FC<ModeDescriptionFlyoutProps> = ({
    open,
    anchorRef,
    mode,
    title,
    body,
    avoidSelector,
}) => {
    const hoverCapable = useHoverCapable();
    const ref = React.useRef<HTMLDivElement>(null);
    // null = not yet measured (render hidden so the ref mounts and we can measure);
    // 'none' = no disjoint side fits (stay hidden, fall back to About);
    // {top,left} = placed.
    const [placement, setPlacement] = React.useState<Placement>(null);

    const active = open && hoverCapable && mode !== null;

    React.useLayoutEffect(() => {
        if (!active) {
            setPlacement(null);
            return;
        }
        const compute = () => {
            const anchor = anchorRef.current;
            const el = ref.current;
            if (!anchor || !el) return;
            const menu = anchor.getBoundingClientRect();
            const height = el.offsetHeight || 0;
            const vw = window.innerWidth;
            const vh = window.innerHeight;

            let avoid: DOMRect | null = null;
            if (avoidSelector) {
                const a = document.querySelector(avoidSelector);
                if (a) avoid = a.getBoundingClientRect();
            }

            // Horizontal fit depends only on the fixed width — decide the side (or none) up front.
            const fitsLeft = menu.left - GAP - FLYOUT_WIDTH >= MARGIN;
            const rightX = menu.right + GAP;
            const rightInViewport = rightX + FLYOUT_WIDTH <= vw - MARGIN;
            const rightClearsAvoid = !avoid || rightX + FLYOUT_WIDTH <= avoid.left;

            let left: number;
            if (fitsLeft) {
                left = menu.left - GAP - FLYOUT_WIDTH;
            } else if (rightInViewport && rightClearsAvoid) {
                left = rightX;
            } else {
                setPlacement('none'); // no non-overlapping placement → suppress (About is the fallback)
                return;
            }

            // Vertical: align the bubble's top with the menu's, clamped fully inside the viewport.
            const top = Math.max(MARGIN, Math.min(menu.top, vh - MARGIN - height));
            setPlacement({ top, left });
        };
        compute();
        window.addEventListener('resize', compute);
        window.addEventListener('scroll', compute, true);
        return () => {
            window.removeEventListener('resize', compute);
            window.removeEventListener('scroll', compute, true);
        };
    }, [active, mode, body, anchorRef, avoidSelector]);

    if (!active || typeof document === 'undefined') return null;
    if (placement === 'none') return null; // no room on either side → nothing rendered

    const placed = placement !== null;
    return createPortal(
        <div
            ref={ref}
            role="tooltip"
            id={STT_FLYOUT_ID}
            data-testid="stt-mode-flyout"
            data-mode={mode ?? undefined}
            style={{
                position: 'fixed',
                width: FLYOUT_WIDTH,
                top: placed ? placement!.top : 0,
                left: placed ? placement!.left : 0,
                visibility: placed ? 'visible' : 'hidden',
                pointerEvents: 'none',
                zIndex: 60,
            }}
            className="rounded-lg border border-border/70 bg-popover px-3 py-2 text-[11px] font-normal normal-case leading-snug text-popover-foreground shadow-md"
        >
            <p className="font-semibold text-foreground">{title}</p>
            <p className="mt-0.5 text-foreground/75">{body}</p>
        </div>,
        document.body,
    );
};

export default ModeDescriptionFlyout;
