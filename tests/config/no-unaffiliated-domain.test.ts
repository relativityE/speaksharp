import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * #1260 — zero-reference scanner for the unaffiliated third-party domain.
 *
 * The canonical product host is `speaksharp-public.vercel.app`. The unaffiliated `speaksharp.ai` /
 * subdomains must never appear in tracked text, in ANY obfuscated form: case variants, subdomains, an
 * HTML-encoded dot (`&#46;` / `&#x2e;`), a percent-encoded dot (`%2e`), or a source-escaped dot (`\.`).
 * Our hyphenated Vercel host (`speaksharp-public…`) never matches — the pattern requires a dot-form
 * immediately after `speaksharp`.
 */
const FORBIDDEN = /speaksharp(?:\.|&#0*46;|&#x0*2e;|%2e|\\\.)ai/i;

const ROOT = path.resolve(__dirname, '../..');
const SELF = 'tests/config/no-unaffiliated-domain.test.ts';
// Untracked/vendored trees + large model data that can never carry the domain (kept out for speed).
const EXCLUDE_PREFIXES = ['test-support/worktrees/', 'frontend/public/models/', 'frontend/dist-e2e/'];
const BINARY = /\.(png|jpe?g|gif|ico|svg|woff2?|ttf|eot|wasm|bin|onnx|mp3|wav|pdf|zip)$/i;

function trackedTextFiles(): string[] {
  return execSync('git ls-files', { cwd: ROOT, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })
    .split('\n')
    .filter(Boolean)
    .filter((f) => f !== SELF)
    .filter((f) => !EXCLUDE_PREFIXES.some((p) => f.startsWith(p)))
    .filter((f) => !BINARY.test(f));
}

describe('#1260 — no unaffiliated-domain references in tracked text', () => {
  it('every tracked file is free of the domain (any case / subdomain / HTML / percent / escaped-dot form)', () => {
    const offenders: string[] = [];
    for (const f of trackedTextFiles()) {
      let content: string;
      try {
        content = readFileSync(path.join(ROOT, f), 'utf8');
      } catch {
        continue;
      }
      if (FORBIDDEN.test(content)) {
        const idx = content.split('\n').findIndex((l) => FORBIDDEN.test(l));
        offenders.push(`${f}:${idx + 1}`);
      }
    }
    expect(offenders, `unaffiliated-domain references found:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('the scanner flags every obfuscation variant (negative fixtures)', () => {
    for (const variant of [
      'https://speaksharp.ai',
      'https://SpeakSharp.AI',
      'https://www.speaksharp.ai',
      'https://api.speaksharp.ai',
      'speaksharp&#46;ai',
      'speaksharp&#x2e;ai',
      'speaksharp%2eai',
      'speaksharp\\.ai',
    ]) {
      expect(FORBIDDEN.test(variant), `scanner should flag: ${variant}`).toBe(true);
    }
  });

  it('the scanner does NOT flag the canonical hyphenated Vercel host or reserved example domains', () => {
    for (const ok of [
      'https://speaksharp-public.vercel.app',
      'https://speaksharp-public-git-main-team.vercel.app',
      'https://speaksharp-public.vercel.app.evil.com',
      'https://example.com',
    ]) {
      expect(FORBIDDEN.test(ok), `scanner should NOT flag: ${ok}`).toBe(false);
    }
  });
});
