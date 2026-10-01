// @vitest-environment node
/**
 * #1258 (PO 2026-10-01): every Session-page locator the RWT journeys read must exist in the RENDERED Session tree.
 *
 * Diagnostic run 36930648785 showed the "Open Mic freeze" was the RWT spec waiting, with no action timeout, for
 * `filler-count-value`: an element only the retired `FillerWordsCard` rendered on the Session page. The id still
 * existed in the codebase (the Analytics dashboard renders it), so a repo-wide "does this test id exist?" check would
 * have passed. This guard is scoped to what the Session page can actually render.
 *
 * Rendered Session tree = every module reachable by static or dynamic import from `pages/SessionPage.tsx`. Its
 * rendered ids are the `data-testid` literals in those modules (including string branches inside `data-testid={…}`),
 * `testId="…"` props, and `TEST_IDS.*` constants they reference.
 * Read locators = the `getByTestId('…')` literals inside the Session-phase steps of the two RWT journeys (Open Mic
 * rows 3–5 up to the Analytics row; Focus Points rows 10–11).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'frontend/src');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

function resolveImport(fromFile: string, spec: string): string | null {
    let base: string;
    if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2));
    else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
    else return null; // packages are not the Session tree
    for (const candidate of [base, `${base}.tsx`, `${base}.ts`, path.join(base, 'index.tsx'), path.join(base, 'index.ts')]) {
        if (existsSync(candidate) && /\.(tsx?)$/.test(candidate)) return candidate;
    }
    return null;
}

/** Every product module reachable from SessionPage (tests and type-only files excluded). */
export function sessionTreeFiles(): string[] {
    const start = path.join(SRC, 'pages/SessionPage.tsx');
    const seen = new Set<string>([start]);
    const queue = [start];
    const IMPORT = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
    while (queue.length) {
        const file = queue.pop()!;
        const text = readFileSync(file, 'utf8');
        for (const m of text.matchAll(IMPORT)) {
            const target = resolveImport(file, m[1] ?? m[2]);
            if (!target || seen.has(target) || /__tests__|\.test\.|\.d\.ts$/.test(target)) continue;
            seen.add(target);
            queue.push(target);
        }
    }
    return [...seen];
}

/** Test ids those modules can render. */
export function renderedTestIds(files: string[]): Set<string> {
    const testIds = read('frontend/src/constants/testIds.ts');
    const constant = new Map([...testIds.matchAll(/^\s+([A-Z0-9_]+):\s*'([^']+)'/gm)].map((m) => [m[1], m[2]]));
    const ids = new Set<string>();
    for (const file of files) {
        const text = readFileSync(file, 'utf8');
        for (const m of text.matchAll(/data-testid="([^"]+)"/g)) ids.add(m[1]);
        for (const m of text.matchAll(/testId="([^"]+)"/g)) ids.add(m[1]);
        for (const m of text.matchAll(/data-testid=\{([^}]*)\}/g)) for (const s of m[1].matchAll(/'([^']+)'|"([^"]+)"/g)) ids.add(s[1] ?? s[2]);
        for (const m of text.matchAll(/TEST_IDS\.([A-Z0-9_]+)/g)) { const v = constant.get(m[1]); if (v) ids.add(v); }
    }
    return ids;
}

/** `getByTestId` literals between two step titles of a journey file. */
export function readLocators(rel: string, fromStep: string, toStep: string): string[] {
    const text = read(rel);
    const from = text.indexOf(fromStep);
    const to = text.indexOf(toStep, from + 1);
    if (from < 0 || to < 0) throw new Error(`${rel}: step markers not found (${fromStep} … ${toStep})`);
    return [...new Set([...text.slice(from, to).matchAll(/getByTestId\(\s*['"`]([^'"`$]+)['"`]\s*\)/g)].map((m) => m[1]))];
}

const SESSION_PHASES = [
    { journey: 'Open Mic', rel: 'tests/live/rwt-open-mic-first-session.live.spec.ts', from: "test.step('row 3 —", to: "test.step('row 6 —" },
    { journey: 'Focus Points', rel: 'tests/live/helpers/rwtFocusPointsJourney.ts', from: "test.step('row 10 —", to: "test.step('Products menu opened on the session page" },
];

describe('#1258 RWT Session-page locators exist in the rendered Session tree', () => {
    const files = sessionTreeFiles();
    const rendered = renderedTestIds(files);

    it('the Session tree is the real one: it reaches the live transcript and the after-state breakdown, not the retired card', () => {
        const rel = files.map((f) => path.relative(SRC, f));
        expect(rel).toEqual(expect.arrayContaining(['pages/SessionPage.tsx', 'components/session/SessionOverhaulView.tsx', 'components/session/LiveTranscript.tsx', 'components/session/FillerBreakdown.tsx']));
        expect(rel).not.toContain('components/session/FillerWordsCard.tsx');
        expect(rendered.has('live-filler')).toBe(true);
    });

    it.each(SESSION_PHASES)('every Session-phase locator the $journey journey reads is rendered on the Session page', ({ rel, from, to }) => {
        const locators = readLocators(rel, from, to);
        expect(locators.length).toBeGreaterThan(0);
        expect(locators.filter((id) => !rendered.has(id))).toEqual([]);
    });

    it('CASUALTY: the retired filler-count-value is NOT a Session-page element (it renders only on Analytics)', () => {
        expect(rendered.has('filler-count-value')).toBe(false);
        expect(renderedTestIds([path.join(SRC, 'components/AnalyticsDashboard.tsx')]).has('filler-count-value')).toBe(true);
    });
});
