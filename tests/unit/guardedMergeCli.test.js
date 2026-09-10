/**
 * #1430 P1, thread `3983020005` — THE GUARD IS THE MERGE COMMAND, NOT A LIBRARY BESIDE IT.
 *
 * A previous round added `guardedMerge` with no caller. PM was right to stop it: a guard nothing routes
 * through is not load-bearing, because the documented procedure still said `gh pr merge`. So the guard
 * is now the CLI behind `pnpm merge:guarded`, it owns the only merge invocation in the repository, and
 * the workflow doc routes through it.
 *
 * THESE CASES DRIVE THE CLI AS A SUBPROCESS, and they assert on whether `gh` was ATTEMPTED — not on a
 * returned flag. `GUARDED_MERGE_GH_BIN` substitutes a recorder that writes a marker file when invoked,
 * so "the merge did not happen" is observed rather than reported. A gate that logged a refusal and
 * merged anyway would pass a flag-based assertion and fail this one.
 *
 * That is also what makes the bypass mutation detectable: move the `gh pr merge` call ahead of the
 * guard, or call it on a hold, and the marker appears where these cases require its absence.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(__dirname, '..', '..');
const CLI = join(REPO, 'scripts', 'pre-merge-gate.mjs');
const HEAD = 'e'.repeat(40);
const bot = 'chatgpt-codex-connector';

let dir;
let marker;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'guarded-merge-'));
  marker = join(dir, 'gh-was-invoked');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A stand-in for `gh` that records the fact it ran. Its existence is the observation. */
function recorderGh() {
  const bin = join(dir, 'gh-recorder');
  writeFileSync(bin, `#!/bin/sh\nprintf '%s' "$*" > ${JSON.stringify(marker)}\nexit 0\n`);
  chmodSync(bin, 0o755);
  return bin;
}

/**
 * A stand-in GraphQL endpoint. The CLI's live reader is a real `fetch`, so the read is intercepted at
 * the network boundary rather than by swapping the reader — which keeps the CLI under test whole.
 */
function fakeGraphql({ threads, headRefOid = HEAD }) {
  const pullRequest = {
    number: 1430,
    headRefOid,
    baseRefName: 'main',
    files: { nodes: [{ path: 'scripts/pre-merge-gate.mjs' }], pageInfo: { hasNextPage: false } },
    reviews: {
      nodes: [{
        author: { login: bot }, state: 'COMMENTED', commit: { oid: HEAD },
        body: 'reviewed', submittedAt: '2026-09-10T20:00:00Z',
      }],
      pageInfo: { hasPreviousPage: false },
    },
    reviewThreads: { nodes: threads, pageInfo: { hasNextPage: false } },
  };
  const body = JSON.stringify({ data: { repository: { pullRequest } } });
  const loader = join(dir, 'fetch-stub.mjs');
  writeFileSync(loader, `
const body = ${JSON.stringify(body)};
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => JSON.parse(body) });
`);
  return loader;
}

const thread = (isResolved, body) => ({
  isResolved,
  comments: {
    nodes: [{
      author: { login: bot }, body,
      commit: { oid: HEAD }, originalCommit: { oid: HEAD },
      pullRequestReview: { commit: { oid: HEAD } },
    }],
    pageInfo: { hasPreviousPage: false },
  },
});

const receipt = (minutesOld, extra = {}) => {
  const file = join(dir, 'review-qualification.json');
  writeFileSync(file, JSON.stringify({
    qualified: true, reasons: [], currentSha: HEAD, reviewedSha: HEAD,
    generatedAt: new Date(Date.now() - minutesOld * 60 * 1000).toISOString(),
    ...extra,
  }));
  return file;
};

function runCli({ threads, receiptPath, sha = HEAD, headRefOid = HEAD }) {
  const stub = fakeGraphql({ threads, headRefOid });
  const run = spawnSync(process.execPath, ['--import', stub, CLI,
    '--repo=relativityE/speaksharp', '--pr=1430', `--sha=${sha}`,
    ...(receiptPath ? [`--receipt=${receiptPath}`] : [])], {
    cwd: REPO,
    env: { ...process.env, GITHUB_TOKEN: 'test-token', GUARDED_MERGE_GH_BIN: recorderGh() },
    encoding: 'utf8',
  });
  return { run, mergeAttempted: existsSync(marker) };
}

