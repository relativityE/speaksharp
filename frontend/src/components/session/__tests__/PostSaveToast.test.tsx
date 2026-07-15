// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { PostSaveToast } from '../PostSaveToast';

afterEach(() => cleanup());

describe('PostSaveToast', () => {
    it('shows nothing until a non-null session key arrives', () => {
        render(<PostSaveToast sessionKey={null} />);
        expect(screen.queryByTestId('post-save-toast')).toBeNull();
    });

    it('renders once with the "Next: Analytics" title, supporting copy, aria-live=polite, and NO button/CTA', () => {
        render(<PostSaveToast sessionKey="sess-1" />);
        const toast = screen.getByTestId('post-save-toast');
        expect(toast).toHaveAttribute('aria-live', 'polite');
        expect(toast).toHaveAttribute('role', 'status');
        expect(toast).toHaveTextContent('Next: Analytics');
        expect(toast).toHaveTextContent(/Open Analytics when you.?re ready/i);
        // Informational only — the action lives on the status bar.
        expect(toast.querySelector('button')).toBeNull();
        expect(toast.querySelector('a')).toBeNull();
        // Does not steal focus.
        expect(toast).not.toBe(document.activeElement);
    });

    it('stays visible for ≥5s then auto-dismisses (~8s)', () => {
        vi.useFakeTimers();
        try {
            render(<PostSaveToast sessionKey="sess-1" />);
            expect(screen.getByTestId('post-save-toast')).toBeInTheDocument();
            act(() => { vi.advanceTimersByTime(5000); });
            expect(screen.getByTestId('post-save-toast')).toBeInTheDocument(); // still up at 5s
            act(() => { vi.advanceTimersByTime(3100); });
            expect(screen.queryByTestId('post-save-toast')).toBeNull();        // gone by ~8s
        } finally {
            vi.useRealTimers();
        }
    });

    it('pauses the countdown on hover (stays visible past the normal window)', () => {
        vi.useFakeTimers();
        try {
            render(<PostSaveToast sessionKey="sess-1" />);
            const toast = screen.getByTestId('post-save-toast');
            act(() => { vi.advanceTimersByTime(4000); });
            fireEvent.mouseEnter(toast);          // pause
            act(() => { vi.advanceTimersByTime(20000); });
            expect(screen.getByTestId('post-save-toast')).toBeInTheDocument(); // still up while hovered
            fireEvent.mouseLeave(toast);          // resume
            act(() => { vi.advanceTimersByTime(8100); });
            expect(screen.queryByTestId('post-save-toast')).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it('fires once per session — re-fires only when the key changes (second session, no unmount)', () => {
        vi.useFakeTimers();
        try {
            const { rerender } = render(<PostSaveToast sessionKey="sess-1" />);
            expect(screen.getByTestId('post-save-toast')).toBeInTheDocument();
            act(() => { vi.advanceTimersByTime(8100); });
            expect(screen.queryByTestId('post-save-toast')).toBeNull();
            // Same key again → does NOT re-show.
            rerender(<PostSaveToast sessionKey="sess-1" />);
            expect(screen.queryByTestId('post-save-toast')).toBeNull();
            // New finalized session → shows again.
            rerender(<PostSaveToast sessionKey="sess-2" />);
            expect(screen.getByTestId('post-save-toast')).toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });
});
