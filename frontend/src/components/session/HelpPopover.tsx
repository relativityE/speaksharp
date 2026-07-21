import React from 'react';
import { HelpCircle } from 'lucide-react';

interface HelpPopoverProps {
    /** Accessible name for the trigger and the popover panel, e.g. "About the SpeakSharp Score". */
    label: string;
    /** Help content (kept out of the default-visible UI). */
    children: React.ReactNode;
    /** data-testid for the trigger; the panel gets `${testId}-content`. */
    testId?: string;
    className?: string;
    triggerClassName?: string;
    /** Trigger box size (default 'h-5 w-5'). Pass 'h-11 w-11' for a ≥44×44px touch target. */
    triggerSizeClass?: string;
    /** Popover panel width class (default w-64). */
    panelClassName?: string;
    /**
     * Controlled open state. When provided, the PARENT owns visibility — used to keep this help
     * surface mutually exclusive with another surface (e.g. the STT dropdown). Every open/close still
     * reports through `onOpenChange`. Omit both for the default uncontrolled behavior.
     */
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}

/**
 * Accessible "more info" affordance. Explanatory detail lives here instead of as
 * large default-visible paragraphs, keeping the session UI scannable.
 *
 * Opens on hover, keyboard focus, click, and mobile tap — it never relies on hover
 * alone. Closes on Escape, outside click, or blur. The trigger is a real <button>
 * with aria-expanded, so keyboard and screen-reader users get the same access.
 */
export const HelpPopover: React.FC<HelpPopoverProps> = ({
    label,
    children,
    testId,
    className = '',
    triggerClassName = '',
    triggerSizeClass = 'h-5 w-5',
    panelClassName = 'w-64',
    open: controlledOpen,
    onOpenChange,
}) => {
    const [internalOpen, setInternalOpen] = React.useState(false);
    const isControlled = controlledOpen !== undefined;
    const open = isControlled ? controlledOpen : internalOpen;
    // Single setter: updates local state when uncontrolled, and ALWAYS reports through onOpenChange so a
    // controlling parent can react (e.g. close the dropdown when About opens).
    const setOpen = React.useCallback((next: boolean) => {
        if (!isControlled) setInternalOpen(next);
        onOpenChange?.(next);
    }, [isControlled, onOpenChange]);
    const panelId = testId ? `${testId}-content` : undefined;
    // Horizontal nudge (px) applied when the panel would otherwise clip off a viewport
    // edge — keeps the help text fully readable on narrow/mobile screens. 0 on desktop.
    const [shiftX, setShiftX] = React.useState(0);
    const rootRef = React.useRef<HTMLSpanElement>(null);
    const panelRef = React.useRef<HTMLDivElement>(null);
    const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    // A click/tap "pins" the popover open so a subsequent hover-out or blur doesn't
    // dismiss it. Hover and focus open transiently (close when the pointer leaves /
    // focus moves); Escape and outside-click always close and un-pin. This avoids the
    // hover-then-click race where opening on hover and toggling on click cancel out.
    const pinnedRef = React.useRef(false);

    const cancelClose = React.useCallback(() => {
        if (closeTimer.current) {
            clearTimeout(closeTimer.current);
            closeTimer.current = null;
        }
    }, []);

    const close = React.useCallback(() => {
        cancelClose();
        pinnedRef.current = false;
        setOpen(false);
    }, [cancelClose, setOpen]);

    // Small delay so moving the pointer from trigger to panel doesn't dismiss it.
    const scheduleClose = React.useCallback(() => {
        if (pinnedRef.current) return;
        cancelClose();
        closeTimer.current = setTimeout(() => setOpen(false), 120);
    }, [cancelClose, setOpen]);

    React.useEffect(() => () => cancelClose(), [cancelClose]);

    React.useEffect(() => {
        if (!open) return;
        const onDocPointer = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') close();
        };
        document.addEventListener('mousedown', onDocPointer);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDocPointer);
            document.removeEventListener('keydown', onKey);
        };
    }, [open, close]);

    // Keep the panel inside the viewport. Measure its natural position (transform removed)
    // and shift it horizontally so neither edge clips — fixes mobile where a right-anchored
    // panel near the left edge would otherwise run off-screen. Desktop resolves to shift 0.
    React.useLayoutEffect(() => {
        if (!open) { setShiftX(0); return; }
        const clamp = () => {
            const el = panelRef.current;
            if (!el) return;
            const prev = el.style.transform;
            el.style.transform = 'none';
            const rect = el.getBoundingClientRect();
            el.style.transform = prev;
            const margin = 8;
            let dx = 0;
            if (rect.left < margin) dx = Math.round(margin - rect.left);
            else if (rect.right > window.innerWidth - margin) dx = Math.round(window.innerWidth - margin - rect.right);
            setShiftX(dx);
        };
        clamp();
        window.addEventListener('resize', clamp);
        return () => window.removeEventListener('resize', clamp);
    }, [open]);

    return (
        <span
            ref={rootRef}
            className={`relative inline-flex align-middle ${className}`}
            onMouseEnter={() => { cancelClose(); setOpen(true); }}
            onMouseLeave={scheduleClose}
        >
            <button
                type="button"
                aria-label={label}
                aria-expanded={open}
                aria-haspopup="dialog"
                aria-controls={open && panelId ? panelId : undefined}
                data-testid={testId}
                onClick={() => {
                    if (pinnedRef.current) {
                        close();
                    } else {
                        pinnedRef.current = true;
                        cancelClose();
                        setOpen(true);
                    }
                }}
                onFocus={() => { cancelClose(); setOpen(true); }}
                onBlur={scheduleClose}
                className={`inline-flex ${triggerSizeClass} items-center justify-center rounded-full text-foreground/45 transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${triggerClassName}`}
            >
                <HelpCircle className="h-4 w-4" aria-hidden="true" />
            </button>
            {open && (
                <div
                    ref={panelRef}
                    id={panelId}
                    role="dialog"
                    aria-label={label}
                    data-testid={panelId}
                    className={`absolute right-0 top-7 z-50 ${panelClassName} max-w-[calc(100vw-1rem)] rounded-lg border border-border bg-card p-3 text-left text-xs font-medium leading-snug text-foreground/80 shadow-lg`}
                    style={shiftX ? { transform: `translateX(${shiftX}px)` } : undefined}
                    onMouseEnter={cancelClose}
                    onMouseLeave={scheduleClose}
                >
                    {children}
                </div>
            )}
        </span>
    );
};

export default HelpPopover;
