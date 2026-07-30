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

// Rejects local-file-URI home paths, bare absolute `/Users/<user>/` and `/home/<user>/` paths, and
// Windows drive-letter user-profile paths. (The literal forms live ONLY in this regex — never spelled
// out in prose in this file — so the guard file itself stays clean under its own scan.)
const PERSONAL_PATH = /file:\/\/\/(Users|home|root)\/|\/Users\/[A-Za-z0-9._-]+\/|\/home\/[A-Za-z0-9._-]+\/|[A-Za-z]:\\Users\\/;
// A portable web URL can legitimately contain a route segment like `/home/<name>/`. Strip http(s)
// URLs before the bare-path test so such links are not misread as local paths. `file://` URIs are
// NOT stripped — they are exactly the local-file leak this guard exists to catch.
const hasPersonalPath = (s) => PERSONAL_PATH.test(s.replace(/https?:\/\/\S+/g, ' '));

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

// A file is treated as binary (and skipped) if its head contains a NUL byte or it is very large.
const isProbablyBinary = (abs) => {
  try {
    if (statSync(abs).size > 4 * 1024 * 1024) return true;
    const head = readFileSync(abs).subarray(0, 8000);
    return head.includes(0);
  } catch {
    return true; // unreadable → skip rather than crash the guard
  }
};

describe('no personal / local-machine absolute paths in ANY tracked textual file', () => {
  const files = trackedTextFiles();

  it('every tracked source/script/config/workflow/doc file is free of personal machine paths', () => {
    const offenders = [];
    for (const f of files) {
      const abs = join(ROOT, f);
      if (isProbablyBinary(abs)) continue;
      const text = readFileSync(abs, 'utf8');
      text.split('\n').forEach((line, i) => {
        if (hasPersonalPath(line)) offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 160)}`);
      });
    }
    expect(offenders, `personal machine paths found in tracked files:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('the guard flags local machine paths and allows portable references', () => {
    // Fixtures are assembled from fragments so this test file carries no literal personal path and
    // therefore does not trip its own repo-wide scan, while still exercising the detector at runtime.
    const U = ['U', 's', 'e', 'r', 's'].join('');
    const H = ['h', 'o', 'm', 'e'].join('');
    const mustFlag = [
      `file:///${U}/alice/frontend/src/App.tsx`,        // local file-URI
      `/${U}/bob/speaksharp/scripts/run.sh`,             // bare macOS home
      `file:///${H}/carol/app/main.ts`,                  // local file-URI (linux)
      `/${H}/dave/project/y.ts`,                         // bare linux home
      `C:\\${U}\\erin\\repo\\z.ts`,                       // Windows user profile
      `stack trace at /${U}/frank/app/index.js:42`,      // embedded mid-line
    ];
    const mustAllow = [
      '/tmp/build-output',
      '$(pwd)/dist/app.js',
      '~/speaksharp/scripts/run.sh',
      './relative/path.ts',
      '/var/log/app.log',
      '/opt/service/bin',
      'https://github.com/relativityE/speaksharp/blob/d31102a8/frontend/src/App.tsx',
      // a portable web URL whose route contains a home/user segment is not a local machine path
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
