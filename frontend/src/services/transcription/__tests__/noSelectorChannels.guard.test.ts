/**
 * #1263 — REPOSITORY-WIDE GUARD: model selection has exactly three authorities.
 *
 *   1. the typed config file, for normal selection;
 *   2. the one-way remote safety kill, which can only force v2;
 *   3. the internal-build in-page switch, for the human comparison.
 *
 * Nothing else. In particular no URL parameter, no localStorage key and no window global may influence
 * which model runs, in ANY environment — a dev/test gate is not sufficient, because `?privateModel=`
 * shipped with no gate at all and worked on the production site, and because these parameter names
 * disclose internal engine builds, devices and decoder precisions to anyone who reads a URL.
 *
 * This scans PRODUCTION SOURCE with comments stripped, so the retirement notes that explain the ban do
 * not themselves trip it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { resolvePrivateModel } from '../utils/privateModelFlag';
import { PRIV_STT_MODELS } from '../sttConstants';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SRC = (() => {
    let dir = dirname(new URL(import.meta.url).pathname);
    for (let i = 0; i < 12; i += 1) {
        try { if (statSync(join(dir, 'frontend', 'src')).isDirectory()) return join(dir, 'frontend', 'src'); } catch { /* keep walking */ }
        dir = dirname(dir);
    }
    throw new Error('frontend/src not found');
})();

/**
 * The retired parameter/key NAMES. Matched only inside a READ — `.get('x')` or `getItem('x')` — not as
 * bare identifiers, because several are also legitimate internal names: `v4Variant` is a real field on
 * `PrivateRuntimeDecision`, and `privateModelReady` is a service flag. Banning the bare word would
 * force those to be renamed to satisfy a guard, which is how a guard starts being worked around.
 */
const BANNED_PARAMS = [
    'privateEngine', 'privateModel',
    'v4Device', 'v4Variant', 'v4DecoderDtype', 'v4NoWorker', 'v4ForceAuto',
    'speaksharp.private.engine', 'speaksharp.v4.device', 'speaksharp.v4.variant',
    'speaksharp.v4.decoderDtype', 'speaksharp.v4.noWorker', 'speaksharp.v4.forceAuto',
];

/** These are unambiguous: they exist only as selection channels, so a bare mention is a regression. */
const BANNED_TOKENS = ['__PRIVATE_MODEL__', 'speaksharp.private.engine', 'speaksharp.v4.'];

function productionFiles(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name === '__tests__' || e.name === '__mocks__' || e.name === 'mocks') continue;
            productionFiles(p, out);
        } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.|\.spec\./.test(e.name)) {
            out.push(p);
        }
    }
    return out;
}

/** Strip line and block comments so a retirement NOTE never counts as a usage. */
function code(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
        .join('\n');
}

describe('no retired model-selection channel exists in production source', () => {
    const files = productionFiles(SRC);

    it('NON-VACUITY: the scan actually reads the production tree', () => {
        expect(files.length).toBeGreaterThan(100);
    });

    it('CASUALTY: no window global or storage key for model selection survives', () => {
        const offenders: string[] = [];
        for (const f of files) {
            const body = code(readFileSync(f, 'utf8'));
            for (const token of BANNED_TOKENS) {
                if (body.includes(token)) offenders.push(`${f.slice(SRC.length + 1)} :: ${token}`);
            }
        }
        expect(offenders.sort()).toEqual([]);
    });

    it('CASUALTY: nothing READS a selection value from the query string or storage', () => {
        const offenders: string[] = [];
        for (const f of files) {
            const body = code(readFileSync(f, 'utf8'));
            for (const m of body.matchAll(/(?:\.get|getItem)\(\s*'([a-zA-Z0-9_.]+)'\s*\)/g)) {
                if (BANNED_PARAMS.includes(m[1])) offenders.push(`${f.slice(SRC.length + 1)} :: ${m[1]}`);
            }
        }
        expect(offenders.sort()).toEqual([]);
    });

    it('NON-VACUITY: the read-scan matches a planted selector read', () => {
        // Proves the regex actually fires, so an empty offender list means "clean", not "never looked".
        const planted = `const x = new URLSearchParams(s).get('privateModel');`;
        const hits = [...planted.matchAll(/(?:\.get|getItem)\(\s*'([a-zA-Z0-9_.]+)'\s*\)/g)]
            .filter((m) => BANNED_PARAMS.includes(m[1]));
        expect(hits).toHaveLength(1);
    });
});

/**
 * THE ONE PLACE the retired names may still be written down.
 *
 * Proving a channel is inert requires naming it, and if every suite that wants that proof names it
 * again, the vocabulary spreads back through the codebase — which is half of why the parameters were a
 * disclosure problem. So the inertness proofs live here, beside the ban that makes them true, and
 * nowhere else.
 */
describe('the retired channels are inert, proven in the fixture that owns their names', () => {
    interface ModelWindow { __PRIVATE_MODEL__?: string }
    afterEach(() => {
        window.history.replaceState({}, '', '/');
        delete (window as unknown as ModelWindow).__PRIVATE_MODEL__;
        window.localStorage.clear();
    });

    it('CASUALTY: no retired URL parameter changes the resolved model', () => {
        window.history.replaceState({}, '', `?${BANNED_PARAMS.map((k) => `${k}=whisper-small.en`).join('&')}`);
        expect(resolvePrivateModel()).toBe(PRIV_STT_MODELS.DEFAULT);
    });

    it('CASUALTY: no retired storage key changes the resolved model', () => {
        for (const k of BANNED_PARAMS) window.localStorage.setItem(k, 'whisper-small.en');
        expect(resolvePrivateModel()).toBe(PRIV_STT_MODELS.DEFAULT);
    });

    it('CASUALTY: the window global changes nothing, even with a VALID candidate id', () => {
        const other = Object.keys(PRIV_STT_MODELS.CANDIDATES).find((k) => k !== PRIV_STT_MODELS.DEFAULT);
        expect(other, 'need a second registered candidate for this to mean anything').toBeTruthy();
        (window as unknown as ModelWindow).__PRIVATE_MODEL__ = other;
        expect(resolvePrivateModel()).toBe(PRIV_STT_MODELS.DEFAULT);
    });
});
