import { render, screen, fireEvent } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { SessionVerdict } from '../SessionVerdict';

// #1222 slot D (after), restructured by #1474 (G10): one insight line, optional supporting excerpts with
// timestamps, one prominent `Try this next run` prescription, then the primary and secondary actions.
describe('SessionVerdict (#1222 slot D after)', () => {
    const base = {
        verdictLine: 'Your cleanest session yet.',
        fix: "You opened three sentences with 'um' — 4 of your 5 fillers sat at a sentence start.",
        onPracticeAgain: vi.fn(),
        onSeeAllSessions: vi.fn(),
    };

    it('renders the one verdict line, the fix box, and the two actions', () => {
        render(<SessionVerdict {...base} />);
        expect(screen.getByTestId('verdict-line')).toHaveTextContent('Your cleanest session yet.');
        expect(screen.getByTestId('verdict-fix')).toHaveTextContent(/Try this next run/i);
        expect(screen.getByTestId('verdict-fix')).toHaveTextContent(/4 of your 5 fillers/);
        expect(screen.getByTestId('verdict-practice-again')).toBeInTheDocument();
        expect(screen.getByTestId('verdict-see-all')).toBeInTheDocument();
    });

    it('never shows a score/100 or confetti', () => {
        render(<SessionVerdict {...base} />);
        expect(screen.queryByText(/\/\s*100/)).toBeNull();
    });

    it('wires the two actions', () => {
        const onPracticeAgain = vi.fn();
        const onSeeAllSessions = vi.fn();
        render(<SessionVerdict {...base} onPracticeAgain={onPracticeAgain} onSeeAllSessions={onSeeAllSessions} />);
        fireEvent.click(screen.getByTestId('verdict-practice-again'));
        fireEvent.click(screen.getByTestId('verdict-see-all'));
        expect(onPracticeAgain).toHaveBeenCalledOnce();
        expect(onSeeAllSessions).toHaveBeenCalledOnce();
    });

    /**
     * #1422 casualty E — a successful 1+1 review must never coexist with "Session review not requested."
     *
     * The card used to render a manufactured verdict whenever no legacy coaching prose was supplied,
     * and since that prose is retired (#1306) the fallback was ALWAYS what showed — directly above the
     * real generated review. The screen contradicted itself.
     */
    it('CASUALTY: renders no verdict prose when there is none, and never the retired fallback copy', () => {
        render(
            <SessionVerdict
                verdictLine={null}
                fix={null}
                onPracticeAgain={vi.fn()}
                onSeeAllSessions={vi.fn()}
            />,
        );

        expect(screen.queryByTestId('verdict-line'), 'no fabricated verdict line').toBeNull();
        expect(screen.queryByTestId('verdict-fix'), 'no fabricated fix box').toBeNull();
        expect(screen.queryByText(/Session review not requested/i)).toBeNull();
        expect(screen.queryByText(/Try this next run/i)).toBeNull();

        // The ACTIONS are not coaching and must survive: this is the only desktop control that starts
        // the next take.
        expect(screen.getByTestId('verdict-practice-again')).toBeInTheDocument();
        expect(screen.getByTestId('verdict-see-all')).toBeInTheDocument();
    });

    it('still renders a verdict line and fix when one is genuinely supplied', () => {
        // The positive control: making the prose optional must not make it unrenderable.
        render(
            <SessionVerdict
                verdictLine="Your cleanest session yet."
                fix="Pause instead of “um”."
                onPracticeAgain={vi.fn()}
                onSeeAllSessions={vi.fn()}
            />,
        );
        expect(screen.getByTestId('verdict-line')).toHaveTextContent('Your cleanest session yet.');
        expect(screen.getByTestId('verdict-fix')).toHaveTextContent(/Pause instead of/);
    });

    // ---- #1474 G10 ----

    it('G10: renders supporting transcript excerpts with their timestamps when the review supplies them', () => {
        render(
            <SessionVerdict
                {...base}
                excerpts={[
                    { at: '0:12', text: 'um, so what I wanted to cover today' },
                    { at: '1:48', text: 'um, and the last point is pricing' },
                ]}
            />,
        );
        const list = screen.getByTestId('verdict-excerpts');
        expect(list).toHaveAccessibleName('Supporting transcript excerpts');
        const spans = screen.getAllByTestId('verdict-excerpt');
        expect(spans).toHaveLength(2);
        expect(spans[0]).toHaveTextContent('0:12');
        expect(spans[0]).toHaveTextContent('um, so what I wanted to cover today');
        expect(spans[1]).toHaveTextContent('1:48');
    });

    it('G10 CASUALTY: never invents an excerpt section when the review supplies none', () => {
        // An empty frame would read as "we found nothing to quote", which is a different claim from
        // "no excerpts were supplied". Absent means absent.
        render(<SessionVerdict {...base} />);
        expect(screen.queryByTestId('verdict-excerpts')).toBeNull();

        render(<SessionVerdict {...base} excerpts={[]} />);
        expect(screen.queryByTestId('verdict-excerpts')).toBeNull();
    });

    it('G10 CASUALTY: drops a blank excerpt rather than rendering an empty quote row', () => {
        render(<SessionVerdict {...base} excerpts={[{ at: '0:03', text: '   ' }, { at: '0:09', text: 'real words' }]} />);
        const spans = screen.getAllByTestId('verdict-excerpt');
        expect(spans).toHaveLength(1);
        expect(spans[0]).toHaveTextContent('real words');
    });

    it('G10: both actions carry a visible focus treatment, on the dark surface', () => {
        // The dark-ink surface is exactly where a removed focus ring becomes invisible, so this is asserted
        // rather than assumed.
        render(<SessionVerdict {...base} />);
        for (const id of ['verdict-practice-again', 'verdict-see-all']) {
            const el = screen.getByTestId(id);
            expect(el.className).toContain('focus-visible:ring-2');
            expect(el.className).toContain('focus-visible:ring-signature');
        }
    });

    it('G10: the prescription is the brand accent and the insight reads on ink, via role tokens only', () => {
        render(<SessionVerdict {...base} excerpts={[{ at: '0:12', text: 'um' }]} />);
        expect(screen.getByTestId('verdict-fix').className).toContain('border-signature');
        expect(screen.getByTestId('verdict-practice-again').className).toContain('bg-signature');
        expect(screen.getByTestId('verdict-excerpt').className).toContain('bg-ink-raised');
        // No raw colour values anywhere in the rendered classes — the token authority owns the palette.
        const html = document.body.innerHTML;
        expect(html).not.toMatch(/#[0-9a-f]{6}\b/i);
        expect(html).not.toMatch(/rgb\(/i);
    });
});
