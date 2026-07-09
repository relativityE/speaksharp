import { fireEvent, render, screen } from '../../../../tests/support/test-utils';
import { describe, it, expect } from 'vitest';
import { HelpPopover } from '../HelpPopover';

describe('HelpPopover', () => {
    const renderHelp = () =>
        render(
            <HelpPopover label="About the score" testId="demo-help">
                <p>Detailed explanation lives here.</p>
            </HelpPopover>
        );

    it('keeps the help content out of the default view', () => {
        renderHelp();
        expect(screen.getByTestId('demo-help')).toBeInTheDocument();
        expect(screen.queryByText(/Detailed explanation lives here/i)).toBeNull();
    });

    it('exposes an accessible trigger with a label and expanded state', () => {
        renderHelp();
        const trigger = screen.getByTestId('demo-help');
        expect(trigger).toHaveAttribute('aria-label', 'About the score');
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });

    it('opens on click (works without hover) and marks itself expanded', () => {
        renderHelp();
        const trigger = screen.getByTestId('demo-help');
        fireEvent.click(trigger);
        expect(screen.getByText(/Detailed explanation lives here/i)).toBeInTheDocument();
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByTestId('demo-help-content')).toHaveAttribute('role', 'dialog');
    });

    it('opens on keyboard focus', () => {
        renderHelp();
        fireEvent.focus(screen.getByTestId('demo-help'));
        expect(screen.getByText(/Detailed explanation lives here/i)).toBeInTheDocument();
    });

    it('opens on pointer hover', () => {
        renderHelp();
        fireEvent.mouseEnter(screen.getByTestId('demo-help').parentElement as HTMLElement);
        expect(screen.getByText(/Detailed explanation lives here/i)).toBeInTheDocument();
    });

    it('stays open when hover is immediately followed by a click (real-browser sequence)', () => {
        // Regression: a real click hovers first (opens), then clicks. A naive toggle
        // would close it again. The pinned-open behavior must keep it visible.
        renderHelp();
        const trigger = screen.getByTestId('demo-help');
        fireEvent.mouseEnter(trigger.parentElement as HTMLElement);
        fireEvent.click(trigger);
        expect(screen.getByText(/Detailed explanation lives here/i)).toBeInTheDocument();
        // And a hover-out does not dismiss a pinned (clicked) popover.
        fireEvent.mouseLeave(trigger.parentElement as HTMLElement);
        expect(screen.getByText(/Detailed explanation lives here/i)).toBeInTheDocument();
    });

    it('closes on Escape', () => {
        renderHelp();
        const trigger = screen.getByTestId('demo-help');
        fireEvent.click(trigger);
        expect(screen.getByText(/Detailed explanation lives here/i)).toBeInTheDocument();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByText(/Detailed explanation lives here/i)).toBeNull();
    });
});
