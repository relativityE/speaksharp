// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Regression guard for the stale-chunk P0: the Sentry Vite plugin must NOT inject the release into the
 * bundle. Its default injection writes `SENTRY_RELEASE={id:<commit SHA>}` into EVERY chunk, which rotates
 * every chunk's content hash on every deploy — so a long-lived tab 404s on a rotated-away chunk (the crash).
 * The release must instead be set at RUNTIME (Sentry.init from window.__APP_RELEASE__), preserving release
 * attribution while keeping chunks SHA-free + stable across deploys. Source maps still upload (debug IDs).
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const viteConfig = read('../../frontend/vite.config.mjs');
const mainTsx = read('../../frontend/src/main.tsx');

describe('Sentry release: no build-time injection, runtime attribution', () => {
  it('the Sentry Vite plugin disables release injection (inject: false)', () => {
    expect(viteConfig, 'sentryVitePlugin must be configured with release.inject = false').toMatch(
      /release:\s*\{[^}]*inject:\s*false/,
    );
  });

  it('does NOT define-inline the release SHA into the JS bundle', () => {
    // The release id is injected into index.html as window.__APP_RELEASE__, never into `define`.
    expect(viteConfig).not.toMatch(/define:\s*\{[^}]*__BUILD_ID__/);
    expect(viteConfig).toMatch(/window\.__APP_RELEASE__=/); // the index.html inline-injection plugin
  });

  it('Sentry.init sets the release at runtime from window.__APP_RELEASE__', () => {
    expect(mainTsx, 'Sentry.init must set release from the runtime global').toMatch(
      /release:\s*typeof window[^\n]*window\.__APP_RELEASE__/,
    );
  });
});
