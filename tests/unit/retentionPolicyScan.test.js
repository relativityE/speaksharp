// @vitest-environment node
//
// #1436 — STRUCTURAL POLICY SCAN.
//
// The product retains the newest transcript only. Correcting that touched a migration, two workflows,
// two E2E server simulations, a live journey and several test suites, and the failure mode of such a
// sweep is not a loud one: a single surviving `slice(2)` or `rn > 2` reinstates newest-two in one
// surface while every other surface says newest-one, and nothing fails.
//
// So this walks the tree and fails on any ACTIVE newest-two implementation. It matches implementation
// tokens, never prose — a comment contrasting the new policy with the old one is documentation, and a
// scan that banned the words would push authors into deleting the explanation instead of the code.
//
// Historical files are allowed, but they must SAY SO. Each allowlist entry is checked for an explicit
// historical marker near the top of the file, so "this is old on purpose" is a claim the file makes
// about itself rather than one this list makes on its behalf.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();

/** Implementation tokens. Each one, on its own, IS newest-two behaviour. */
const NEWEST_TWO_TOKENS = [
  { token: 'newest_two_v1', why: 'the superseded policy marker' },
  { token: 'expire_transcripts_newest_two', why: 'the superseded mutation' },
  { token: 'users_over_two_after', why: 'the superseded preflight aggregate' },
  { token: 'rank_gt2_eligible', why: 'the superseded candidate aggregate' },
  { token: 'rn > 2', why: 'the superseded rank threshold' },
  { token: 'retained.slice(2)', why: 'a server simulation retaining two transcripts' },
];

/**
 * Files that legitimately contain newest-two because they ARE the history, or because their whole
 * purpose is to remove it. Every entry must carry the marker below.
 */
const HISTORICAL = new Map([
  ['backend/supabase/migrations/20260803000000_transcript_retention_newest_two.sql', 'applied migration — immutable history'],
  ['backend/supabase/migrations/20260804000000_transcript_retention_converge_on_save.sql', 'applied migration — immutable history'],
  ['backend/supabase/migrations/20260805000000_transcript_retention_preflight.sql', 'applied migration — immutable history'],
  ['backend/supabase/migrations/20260908120000_transcript_retention_newest_one.sql', 'the correction — names the old function in order to DROP it'],
  ['tests/db/transcript-retention-newest-two.integration.test.ts', 'proves the superseded contract in isolation'],
  ['tests/db/retention-contract-shipped.integration.test.ts', 'proves the superseded contract in isolation'],
  ['tests/db/transcript-retention-preflight.integration.test.ts', 'proves the superseded preflight in isolation'],
  ['tests/db/transcript-retention-converge-on-save.integration.test.ts', 'proves the superseded coordinator in isolation'],
  ['tests/db/run-transcript-retention-preflight-realpg.sh', 'real-PG runner for the superseded preflight'],
  ['tests/db/transcript-retention-newest-one.integration.test.ts', 'the correction suite — asserts the old objects are gone'],
  ['tests/unit/retentionPolicyScan.test.js', 'this scan'],
]);

/** A historical file must declare itself. Applied migrations are immutable, so they are exempt. */
const MARKER = /HISTORICAL|SUPERSEDED|immutable history/i;

// `apt-bundle` is a CI-only cache directory whose subdirectories are root-owned; reading it raises
// EACCES on the runner and nowhere else, which is exactly the kind of failure that only ever appears
// after a push. The skip is the specific defence; the try/catch below is the general one.
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', 'test-results', 'playwright-report', '.next', '.turbo', 'apt-bundle']);
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts', '.cjs', '.sql', '.yml', '.yaml', '.sh'];

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const abs = join(dir, entry);
    let st;
    try { st = statSync(abs); } catch { continue; }
    if (st.isDirectory()) { walk(abs, out); continue; }
    if (EXTENSIONS.some((ext) => entry.endsWith(ext))) out.push(abs);
  }
  return out;
}

/**
 * Strip comments so PROSE about the old policy never trips an implementation scan.
 *
 * Block comments are removed LINE-WISE, only from a line whose first non-space characters are the
 * opener. A whole-file `/\*...*\/` regex looked simpler and was wrong: this tree contains regex
 * literals and glob strings that carry a bare `/\*`, so the non-greedy match ran past real code and
 * silently deleted the very lines the scan exists to read — it reported a clean file because it could
 * no longer see it.
 */
