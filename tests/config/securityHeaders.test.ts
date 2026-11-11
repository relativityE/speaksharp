import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/**
 * Security response headers for every route the site serves (outside code review: no CSP, HSTS, framing or referrer
 * policy on the general route; #1794: a restrictive CSP for /models/).
 *
 * Enforced now: HSTS, X-Frame-Options DENY, Referrer-Policy, and a narrow Content-Security-Policy (framing, <base>,
 * plugins) that cannot block any script, worker, model or network request.
 *
 * Report-only for now: the full fetch/script policy. The app loads blob: workers, WASM, Supabase, PostHog, Sentry and
 * remote model hosts, and index.html carries an inline release script whose hash changes every build, so the full
 * policy is observed before it is enforced.
 *
 * Effective headers are computed with the matcher Vercel's routing uses (path-to-regexp 6, strict, case-sensitive),
 * as tests/evidence/__tests__/modelPackageImport.test.ts does.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
type Header = { key: string; value: string };
type Rule = { source: string; headers: Header[] };
const rules = (JSON.parse(fs.readFileSync(path.resolve(HERE, '../../vercel.json'), 'utf8')) as { headers: Rule[] }).headers;

const fromMsw = createRequire(createRequire(import.meta.url).resolve('msw/package.json'));
const { pathToRegexp } = fromMsw('path-to-regexp') as { pathToRegexp: (s: string, k: unknown[], o: object) => RegExp };
const compiled = rules.map((rule, index) => ({ rule, index, regex: pathToRegexp(rule.source, [], { strict: true, sensitive: true, delimiter: '/' }) }));

/** Every value set for `key` on `pathname`, in rule order (a later rule's value is the one Vercel keeps). */
function valuesFor(pathname: string, key: string): string[] {
    return compiled.filter(({ regex }) => regex.test(pathname))
        .flatMap(({ rule }) => rule.headers)
        .filter(h => h.key.toLowerCase() === key.toLowerCase())
        .map(h => h.value);
}

function directives(policy: string): Map<string, string[]> {
    return new Map(policy.split(';').map(part => part.trim()).filter(Boolean).map(part => {
        const [name, ...values] = part.split(/\s+/);
        return [name.toLowerCase(), values];
    }));
}

const APP_PATHS = ['/', '/session', '/admin/ops-status', '/assets/main-abc123.js', '/api/health', '/sw.js', '/models/x/model.onnx'];

describe('security headers on every served path', () => {
    it.each(APP_PATHS)('%s carries HSTS, framing and referrer headers', pathname => {
        expect(valuesFor(pathname, 'Strict-Transport-Security')).toEqual(['max-age=63072000; includeSubDomains']);
        expect(valuesFor(pathname, 'X-Frame-Options')).toEqual(['DENY']);
        expect(valuesFor(pathname, 'Referrer-Policy')).toEqual(['strict-origin-when-cross-origin']);
    });

    it.each(APP_PATHS)('%s has an enforced CSP that forbids framing, <base> rewrites and plugins', pathname => {
        const policies = valuesFor(pathname, 'Content-Security-Policy');
        expect(policies.length).toBeGreaterThan(0);
        // Whichever matching rule Vercel keeps, the policy must hold these three.
        for (const policy of policies) {
            const d = directives(policy);
            expect(d.get('frame-ancestors')).toEqual(["'none'"]);
            expect(d.has('base-uri')).toBe(true);
            expect(d.get('object-src') ?? d.get('default-src')).toEqual(["'none'"]);
        }
    });

    it('enforces nothing on the general route that could block a script, worker, model or request', () => {
        const [policy] = valuesFor('/', 'Content-Security-Policy');
        const names = [...directives(policy).keys()].sort();
        expect(names).toEqual(['base-uri', 'frame-ancestors', 'object-src']);
    });

    it('keeps the cross-origin isolation headers unchanged', () => {
        expect(valuesFor('/', 'Cross-Origin-Opener-Policy')).toEqual(['same-origin']);
        expect(valuesFor('/', 'Cross-Origin-Embedder-Policy')).toEqual(['credentialless']);
    });
});

describe('report-only CSP for the whole app', () => {
    const [policy] = valuesFor('/', 'Content-Security-Policy-Report-Only');
    const d = directives(policy ?? '');

    it('is declared once, on the general route', () => {
        expect(valuesFor('/', 'Content-Security-Policy-Report-Only')).toHaveLength(1);
    });

    it("starts from 'self' and allows no inline or eval script", () => {
        expect(d.get('default-src')).toEqual(["'self'"]);
        expect(d.get('script-src')).not.toContain("'unsafe-inline'");
        expect(d.get('script-src')).not.toContain("'unsafe-eval'");
        expect(d.get('script-src')).toContain("'wasm-unsafe-eval'");
    });

    it('allows the blob: workers the transcription engines create', () => {
        expect(d.get('worker-src')).toEqual(expect.arrayContaining(["'self'", 'blob:']));
        expect(d.get('script-src')).toContain('blob:');
    });

    it.each([
        ['Supabase API', 'https://*.supabase.co'],
        ['Supabase realtime', 'wss://*.supabase.co'],
        ['PostHog', 'https://*.posthog.com'],
        ['Sentry ingest', 'https://*.ingest.us.sentry.io'],
        ['Hugging Face model hub', 'https://huggingface.co'],
        ['Hugging Face file CDN', 'https://*.hf.co'],
        ['Moonshine models', 'https://download.moonshine.ai'],
    ])('lets the app reach %s', (_name, origin) => {
        expect(d.get('connect-src')).toContain(origin);
    });

    it('denies frames, plugins and cross-origin form posts', () => {
        expect(d.get('frame-src')).toEqual(["'none'"]);
        expect(d.get('object-src')).toEqual(["'none'"]);
        expect(d.get('form-action')).toEqual(["'self'"]);
        expect(d.get('frame-ancestors')).toEqual(["'none'"]);
    });
});

describe('#1794: model assets are sandboxed', () => {
    it('gives /models/ responses a sandboxing CSP that comes after the general rule', () => {
        const general = compiled.find(({ rule }) => rule.source === '/(.*)')!;
        const models = compiled.find(({ rule }) => rule.source === '/models/(.*)')!;
        expect(models.index).toBeGreaterThan(general.index);
        const [policy] = models.rule.headers.filter(h => h.key === 'Content-Security-Policy').map(h => h.value);
        const d = directives(policy);
        expect(d.has('sandbox')).toBe(true);
        expect(d.get('default-src')).toEqual(["'none'"]);
    });

    it('still serves every model with nosniff', () => {
        expect(valuesFor('/models/x/model.onnx', 'X-Content-Type-Options')).toEqual(['nosniff']);
    });

    it('does not sandbox application documents', () => {
        for (const policy of valuesFor('/', 'Content-Security-Policy')) expect(directives(policy).has('sandbox')).toBe(false);
    });
});
