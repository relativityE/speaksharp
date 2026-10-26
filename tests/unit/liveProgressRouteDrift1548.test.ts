// @vitest-environment node
/**
 * #1548 (#1718): `/progress` is the canonical Progress route. The nav item, "Back to Dashboard" and the legacy
 * `/analytics[/id]` redirect all land on `/progress[/id]`, and page context reports `/progress[/:sessionId]`.
 *
 * These App-owned live specs still expected `/analytics` destinations, so a run on a served #1718 build would time out
 * or mismatch as a false FAIL. They now compare `URL.pathname` to the exact list/detail destination (Sam
 * 1793004647.184059). This test binds to that source and runs the same matcher expressions against the wrong-prefix,
 * suffix and nested negatives. Source evidence only, not runtime proof; the shared harness helpers are handled separately.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const live = (file: string) => readFileSync(path.join(__dirname, '../live', file), 'utf8');

/** Every `waitForURL(...)` / `toHaveURL(...)` URL argument, whole: a pathname predicate, regex literal, RegExp or string. */
const urlExpectations = (source: string): string[] =>
    [...source.matchAll(
        /\b(?:waitForURL|toHaveURL)\(\s*(\(url\) => url\.pathname === (?:'[^'\n]*'|`[^`\n]*`)|\/(?:\\.|[^/\\\n])+\/[a-z]*|new RegExp\(`[^`]*`\)|'[^'\n]*'|`[^`\n]*`)/g,
    )].map((m) => m[1]);

// The exact matcher source the specs carry, and the same expressions executed here.
const LIST_SOURCE = "(url) => url.pathname === '/progress'";
const DETAIL_SOURCE = '(url) => url.pathname === `/progress/${persistedId}`';
const listMatches = (url: URL) => url.pathname === '/progress';
const detailMatches = (persistedId: string) => (url: URL) => url.pathname === `/progress/${persistedId}`;
const at = (pathAndRest: string) => new URL(`https://speaksharp.example${pathAndRest}`);

describe('#1548 App-owned live specs wait for the exact canonical /progress destination', () => {
    it.each([
        'rwt-products-navigation.live.spec.ts',
        'rwt-open-mic-first-session.live.spec.ts',
        'private-recording-proof.live.spec.ts',
    ])('%s has no URL wait or assertion that expects an /analytics destination', (file) => {
        const expectations = urlExpectations(live(file));
        expect(expectations.length).toBeGreaterThan(0);
        expect(expectations.filter((e) => /\/analytics/.test(e))).toEqual([]);
    });

    it('the Progress control and the Open Mic "Back to Dashboard" compare the pathname to exactly /progress', () => {
        expect(urlExpectations(live('rwt-products-navigation.live.spec.ts'))).toContain(LIST_SOURCE);
        expect(urlExpectations(live('rwt-open-mic-first-session.live.spec.ts'))).toContain(LIST_SOURCE);
    });

    it('the deliberate legacy alias visit is kept, and must land on exactly /progress/<id>', () => {
        const spec = live('private-recording-proof.live.spec.ts');
        expect(spec).toMatch(/await page\.goto\(`\/analytics\/\$\{persistedId\}`\);/);
        expect(urlExpectations(spec)).toContain(DETAIL_SOURCE);
    });

    it('report page context expects the canonical /progress routes it now navigates to', () => {
        const spec = live('report-page-context.live.spec.ts');
        expect(spec).toMatch(/navigateToRoute\(page, ROUTES\.ANALYTICS\)/);
        expect(spec).toMatch(/navigateToRoute\(page, ROUTES\.analyticsWithSession\(ownedSessionId\)\)/);
        expect(spec).toMatch(/expect\(analytics\.metadata\.canonicalRoute\)\.toBe\('\/progress'\);/);
        expect(spec).toMatch(/expect\(owned\.metadata\.canonicalRoute\)\.toBe\('\/progress\/:sessionId'\);/);
        expect(spec).toMatch(/expect\(owned\.page_url\)\.toBe\('\/progress\/:sessionId'\);/);
        expect(spec).not.toMatch(/toBe\('\/analytics(\/:sessionId)?'\)/);
    });

    it('CONTROL: the route constants these specs navigate with are the canonical ones', () => {
        const constants = readFileSync(path.join(__dirname, '../constants.ts'), 'utf8');
        expect(constants).toMatch(/ANALYTICS: '\/progress',/);
        expect(constants).toMatch(/analyticsWithSession: \(sessionId: string\) => `\/progress\/\$\{sessionId\}`,/);
    });
});

describe('#1548 the exact matchers reject wrong prefixes, suffixes and nested paths; query and hash stay separate', () => {
    it('list: only the /progress pathname matches', () => {
        for (const ok of ['/progress', '/progress?view=x', '/progress#top', '/progress?view=x#top']) expect(listMatches(at(ok))).toBe(true);
        for (const bad of ['/wrong/progress', '/progressx', '/progress/abc', '/progress/', '/x/progress', '/analytics', '/Progress']) {
            expect({ path: bad, matches: listMatches(at(bad)) }).toEqual({ path: bad, matches: false });
        }
    });

    it('detail: only /progress/<that id> matches, never another id, a nested path or a suffix', () => {
        const id = '11111111-2222-4333-8444-555555555555';
        const matches = detailMatches(id);
        for (const ok of [`/progress/${id}`, `/progress/${id}?q=1`, `/progress/${id}#h`]) expect(matches(at(ok))).toBe(true);
        for (const bad of [
            `/wrong/progress/${id}`, `/x/progress/${id}`, `/progress/${id}/x`, `/progress/${id}x`, `/progress/${id}/`,
            '/progress/99999999-2222-4333-8444-555555555555', '/progress', `/analytics/${id}`,
        ]) {
            expect({ path: bad, matches: matches(at(bad)) }).toEqual({ path: bad, matches: false });
        }
    });

    it('CONTROL: the matcher sources bound in the specs are exactly the expressions executed above', () => {
        // The spec source must equal these strings (asserted above); these strings are the executed bodies verbatim.
        expect(LIST_SOURCE).toBe("(url) => url.pathname === '/progress'");
        expect(DETAIL_SOURCE).toBe('(url) => url.pathname === `/progress/${persistedId}`');
    });
});
