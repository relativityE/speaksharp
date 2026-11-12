/**
 * Review RETURN on 2611cce9: the take recorder in a REAL Chromium, across REAL navigations — the init script installs before the
 * parser creates a root (no page error), every Start press and persisted-id write is ordered within its own document, a
 * persisted id set and cleared in the same turn is still captured, and each take binds to exactly its own save.
 * Runs in the e2e lane, which has Playwright Chromium; it uses its own context and routes only, never the app under test.
 */
import { expect, test } from '@playwright/test';
import { HarnessParityTap, probeSaveIsolationRow } from '../live/helpers/rwtHarnessParity';

const page = (buttons: string[]) => `<!doctype html><html><body>${buttons.map((b) => `<button data-testid="${b}">${b}</button>`).join('')}</body></html>`;
const U = (n: number) => `0b9c5e2a-1111-4222-8333-44445555666${n}`;
const L = (n: number) => `1b9c5e2a-1111-4222-8333-44445555666${n}`;
const save = () => (args: { id: string; clear: boolean }) => {
    const root = document.documentElement;
    root.setAttribute('data-session-persisted', 'true');
    root.setAttribute('data-session-persisted-id', args.id);
    if (args.clear) { root.removeAttribute('data-session-persisted'); root.removeAttribute('data-session-persisted-id'); }
};

test.describe('take recorder in a real browser', () => {
    test('binds each of four takes across three documents, including a same-turn set-and-clear, with no page error', async ({ browser }) => {
        test.setTimeout(60_000);
        const context = await browser.newContext();
        await context.route('http://ct-recorder.test/**', (route) => {
            const path = new URL(route.request().url()).pathname;
            const buttons = path === '/first' ? ['mic-download'] : path === '/again' ? ['mic-start', 'verdict-practice-again'] : ['mic-start'];
            return route.fulfill({ status: 200, contentType: 'text/html', body: page(buttons) });
        });
        const tap = new HarnessParityTap();
        await tap.attach(context);
        const p = await context.newPage();
        const errors: string[] = [];
        p.on('pageerror', (e) => errors.push(e.message));
        // a save BEFORE any press in a document is a stray — proven separately below; here, each document presses first
        await p.goto('http://ct-recorder.test/first');
        await p.getByTestId('mic-download').click();
        await p.evaluate(save(), { id: U(1), clear: false });
        await p.goto('http://ct-recorder.test/again');
        await p.getByTestId('mic-start').click();
        await p.evaluate(save(), { id: U(2), clear: true });          // set and cleared in the same turn: still captured
        await p.getByTestId('verdict-practice-again').click();
        await p.evaluate(save(), { id: U(3), clear: false });
        await p.goto('http://ct-recorder.test/next');
        await p.getByTestId('mic-start').click();
        await p.evaluate(save(), { id: U(4), clear: false });
        await p.waitForTimeout(200);                                         // let the exposed-binding calls land
        expect(errors).toEqual([]);
        const b = tap.takeBindings();
        expect(b).toEqual({ takes: [{ control: 'mic-download', ids: [U(1)] }, { control: 'mic-start', ids: [U(2)] },
            { control: 'verdict-practice-again', ids: [U(3)] }, { control: 'mic-start', ids: [U(4)] }], stray: [] });
        const rows: Array<{ verdict: string }> = [];
        const admin = { from: () => ({ select: () => ({ eq: () => ({ eq: async () => ({ data: [1, 2, 3, 4].map((n) => ({ id: U(n), lease_id: L(n) })), error: null }) }) }) }) };
        await probeSaveIsolationRow({ row: (_s, verdict) => rows.push({ verdict }) }, admin as never, 'u', [U(1), U(2)], b, [1, 2, 3, 4].map(L), 4);
        expect(rows).toEqual([{ verdict: 'PASS' }]);
        await context.close();
    });

    test('CASUALTY: the review repeat saves nothing and the next document surfaces a stray plus its own save → HOLD, never PASS', async ({ browser }) => {
        test.setTimeout(60_000);
        const context = await browser.newContext();
        await context.route('http://ct-recorder.test/**', (route) => route.fulfill({ status: 200, contentType: 'text/html',
            body: page(['mic-download', 'mic-start', 'verdict-practice-again']) }));
        const tap = new HarnessParityTap();
        await tap.attach(context);
        const p = await context.newPage();
        await p.goto('http://ct-recorder.test/a');
        await p.evaluate(save(), { id: U(9), clear: false });          // before any press in this document: a stray save
        await p.getByTestId('mic-download').click();
        await p.evaluate(save(), { id: U(1), clear: false });
        await p.goto('http://ct-recorder.test/b');
        await p.getByTestId('mic-start').click();
        await p.evaluate(save(), { id: U(2), clear: false });
        await p.getByTestId('verdict-practice-again').click();               // saves nothing
        await p.goto('http://ct-recorder.test/c');
        await p.getByTestId('mic-start').click();
        await p.evaluate(save(), { id: U(5), clear: false });
        await p.evaluate(save(), { id: U(4), clear: false });
        await p.waitForTimeout(200);
        const b = tap.takeBindings();
        expect(b.stray).toEqual([U(9)]);
        expect(b.takes.map((t) => t.ids.length)).toEqual([1, 1, 0, 2]);
        const rows: Array<{ verdict: string }> = [];
        const admin = { from: () => ({ select: () => ({ eq: () => ({ eq: async () => ({ data: [[1, 1], [2, 2], [5, 4], [4, 4]].map(([n, l]) => ({ id: U(n), lease_id: L(l) })), error: null }) }) }) }) };
        await probeSaveIsolationRow({ row: (_s, verdict) => rows.push({ verdict }) }, admin as never, 'u', [U(1), U(2)], b, [1, 2, 3, 4].map(L), 4);
        expect(rows).toEqual([{ verdict: 'FAIL' }]);                          // the stray decides first
        await probeSaveIsolationRow({ row: (_s, verdict) => rows.push({ verdict }) }, admin as never, 'u', [U(1), U(2)], { ...b, stray: [] }, [1, 2, 3, 4].map(L), 4);
        expect(rows[1]).toEqual({ verdict: 'FAIL' });                         // without it, the review repeat's recording saved nothing
        await context.close();
    });
});
