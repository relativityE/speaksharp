// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readBoundFocusReviewPairInPage } from '../live/helpers/rwtCoachingCollector';

const a = '00000000-0000-4000-8000-000000000001';
const b = '00000000-0000-4000-8000-000000000002';
const c = '00000000-0000-4000-8000-000000000003';
const card = (id: string, phrase: string, attrs = '') =>
    `<section data-testid="saved-review" data-session-id="${id}" data-review-state="review" data-product="focus_points" ${attrs}>
        <div data-testid="saved-review-pair"><p data-testid="review-what-went-well">${phrase}</p>
        <p data-testid="review-try-next">Next: ${phrase}</p></div></section>`;
function mount(path: string, html: string) {
    window.location.pathname = path;
    document.body.innerHTML = html;
    // jsdom has no layout. Simulate browser rects only for shown content; keep real DOM querying and CSS visibility.
    for (const el of document.body.querySelectorAll<HTMLElement>('*')) {
        el.style.visibility = 'visible';
        Object.defineProperty(el, 'innerText', { configurable: true, get: () => el.textContent });
        vi.spyOn(el, 'getClientRects').mockReturnValue((el.closest('[hidden]') ? [] : [new DOMRect()]) as unknown as DOMRectList);
    }
}
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); window.location.pathname = '/'; });

describe('J3.b: read only the repeat’s own canonical saved review', () => {
    it('reads B on its canonical route even with A and C present', () => {
        mount('/progress/' + b, card(a, 'A') + card(b, 'B') + card(c, 'C'));
        expect(readBoundFocusReviewPairInPage(b)).toEqual({
            version: 'gemini_coaching_focus_v1', what_worked: 'B', what_to_try_next: 'Next: B',
        });
    });
    it.each([
        ['wrong canonical URL', '/progress/' + a, card(b, 'B')],
        ['legacy alias before redirect', '/analytics/' + b, card(b, 'B')],
        ['A/C cannot stand in', '/progress/' + b, card(a, 'A') + card(c, 'C')],
        ['duplicate B', '/progress/' + b, card(b, 'B') + card(b, 'other')],
        ['hidden B', '/progress/' + b, card(b, 'B', 'hidden')],
        ['wrong product', '/progress/' + b, card(b, 'B').replace('focus_points', 'open_mic')],
        ['loading B', '/progress/' + b, card(b, 'B').replace('data-review-state="review"', 'data-review-state="loading"')],
    ])('refuses %s', (_name, path, html) => {
        mount(path, html);
        expect(readBoundFocusReviewPairInPage(b)).toBeNull();
    });
});
