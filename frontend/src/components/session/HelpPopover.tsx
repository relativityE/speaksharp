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
    /** Popover panel width class (default w-64). */
    panelClassName?: string;
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
    panelClassName = 'w-64',
}) => {
    const [open, setOpen] = React.useState(false);
    const rootRef = React.useRef<HTMLSpanElement>(null);
    const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    const cancelClose = React.useCallback(() => {
        if (closeTimer.current) {
            clearTimeout(closeTimer.current);
            closeTimer.current = null;
        }
    }, []);

    // Small delay so moving the pointer from trigger to panel doesn't dismiss it.
    const scheduleClose = React.useCallback(() => {
        cancelClose();
        closeTimer.current = setTimeout(() => setOpen(false), 120);
    }, [cancelClose]);

    React.useEffect(() => () => cancelClose(), [cancelClose]);

    React.useEffect(() => {
        if (!open) return;
        const onDocPointer = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onDocPointer);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDocPointer);
            document.removeEventListener('keydown', onKey);
        };
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
                data-testid={testId}
                onClick={() => setOpen((v) => !v)}
                onFocus={() => { cancelClose(); setOpen(true); }}
                onBlur={scheduleClose}
                className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-foreground/45 transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${triggerClassName}`}
            >
                <HelpCircle className="h-4 w-4" aria-hidden="true" />
            </button>
            {open && (
                <div
                    role="dialog"
                    aria-label={label}
                    data-testid={testId ? `${testId}-content` : undefined}
                    className={`absolute right-0 top-7 z-50 ${panelClassName} rounded-lg border border-border bg-card p-3 text-left text-xs font-medium leading-snug text-foreground/80 shadow-lg`}
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