describe('#1430 P1 — the guarded merge CLI never invokes gh on a hold', () => {
  it('CASUALTY: a REOPENED P0/P1 thread — gh is never invoked', () => {
    /**
     * The defect. The receipt is fresh and says qualified: it was written before the reopen and cannot
     * know about it. Only the live re-read at merge time sees the thread.
     */
    const { run, mergeAttempted } = runCli({
      threads: [thread(false, 'P1 Badge — a live release finding')],
      receiptPath: receipt(1),
    });

    expect(mergeAttempted, 'gh pr merge must not have been attempted').toBe(false);
    expect(run.status, 'and the command must fail, not warn').not.toBe(0);
    expect(run.stderr).toContain('MERGE HELD');
    expect(run.stderr).toContain('pre_merge_live_release_findings');
  });

  it('CASUALTY: a STALE receipt — gh is never invoked', () => {
    // Live state is clean, so only the receipt's age can refuse. A boundary that re-read threads but
    // never rechecked the age would merge on evidence that no longer describes the tree.
    const { run, mergeAttempted } = runCli({
      threads: [thread(true, 'P1 Badge — addressed and resolved')],
      receiptPath: receipt(90),
    });

    expect(mergeAttempted).toBe(false);
    expect(run.stderr).toContain('pre_merge_receipt_stale');
  });

  it('CASUALTY: an UNREADABLE live state — gh is never invoked', () => {
    // No fetch stub: the live read throws. An unreadable thread state is not an empty one, and a
    // transient API failure must never become permission to merge.
    const run = spawnSync(process.execPath, [CLI,
      '--repo=relativityE/speaksharp', '--pr=1430', `--sha=${HEAD}`, `--receipt=${receipt(1)}`], {
      cwd: REPO,
      env: { ...process.env, GITHUB_TOKEN: 'test-token', GUARDED_MERGE_GH_BIN: recorderGh() },
      encoding: 'utf8',
    });

    expect(existsSync(marker)).toBe(false);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('MERGE HELD');
  });

  it('CASUALTY: HEAD DRIFT since authorization — gh is never invoked', () => {
    // The authorization named a SHA. If the live head is a different commit, this decision is about a
    // different tree than the one reviewed and authorized.
    const { run, mergeAttempted } = runCli({
      threads: [thread(true, 'P1 Badge — resolved')],
      receiptPath: receipt(1),
      headRefOid: 'f'.repeat(40),
    });

    expect(mergeAttempted).toBe(false);
    expect(run.stderr).toContain('pre_merge_head_moved');
  });

  it('CASUALTY: a MISSING receipt — gh is never invoked', () => {
    // "No receipt" is indistinguishable from stale, so it holds rather than skipping the age check.
    const { run, mergeAttempted } = runCli({
      threads: [thread(true, 'P1 Badge — resolved')],
      receiptPath: null,
    });

    expect(mergeAttempted).toBe(false);
    expect(run.stderr).toContain('pre_merge_receipt_missing');
  });

  it('POSITIVE CONTROL: a fresh receipt and a clean live read DOES invoke gh, with the exact head', () => {
    /**
     * Without this every case above would pass against a CLI that refuses everything — which is the
     * failure mode this PR has produced repeatedly, so it is asserted rather than assumed. The
     * recorded arguments are checked too: a merge that dropped `--match-head-commit` could land a
     * commit other than the authorized one.
     */
    const { run, mergeAttempted } = runCli({
      threads: [thread(true, 'P1 Badge — addressed and resolved')],
      receiptPath: receipt(1),
    });

    expect(mergeAttempted, 'the merge really was invoked').toBe(true);
    expect(run.status, 'and the command succeeded').toBe(0);
    expect(run.stdout).toContain('MERGED');

    // The recorder wrote the argv it was called with, so the claim above is checked rather than
    // asserted: a merge that dropped `--match-head-commit` could land a commit other than the
    // authorized one, and that would be invisible to a "was it invoked" assertion alone.
    const invokedWith = readFileSync(marker, 'utf8');
    expect(invokedWith, 'squash-merges the named PR').toContain('pr merge 1430 --squash');
    expect(invokedWith, 'and pins the exact authorized head').toContain(`--match-head-commit ${HEAD}`);
  });
});
