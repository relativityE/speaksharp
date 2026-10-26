// @vitest-environment node
/**
 * #1550 Codex P1 r4161811889: the after-Stop FillerBreakdown read is bounded AS A WHOLE. A stalled `locator.all()` or
 * a parameterless `isVisible()` (no action timeout in the deployed-live config) must end in a bounded `timeout`, never
 * consume the test's own timeout.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFillerBreakdown, type BreakdownPage } from '../live/helpers/rwtFillerBreakdown';

const never = <T>() => new Promise<T>(() => {});
const BOUND = 60;
const opts = { boundMs: BOUND, visibleTimeoutMs: 20, readTimeoutMs: 20, normaliseKey: (w: string) => w.trim().toLowerCase().replace(/\s+/g, '_') };

type Behaviour = { visible?: 'ok' | 'reject'; rows?: Array<{ word: string; count: string }> | 'never'; stats?: string; empty?: boolean | 'never' };
function stubPage(b: Behaviour): BreakdownPage {
    const row = (r: { word: string; count: string }) => ({
        getAttribute: async () => r.word,
        getByTestId: () => ({ innerText: async () => r.count }),
    });
    return {
        getByTestId: (id: string) => ({
            waitFor: () => (b.visible === 'reject' ? Promise.reject(new Error('Timeout')) : Promise.resolve()),
            all: () => (b.rows === 'never' ? never() : Promise.resolve((b.rows ?? []).map(row))),
            innerText: async () => (id === 'after-stats' ? b.stats ?? '' : ''),
            isVisible: () => (b.empty === 'never' ? never() : Promise.resolve(b.empty === true)),
        }),
    } as unknown as BreakdownPage;
}

describe('#1550 P1 r4161811889: the FillerBreakdown read is bounded as a whole', () => {
    it('RED on f32c8d19d: a never-resolving locator.all() ends in a bounded timeout, not the test timeout', async () => {
        const began = Date.now();
        await expect(readFillerBreakdown(stubPage({ rows: 'never' }), opts)).resolves.toEqual({ state: 'timeout' });
        expect(Date.now() - began).toBeLessThan(1_000);
    });

    it('a never-resolving parameterless isVisible() (empty-state check) is inside the same bound', async () => {
        await expect(readFillerBreakdown(stubPage({ rows: [], stats: '', empty: 'never' }), opts)).resolves.toEqual({ state: 'timeout' });
    });

    it('normal path: per-word counts and the headline the person sees', async () => {
        const read = await readFillerBreakdown(stubPage({ rows: [{ word: 'um', count: '×4' }, { word: 'uh', count: '×1' }], stats: '5 fillers · 120 words' }), opts);
        expect(read).toEqual({ state: 'read', perWord: { um: 4, uh: 1 }, headline: 5 });
    });

    it('no breakdown rendered → absent (the filler rows then FAIL visibly); a measured zero → headline 0', async () => {
        await expect(readFillerBreakdown(stubPage({ visible: 'reject' }), opts)).resolves.toEqual({ state: 'absent' });
        await expect(readFillerBreakdown(stubPage({ rows: [], stats: '', empty: true }), opts)).resolves.toEqual({ state: 'read', perWord: {}, headline: 0 });
    });

    it('spec shape: the spec reads FillerBreakdown only through the bounded helper', () => {
        const spec = readFileSync(path.resolve(__dirname, '../live/rwt-open-mic-first-session.live.spec.ts'), 'utf8');
        expect(spec).toMatch(/await readFillerBreakdown\(page, \{\s*boundMs: BREAKDOWN_READ_BOUND_MS/);
        expect(spec).not.toMatch(/getByTestId\('filler-breakdown-word'\)\.all\(\)/);
        expect(spec).not.toMatch(/getByTestId\('filler-breakdown-empty'\)\.isVisible\(\)/);
    });
});