function stripComments(text, file) {
  const lines = text.split('\n');
  let inBlock = false;
  const kept = [];
  for (const line of lines) {
    if (inBlock) {
      if (line.includes('*/')) inBlock = false;
      kept.push('');
      continue;
    }
    if (/^\s*\/\*/.test(line)) {
      if (!line.includes('*/')) inBlock = true;
      kept.push('');
      continue;
    }
    kept.push(line);
  }
  let out = kept.join('\n');
  out = out.split('\n').map((line) => {
    if (file.endsWith('.sql')) return line.replace(/--.*$/, '');
    if (file.endsWith('.sh') || file.endsWith('.yml') || file.endsWith('.yaml')) return line.replace(/(^|\s)#.*$/, '$1');
    return line.replace(/(^|[^:])\/\/.*$/, '$1');
  }).join('\n');
  return out;
}

const FILES = walk(ROOT).map((abs) => relative(ROOT, abs).split(sep).join('/'));

describe('#1436 retention policy scan — newest-two must not survive anywhere active', () => {
  it('the walk is not vacuous', () => {
    expect(FILES.length, 'the scan found no files — it would pass trivially').toBeGreaterThan(500);
    // A control: the scan can see a file it is supposed to be able to see.
    expect(FILES).toContain('backend/supabase/migrations/20260908120000_transcript_retention_newest_one.sql');
  });

  it('no ACTIVE file implements newest-two', () => {
    const offences = [];
    for (const file of FILES) {
      if (HISTORICAL.has(file)) continue;
      let text;
      try { text = readFileSync(join(ROOT, file), 'utf8'); } catch { continue; }
      const code = stripComments(text, file);
      for (const { token, why } of NEWEST_TWO_TOKENS) {
        if (!code.includes(token)) continue;
        const line = code.split('\n').findIndex((l) => l.includes(token)) + 1;
        offences.push(`${file}:${line} contains '${token}' (${why})`);
      }
    }
    expect(offences, `active newest-two implementation found:\n${offences.join('\n')}`).toEqual([]);
  });

  it('every allowlisted historical file declares itself historical', () => {
    const undeclared = [];
    // These carry newest-two because they REMOVE it or assert it is gone, not because they are old.
    const CORRECTION_SIDE = new Set([
      'tests/db/transcript-retention-newest-one.integration.test.ts',
      'tests/unit/retentionPolicyScan.test.js',
    ]);
    for (const [file] of HISTORICAL) {
      // Applied migrations are immutable and cannot be re-headed; the allowlist reason stands for them.
      if (file.startsWith('backend/supabase/migrations/')) continue;
      if (CORRECTION_SIDE.has(file)) continue;
      let text;
      try { text = readFileSync(join(ROOT, file), 'utf8'); } catch { undeclared.push(`${file} (missing)`); continue; }
      const head = text.split('\n').slice(0, 25).join('\n');
      if (!MARKER.test(head)) undeclared.push(file);
    }
    expect(undeclared, `allowlisted but not declared historical:\n${undeclared.join('\n')}`).toEqual([]);
  });

  it('the allowlist contains nothing that no longer needs to be on it', () => {
    // A stale allowlist silently widens the hole the scan exists to close.
    const unnecessary = [];
    for (const [file] of HISTORICAL) {
      if (file === 'tests/unit/retentionPolicyScan.test.js') continue;
      let text;
      try { text = readFileSync(join(ROOT, file), 'utf8'); } catch { continue; }
      const code = stripComments(text, file);
      if (!NEWEST_TWO_TOKENS.some(({ token }) => code.includes(token))) unnecessary.push(file);
    }
    expect(unnecessary, `allowlisted but no longer contains newest-two:\n${unnecessary.join('\n')}`).toEqual([]);
  });

  it('the active server simulations retain exactly one transcript', () => {
    // The two E2E doubles ARE the production contract as far as every mocked journey is concerned.
    for (const file of ['tests/e2e/helpers/setupE2EManifest.ts', 'tests/e2e/mock-routes.ts']) {
      const code = stripComments(readFileSync(join(ROOT, file), 'utf8'), file);
      expect(code, `${file} must retain exactly one`).toContain('retained.slice(1)');
    }
  });
});
