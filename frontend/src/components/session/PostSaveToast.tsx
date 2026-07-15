import React from 'react';

interface PostSaveToastProps {
    /**
     * Changes to a new value once per successfully finalized+persisted session (the finalized session
     * id). The toast shows exactly once per new value. Null/undefined shows nothing — so passing the
     * post-persistence finalized id guarantees the toast never appears before reconciliation + persist.
     */
    sessionKey: string | number | null | undefined;
    className?: string;
}

/**
 * One-shot post-save completion toast (Track 1). Informational only — NO button/CTA inside; the
 * Analytics action lives on the status bar. Near the middle content area, visually distinct from the
 * white surface (blue-tinted), aria-live="polite", never steals focus, auto-dismisses after ≥5s, and
 * pauses on hover/focus.
 */
export const PostSaveToast: React.FC<PostSaveToastProps> = ({ sessionKey, className = '' }) => {
    const DURATION_MS = 8000; // ≥ 5s; hover/focus pauses the countdown.
    const [visible, setVisible] = React.useState(false);
    const shownForRef = React.useRef<string | number | null | undefined>(null);
    const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearTimer = React.useCallback(() => {
        if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    }, []);
    const startTimer = React.useCallback(() => {
        clearTimer();
        timerRef.current = setTimeout(() => setVisible(false), DURATION_MS);
    }, [clearTimer]);

    // Show once per newly finalized session.
    React.useEffect(() => {
        if (sessionKey === null || sessionKey === undefined) return;
        if (shownForRef.current === sessionKey) return;
        shownForRef.current = sessionKey;
        setVisible(true);
        startTimer();
        return clearTimer;
    }, [sessionKey, startTimer, clearTimer]);

    if (!visible) return null;

    return (
        <div
            role="status"
            aria-live="polite"
            data-testid="post-save-toast"
            tabIndex={-1}
            onMouseEnter={clearTimer}
            onMouseLeave={startTimer}
            onFocus={clearTimer}
            onBlur={startTimer}
            className={`fixed bottom-6 left-1/2 z-50 w-[min(92vw,26rem)] -translate-x-1/2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 backdrop-blur-sm surface-shadow ${className}`}
        >
            <p className="text-sm font-bold text-primary">Next: Analytics</p>
            <p className="mt-0.5 text-[13px] font-medium leading-snug text-foreground/80">
                Your session is saved. Open Analytics when you’re ready for your full transcript and deeper feedback.
            </p>
        </div>
    );
};

export default PostSaveToast;
