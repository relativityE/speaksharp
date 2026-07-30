import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

/**
 * Repository-wide guard: NO tracked textual file — source, scripts, config, workflows, docs, or
 * archives — may embed a contributor's personal/local-machine absolute path. That is a privacy +
 * portability leak (it reveals a developer's home directory and breaks on every other machine).
 *
 * This deliberately scans EVERY Git-tracked file (via `git ls-files`), not just Markdown, with
 * explicit exclusions for binary / generated / dependency artifacts. Portable references
 * (`/tmp`, `$(pwd)`, `~/…`, and http(s) URLs whose route merely contains a `home`/`Users` segment)
 * are allowed; only genuine local-machine absolute paths are rejected.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Rejects local-file-URI home paths, bare absolute `/Users/<user>/`, `/home/<user>/` and `/root/<…>`
// paths, and Windows drive-letter user-profile paths. (The literal forms live ONLY in this regex —
// never spelled out in prose in this file — so the guard file itself stays clean under its own scan.)
const PERSONAL_PATH = /file:\/\/\/(Users|home|root)\/|\/Users\/[A-Za-z0-9._-]+\/|\/home\/[A-Za-z0-9._-]+\/|\/root\/[A-Za-z0-9._-]|[A-Za-z]:\\Users\\/;
// A portable web URL can legitimately contain a route segment like `/home/<name>/`. Strip only the
// URL's scheme+host+PATH — stopping at `?`, whitespace, `)`, or a quote — so the URL PATH is exempt
// but a QUERY STRING is still scanned (a local home path smuggled into a `?path=` query cannot escape).
// `file://` URIs are NOT stripped — they are exactly the local-file leak this guard exists to catch.
const hasPersonalPath = (s) => PERSONAL_PATH.test(s.replace(/https?:\/\/[^\s?)'"]+/g, ' '));

// Binary / generated / dependency artifacts that are not meaningful to scan as text.
const BINARY_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|icns|pdf|zip|gz|tgz|bz2|7z|rar|woff2?|ttf|otf|eot|mp3|m4a|wav|ogg|mp4|webm|mov|avi|onnx|wasm|bin|node|exe|dll|so|dylib|class|jar|keystore|p12|pfx|snap)$/i;
const EXCLUDE_PATH = /(^|\/)(dist|build|coverage|out|\.next|node_modules)\//;
const isLockOrMap = (f) => /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|Cargo\.lock|poetry\.lock)$/.test(f)
  || /\.lock$/.test(f) || /\.min\.(js|css)$/.test(f) || /\.map$/.test(f);

const trackedTextFiles = () => {
  const out = execSync('git ls-files -z', { cwd: ROOT, maxBuffer: 128 * 1024 * 1024 })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  return out.filter((f) => !BINARY_EXT.test(f) && !EXCLUDE_PATH.test(f) && !isLockOrMap(f));
};

// Classify a candidate file. Only a genuine BINARY (NUL byte in the head) is silently skipped — that
// is correct, not a coverage gap. `unreadable` and `oversized` are NOT silently skipped: the test
// surfaces them so an unscanned textual file can never hide a personal path. The size cap is high
// (any real source/doc/config is far smaller) so `oversized` should be empty in practice.
const MAX_SCAN_BYTES = 25 * 1024 * 1024;
const classifyFile = (abs) => {
  let size;
  try { size = statSync(abs).size; } catch { return { kind: 'unreadable' }; }
  if (size > MAX_SCAN_BYTES) return { kind: 'oversized' };
  let buf;
  try { buf = readFileSync(abs); } catch { return { kind: 'unreadable' }; }
  if (buf.subarray(0, 8000).includes(0)) return { kind: 'binary' };
  return { kind: 'text', text: buf.toString('utf8') };
};

describe('no personal / local-machine absolute paths in ANY tracked textual file', () => {
  const files = trackedTextFiles();

  it('every tracked source/script/config/workflow/doc file is free of personal machine paths', () => {
    const offenders = [];
    const notScanned = []; // unreadable / oversized textual candidates — must be empty (no silent skips)
    for (const f of files) {
      const { kind, text } = classifyFile(join(ROOT, f));
      if (kind === 'binary') continue;               // genuinely binary — correctly skipped
      if (kind !== 'text') { notScanned.push(`${f} (${kind})`); continue; }
      text.split('\n').forEach((line, i) => {
        if (hasPersonalPath(line)) offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 160)}`);
      });
    }
    // Nothing textual may be silently skipped, and nothing may contain a personal path.
    expect(notScanned, `tracked files skipped without scanning:\n${notScanned.join('\n')}`).toEqual([]);
    expect(offenders, `personal machine paths found in tracked files:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('the guard flags local machine paths and allows portable references', () => {
    // Fixtures are assembled from fragments so this test file carries no literal personal path and
    // therefore does not trip its own repo-wide scan, while still exercising the detector at runtime.
    const U = ['U', 's', 'e', 'r', 's'].join('');
    const H = ['h', 'o', 'm', 'e'].join('');
    const R = ['r', 'o', 'o', 't'].join('');
    const mustFlag = [
      `file:///${U}/alice/frontend/src/App.tsx`,        // local file-URI
      `/${U}/bob/speaksharp/scripts/run.sh`,             // bare macOS home
      `file:///${H}/carol/app/main.ts`,                  // local file-URI (linux)
      `/${H}/dave/project/y.ts`,                         // bare linux home
      `/${R}/deploy/id_rsa`,                             // bare root home
      `C:\\${U}\\erin\\repo\\z.ts`,                       // Windows user profile
      `stack trace at /${U}/frank/app/index.js:42`,      // embedded mid-line
      // a local path smuggled into a URL QUERY string must still be caught (query is not stripped)
      `https://example.com/redirect?path=/${U}/grace/secret.txt`,
    ];
    const mustAllow = [
      '/tmp/build-output',
      '$(pwd)/dist/app.js',
      '~/speaksharp/scripts/run.sh',
      './relative/path.ts',
      '/var/log/app.log',
      '/opt/service/bin',
      'https://github.com/relativityE/speaksharp/blob/d31102a8/frontend/src/App.tsx',
      // a portable web URL whose PATH contains a home/user segment is not a local machine path
      `see https://example.com/${H}/alice/guide for details`,
      `[docs](https://docs.example.com/${U}/onboarding)`,
    ];
    expect(mustFlag.filter((s) => !hasPersonalPath(s)), 'guard MISSED a personal path').toEqual([]);
    expect(mustAllow.filter((s) => hasPersonalPath(s)), 'guard WRONGLY flagged a portable reference').toEqual([]);
  });

  it('scans a non-trivial number of tracked files (guard against an empty enumeration)', () => {
    expect(files.length).toBeGreaterThan(100);
  });
});
