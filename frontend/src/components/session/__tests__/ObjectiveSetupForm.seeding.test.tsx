/**
 * #1407 — the REAL capture form's seeding.
 *
 * The page-level tests stub this form to keep the wiring under test, which means the seeding itself is
 * unproven there: a mutation that dropped the pace seed passed the whole page suite. This file drives
 * the genuine form so "Edit opens with the current values" is a fact about the component users see.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '../../../../tests/support/test-utils';
import { ObjectiveSetupForm } from '../ObjectiveSetupForm';

describe('Edit seeds the real form from the brief being edited', () => {
    it('prefills topic, every point, and the pace guide', () => {
        render(<ObjectiveSetupForm initial={{
            topic: 'Sales pitch', points: ['Opening hook', 'The ask'], paceGuideSecPerPoint: 90,
        }} />);
        expect((screen.getByTestId('objective-goal-input') as HTMLInputElement).value).toBe('Sales pitch');
        expect((screen.getByTestId('objective-point-label-0') as HTMLInputElement).value).toBe('Opening hook');
        expect((screen.getByTestId('objective-point-label-1') as HTMLInputElement).value).toBe('The ask');
        // 90s per point == 1.5 min. A dropped pace seed would show the default 1 min.
        expect(screen.getByTestId('objective-pace-value').textContent).toContain('1.5');
    });

    it('a free-text topic selects "other" so the value is visible, not silently discarded', () => {
        render(<ObjectiveSetupForm initial={{ topic: 'Wedding speech', points: ['Thank the hosts'] }} />);
        expect((screen.getByTestId('objective-goal-select') as HTMLSelectElement).value).toBe('other');
        expect((screen.getByTestId('objective-goal-input') as HTMLInputElement).value).toBe('Wedding speech');
    });

    it('a quick-pick topic stays a quick-pick', () => {
        render(<ObjectiveSetupForm initial={{ topic: 'Job interview', points: ['A'] }} />);
        expect((screen.getByTestId('objective-goal-select') as HTMLSelectElement).value).toBe('Job interview');
    });

    it('a brief that SKIPPED pace stays skipped rather than acquiring the default', () => {
        render(<ObjectiveSetupForm initial={{ topic: 'T', points: ['A'], paceGuideSecPerPoint: null }} />);
        expect(screen.queryByTestId('objective-pace-value')).toBeNull();
    });

    it('CASUALTY: no initial means a BLANK form — this is what "Start a new set" renders', () => {
        render(<ObjectiveSetupForm />);
        // No topic chosen: the select is unset and the free-text field is not offered at all.
        expect((screen.getByTestId('objective-goal-select') as HTMLSelectElement).value).toBe('');
        expect(screen.queryByTestId('objective-goal-input')).toBeNull();
        expect((screen.getByTestId('objective-point-label-0') as HTMLInputElement).value).toBe('');
        // The default pace returns for a fresh set.
        expect(screen.getByTestId('objective-pace-value').textContent).toContain('1');
    });
});
