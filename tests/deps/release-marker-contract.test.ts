// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { executableText } from './lib/source-text';
import { parseReleaseFromHtml } from '../../frontend/src/services/staleClientGuard';

// #1314 — COUPLING test between the build's release injection and the stale-client guard that reads it.
//
// The guard's whole value is that it fires. If the vite `speaksharp-release-inject` plugin ever changes the shape
// of what it writes (quoting, spacing, a different global), the guard would not throw — it would quietly return
// `unknown` forever and the "0 silent stale-client execution" bar would be unenforced with nothing going red.
// That is the exact failure mode of the old harness's dead selectors, so it gets a test rather than a comment.
//
// This asserts the producer and the consumer against each other: the literal the plugin emits must be the literal
// the parser accepts.

const REPO_ROOT = path.resolve(__dirname, '../..');
const viteConfigRaw = readFileSync(path.join(REPO_ROOT, 'frontend/vite.config.mjs'), 'utf8');
// AUDITED (#1314): every assertion below must read CODE, not documentation. Asserting over the raw file lets a
// commented-out plugin keep this suite green — the same defect already found twice in this PR (the
// define-inlined release check matched its own explanatory comment; the pipefail guard was satisfied by a
// comment mentioning pipefail). One shared helper, applied here rather than re-derived.
const viteConfig = executableText(viteConfigRaw, 'slash');

describe('#1314 — the build still injects the marker the guard reads', () => {
  it('has the release-inject plugin wired', () => {
    expect(viteConfig).toContain('speaksharp-release-inject');
    expect(viteConfig).toContain('transformIndexHtml');
  });

  it('writes the global the guard looks for', () => {
    expect(viteConfig).toContain('window.__APP_RELEASE__=');
  });

  it('the guard parses the EXACT string the plugin produces', () => {
    // Reproduce the plugin's own construction: `window.__APP_RELEASE__=${JSON.stringify(releaseId)};`
    const releaseId = '307462931905ddcaac1eac303821c4291b7e0257';
    const emitted = `window.__APP_RELEASE__=${JSON.stringify(releaseId)};`;
    expect(parseReleaseFromHtml(`<head><script>${emitted}</script></head>`)).toBe(releaseId);
  });

  it('injects into the HEAD, so the marker is present before the app bundle runs', () => {
    // If it moved to body-end, a slow/failed bundle could leave the marker unreadable at check time.
    expect(viteConfig).toMatch(/injectTo:\s*'head-prepend'/);
  });

  it('keeps the release OUT of a JS define, so the marker cannot be stale-cached with a chunk', () => {
    // A `define`-inlined SHA would rotate chunk hashes AND ship the id inside the very bundle whose freshness
    // we are testing — the check would then compare a stale value against itself.
    //
    // Assert against CODE, not prose: the config's `define` block carries a comment explaining this very rule,
    // so a naive "does __APP_RELEASE__ appear near define:" check passes/fails on the documentation instead of
    // the behaviour. Strip comments first, then look for it used as a define KEY.
    expect(viteConfig).not.toMatch(/['"`]?__APP_RELEASE__['"`]?\s*:/);
  });
});
