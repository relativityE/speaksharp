/**
 * #1430 P1, thread `3983020005` — THE GUARD IS THE MERGE COMMAND, NOT A LIBRARY BESIDE IT.
 *
 * A previous round added `guardedMerge` with no caller. PM was right to stop it: a guard nothing routes
 * through is not load-bearing, because the documented procedure still said `gh pr merge`. The workflow
 * now routes through the CLI copied from the exact authorized base, never through candidate package code.
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
/** The authorized base: `main` at the SHA the exact-head/base authorization named. */
const BASE = 'b'.repeat(40);
const REPOSITORY = 'relativityE/speaksharp';
const bot = 'chatgpt-codex-connector';

/**
 * The CLI falls back to GITHUB_REPOSITORY / PR_NUMBER / EXPECTED_* when a flag is absent, and CI defines
 * GITHUB_REPOSITORY. Without blanking these, a case that OMITS `--repo` would pass locally and silently
 * borrow the runner's repository in CI. Blanked, a flag's absence is really an absence.
 */
const ISOLATED_ENV = {
  GITHUB_REPOSITORY: '', PR_NUMBER: '', EXPECTED_HEAD_SHA: '', EXPECTED_BASE_SHA: '', REVIEW_QUALIFICATION_FILE: '',
};

let dir;
let marker;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'guarded-merge-'));
  marker = join(dir, 'gh-was-invoked');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A stand-in for `gh` that records the fact it ran. Its existence is the observation. */
function recorderGh(exitCode = 0) {
  const bin = join(dir, 'gh-recorder');
  // A non-zero `exitCode` models GitHub refusing the merge after the attempt (e.g. an out-of-date head).
  writeFileSync(bin, `#!/bin/sh\nprintf '%s' "$*" > ${JSON.stringify(marker)}\nexit ${exitCode}\n`);
  chmodSync(bin, 0o755);
  return bin;
}

/**
 * A stand-in GraphQL endpoint. The CLI's live reader is a real `fetch`, so the read is intercepted at
 * the network boundary rather than by swapping the reader — which keeps the CLI under test whole.
 */
function fakeGraphql({
  threads, headRefOid = HEAD, truncatedThreads = false, cleanResultOnly = false, laterCleanResult = false,
  liveBase = BASE, liveRepository = REPOSITORY,
  // `main`'s classic branch protection as the REST API would return it to the operator's token.
  protection = { status: 200, strict: true, enforceAdmins: true },
}) {
  const pullRequest = {
    number: 1430,
    headRefOid,
    baseRefName: 'main',
    files: { nodes: [{ path: 'scripts/pre-merge-gate.mjs' }], pageInfo: { hasNextPage: false } },
    // `truncatedThreads` models a PR with more than 100 review threads: the first page came back
    // clean while another page exists, which is the second defect Codex found.
    ...(truncatedThreads ? {} : {}),
    reviews: {
      // `cleanResultOnly` models Codex's zero-finding outcome, which creates NO review object at all.
      nodes: cleanResultOnly ? [] : [{
        author: { login: bot }, state: 'COMMENTED', commit: { oid: HEAD },
        body: 'reviewed', submittedAt: '2026-09-10T20:00:00Z',
      }],
      pageInfo: { hasPreviousPage: false },
    },
    reviewThreads: { nodes: threads, pageInfo: { hasNextPage: truncatedThreads } },
  };
  // Codex's clean result lives ONLY in the PR's issue comments, with the reviewed head in its footer.
  // `laterCleanResult` keeps the review object AND adds the clean result after it: a later clean re-review.
  const comments = {
    nodes: (cleanResultOnly || laterCleanResult) ? [{
      author: { login: bot }, authorAssociation: 'NONE', createdAt: '2026-09-10T20:05:00Z',
      // #1438 PM RETURN `5638958869`: a clean comment is authority only when it names the FULL head.
      body: `Codex Review: Didn't find any major issues. Keep them coming!\n\n**Reviewed commit:** \`${HEAD}\``,
    }] : [],
    pageInfo: { hasPreviousPage: false },
  };
  const body = JSON.stringify({ data: { repository: { pullRequest } } });
  const loader = join(dir, 'fetch-stub.mjs');
  /**
   * THE STUB ANSWERS THE QUERY IT IS SENT. It used to return one canned payload whatever was asked,
   * so no case could observe what the gate actually requests from GitHub — which is how a live query
   * missing `comments` stayed green. Real GraphQL omits every field that is not selected; so does this.
   * Only the top-level issue-comment selection carries `authorAssociation`, which is what it keys on.
   */
  writeFileSync(loader, `
const body = ${JSON.stringify(body)};
const comments = ${JSON.stringify(JSON.stringify(comments))};
globalThis.fetch = async (url, init) => {
  // The protection read is a REST GET; everything else is the GraphQL review read.
  if (String(url).includes('/branches/main/protection')) {
    const p = ${JSON.stringify(protection)};
    return {
      ok: p.status === 200, status: p.status,
      json: async () => ({
        required_status_checks: p.strict === null ? null : { strict: p.strict, contexts: [] },
        enforce_admins: { enabled: p.enforceAdmins },
      }),
    };
  }
  const { query = '' } = JSON.parse(init?.body ?? '{}');
  const payload = JSON.parse(body);
  if (query.includes('comments(last:100,before:$commentsBefore)')) {
    payload.data.repository.pullRequest.comments = JSON.parse(comments);
  }
  // Base identity likewise comes back only when the gate asks for it.
  if (/\\bbaseRefOid\\b/.test(query)) payload.data.repository.pullRequest.baseRefOid = ${JSON.stringify(liveBase ?? null)};
  if (query.includes('baseRepository{nameWithOwner}')) {
    payload.data.repository.pullRequest.baseRepository = { nameWithOwner: ${JSON.stringify(liveRepository ?? null)} };
  }
  return { ok: true, status: 200, json: async () => payload };
};
`);
  return loader;
}

/**
 * #1430 fix-forward `3991388525`: a RESOLVED same-head P0/P1 now blocks until a later clean re-review, so the
 * resolved threads these cases treat as clean live state are findings from an EARLIER head. Codex cited the
 * positive control that merged over a resolved same-head P1; that case is now a casualty of its own.
 */
const PRIOR_HEAD = 'a'.repeat(40);
const thread = (isResolved, body, sha = isResolved ? PRIOR_HEAD : HEAD) => ({
  isResolved,
  comments: {
    nodes: [{
      author: { login: bot }, body, createdAt: '2026-09-10T20:00:00Z',
      commit: { oid: sha }, originalCommit: { oid: sha },
      pullRequestReview: { state: 'COMMENTED', commit: { oid: sha } },
    }],
    pageInfo: { hasPreviousPage: false },
  },
});

/** `omit` deletes keys AFTER the merge, so a case can model a receipt that never had the field. */
const receipt = (minutesOld, extra = {}, omit = []) => {
  const file = join(dir, 'review-qualification.json');
  const body = {
    // A BOUND receipt: qualified, no reasons, no findings, and addressed to this PR and this head.
    // Codex found the boundary checked only `generatedAt`, so a fresh receipt from another PR passed.
    qualified: true, reasons: [], findingCount: 0,
    pullRequestNumber: 1430, currentSha: HEAD, reviewedSha: HEAD,
    repository: REPOSITORY, baseSha: BASE,
    generatedAt: new Date(Date.now() - minutesOld * 60 * 1000).toISOString(),
    ...extra,
  };
  for (const key of omit) delete body[key];
  writeFileSync(file, JSON.stringify(body));
  return file;
};

function runCli({
  threads, receiptPath, sha = HEAD, headRefOid = HEAD, truncatedThreads = false, cleanResultOnly = false,
  laterCleanResult = false,
  repository = REPOSITORY, baseSha = BASE, liveBase = BASE, liveRepository = REPOSITORY,
  protection, ghExitCode = 0,
}) {
  const stub = fakeGraphql({
    threads, headRefOid, truncatedThreads, cleanResultOnly, laterCleanResult, liveBase, liveRepository, protection,
  });
  // `null` omits the flag entirely, so a case can model an operator who never supplied it.
  const run = spawnSync(process.execPath, ['--import', stub, CLI,
    ...(repository === null ? [] : [`--repo=${repository}`]), '--pr=1430', `--sha=${sha}`,
    ...(baseSha === null ? [] : [`--base-sha=${baseSha}`]),
    ...(receiptPath ? [`--receipt=${receiptPath}`] : [])], {
    cwd: REPO,
    env: { ...process.env, ...ISOLATED_ENV, GITHUB_TOKEN: 'test-token', GUARDED_MERGE_GH_BIN: recorderGh(ghExitCode) },
    encoding: 'utf8',
  });
  return { run, mergeAttempted: existsSync(marker) };
}

describe('#1430 P1 — privileged execution comes only from the authorized base', () => {
  function committedTrustedBase() {
    const runGit = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    expect(runGit(['init', '-q']).status).toBe(0);
    writeFileSync(join(dir, 'tracked'), 'trusted base\n');
    expect(runGit(['add', 'tracked']).status).toBe(0);
    expect(runGit([
      '-c', 'user.name=SpeakSharp Test', '-c', 'user.email=test@example.invalid',
      'commit', '-q', '-m', 'trusted base',
    ]).status).toBe(0);
    const head = runGit(['rev-parse', 'HEAD']);
    expect(head.status).toBe(0);
    return head.stdout.trim();
  }

  function runDocumentedTrustedBaseChecks(authorizedBaseSha) {
    const workflow = readFileSync(join(REPO, '.agent', 'workflows', 'pr-merge-workflow.md'), 'utf8');
    const mergeBlock = workflow.match(/AUTHORIZED_BASE_SHA=<exact-base-sha>([\s\S]*?)git worktree remove/);
    expect(mergeBlock, 'the documented trusted-base block exists').not.toBeNull();
    const checks = mergeBlock[1].split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('test '));
    expect(checks, 'both documented identity checks are executable').toHaveLength(2);
    const sentinel = join(dir, 'privileged-line-reached');
    const run = spawnSync('bash', ['-c', `${checks.join('\n')}\nprintf reached > "$TRUSTED_CHECK_SENTINEL"`], {
      env: {
        ...process.env,
        AUTHORIZED_BASE_SHA: authorizedBaseSha,
        TRUSTED_MERGE_ROOT: dir,
        TRUSTED_CHECK_SENTINEL: sentinel,
      },
      encoding: 'utf8',
    });
    return { run, privilegedLineReached: existsSync(sentinel) };
  }

  it.each([
    ['wrong HEAD', ({ head }) => `${head.slice(0, -1)}${head.endsWith('0') ? '1' : '0'}`, () => {}],
    ['dirty worktree', ({ head }) => head, () => { writeFileSync(join(dir, 'untracked'), 'dirty\n'); }],
  ])('CASUALTY: %s stops before the privileged line', (_label, authorizedSha, arrange) => {
    const head = committedTrustedBase();
    arrange();
    const { run, privilegedLineReached } = runDocumentedTrustedBaseChecks(authorizedSha({ head }));

    expect(run.status, 'the documented check must fail closed').not.toBe(0);
    expect(privilegedLineReached, 'privileged execution was not reached').toBe(false);
    expect(run.stderr).toContain('HOLD: trusted base');
  });

  it('CONTROL: the exact clean trusted base reaches the privileged line', () => {
    const head = committedTrustedBase();
    const { run, privilegedLineReached } = runDocumentedTrustedBaseChecks(head);

    expect(run.status).toBe(0);
    expect(privilegedLineReached).toBe(true);
  });

  it('the documented path never invokes candidate package code', () => {
    const workflow = readFileSync(join(REPO, '.agent', 'workflows', 'pr-merge-workflow.md'), 'utf8');
    const packageJson = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));

    expect(packageJson.scripts?.['merge:guarded']).toBeUndefined();
    expect(workflow).not.toContain('pnpm merge:guarded');
    expect(workflow).toContain('git worktree add --detach "$TRUSTED_MERGE_ROOT" "$AUTHORIZED_BASE_SHA"');
    expect(workflow).toContain('cd "$TRUSTED_MERGE_ROOT"');
    expect(workflow).toContain('"$NODE_BIN" scripts/pre-merge-gate.mjs');
    expect(workflow.indexOf('cd "$TRUSTED_MERGE_ROOT"'))
      .toBeLessThan(workflow.indexOf('GITHUB_TOKEN="$GH_TOKEN"'));
  });

  it('CONTROL: the one-time bootstrap executes only trusted gh and pins repository and head', () => {
    const workflow = readFileSync(join(REPO, '.agent', 'workflows', 'pr-merge-workflow.md'), 'utf8');
    expect(workflow).toContain('one-time #1430 bootstrap');
    expect(workflow).toContain('trusted installed `gh` binary');
    expect(workflow).toContain('explicit `--repo` and `--match-head-commit`');
    expect(workflow).toMatch(/executes no\s+candidate repository code with the token/);
  });
});

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
      '--repo=relativityE/speaksharp', '--pr=1430', `--sha=${HEAD}`, `--base-sha=${BASE}`, `--receipt=${receipt(1)}`], {
      cwd: REPO,
      env: { ...process.env, ...ISOLATED_ENV, GITHUB_TOKEN: 'test-token', GUARDED_MERGE_GH_BIN: recorderGh() },
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


  it('CASUALTY: a receipt from ANOTHER pull request — gh is never invoked', () => {
    /**
     * Codex P1 at `bef689f007`. The boundary validated the receipt's AGE and nothing else, so a
     * perfectly fresh receipt issued for a different pull request satisfied it. Freshness says when
     * evidence was produced, never what it was produced ABOUT.
     */
    const { run, mergeAttempted } = runCli({
      threads: [thread(true, 'P1 Badge — resolved')],
      receiptPath: receipt(1, { pullRequestNumber: 9999 }),
    });

    expect(mergeAttempted).toBe(false);
    expect(run.stderr).toContain('pre_merge_receipt_addresses_another_pull_request');
  });

  it('CASUALTY: a receipt for ANOTHER head — gh is never invoked', () => {
    // Same omission, the other axis: a receipt about a different commit than the one authorized.
    const { run, mergeAttempted } = runCli({
      threads: [thread(true, 'P1 Badge — resolved')],
      receiptPath: receipt(1, { currentSha: 'a'.repeat(40), reviewedSha: 'a'.repeat(40) }),
    });

    expect(mergeAttempted).toBe(false);
    expect(run.stderr).toContain('pre_merge_receipt_addresses_another_head');
  });

  it('CASUALTY: an UNQUALIFIED receipt — gh is never invoked', () => {
    // An ineligible run's receipt is still a fresh, well-addressed file. Its own verdict is the point.
    const { run, mergeAttempted } = runCli({
      threads: [thread(true, 'P1 Badge — resolved')],
      receiptPath: receipt(1, { qualified: false, reasons: ['open_findings:1'] }),
    });

    expect(mergeAttempted).toBe(false);
    expect(run.stderr).toContain('pre_merge_receipt_not_qualified');
  });

  it('CASUALTY: `qualified: false` with NO stated reasons still refuses', () => {
    /**
     * ISOLATES THE `qualified` PREDICATE, and it exists because a mutation proved the need.
     *
     * The case above sets `qualified: false` AND a non-empty `reasons`, so deleting the `qualified`
     * check alone left it passing — the reasons check caught it and the mutant survived. A receipt that
     * declares itself unqualified while listing no reason is incoherent, and incoherent evidence must be
     * refused rather than reconciled: the flag is the verdict, and the list is only its explanation.
     */
    const { run, mergeAttempted } = runCli({
      threads: [thread(true, 'P1 Badge — resolved')],
      receiptPath: receipt(1, { qualified: false, reasons: [] }),
    });

    expect(mergeAttempted).toBe(false);
    expect(run.stderr).toContain('pre_merge_receipt_not_qualified');
  });

  it('CASUALTY: `qualified: true` alongside stated reasons still refuses', () => {
    /**
     * The mirror isolation, added for the same reason as its twin: with every reasons-bearing fixture
     * also carrying `qualified: false`, deleting the reasons check left the suite passing.
     *
     * A receipt asserting BOTH that it qualified and that it has reasons not to is self-contradictory.
     * The safe reading of a contradiction is the unfavourable one — a producer that appended a reason
     * and forgot to clear the flag must not be trusted over its own stated reason.
     */
    const { run, mergeAttempted } = runCli({
      threads: [thread(true, 'P1 Badge — resolved')],
      receiptPath: receipt(1, { qualified: true, reasons: ['reviewed_sha_is_not_current_head'] }),
    });

    expect(mergeAttempted).toBe(false);
    expect(run.stderr).toContain('pre_merge_receipt_not_qualified');
  });

  it('CASUALTY: a receipt claiming qualified while reporting findings still refuses', () => {
    /**
     * The third and last of the coherence isolations, each added because a mutation survived without it.
     * With `qualified` and `reasons` both clean, only `findingCount` can refuse here.
     *
     * The three together say one thing: this boundary refuses a receipt that contradicts itself on ANY
     * axis, rather than picking whichever field happens to look permissive. A coherent producer never
     * emits these shapes — which is exactly why an incoherent one must not be believed.
     */
    const { run, mergeAttempted } = runCli({
      threads: [thread(true, 'P1 Badge — resolved')],
      receiptPath: receipt(1, { qualified: true, reasons: [], findingCount: 2 }),
    });

    expect(mergeAttempted).toBe(false);
    expect(run.stderr).toContain('pre_merge_receipt_not_qualified');
  });

  it('CASUALTY: a receipt that OMITS reasons or findingCount refuses — absence is not a zero', () => {
    /**
     * Codex P1 at `e2d72b66cf`, reproduced by invoking the merge with a fresh, matching,
     * `qualified: true` receipt that simply left both fields out. My predicates asked whether a present
     * value was bad, so a missing one sailed through.
     *
     * This is the same error as #1430's own original finding — a missing `skippedTestFiles` array read as
     * "nothing was skipped". I required presence there and defaulted to permissive in the boundary
     * guarding it, which is why this case names the shape rather than only the outcome.
     */
    for (const omit of [['reasons'], ['findingCount'], ['reasons', 'findingCount']]) {
      const { run, mergeAttempted } = runCli({
        threads: [thread(true, 'P1 Badge — resolved')],
        receiptPath: receipt(1, {}, omit),
      });
      expect(mergeAttempted, `omitting ${omit.join('+')} must not merge`).toBe(false);
      expect(run.stderr).toContain('pre_merge_receipt_not_qualified');
    }
  });

  it('CASUALTY: MALFORMED reasons or findingCount refuse — wrong type is not a zero either', () => {
    /**
     * The typed half of the same finding. `reasons: 'open_findings:1'` defeated `Array.isArray`, and
     * `findingCount: '0'` defeated `> 0` — a string is not greater than zero. A negative count is
     * likewise not a measured zero. Each is now refused for BEING the wrong shape rather than for
     * comparing unfavourably.
     */
    const malformed = [
      { reasons: 'open_findings:1' },
      { reasons: {} },
      { findingCount: '0' },
      { findingCount: -1 },
      { findingCount: 1.5 },
      { findingCount: null },
    ];
    for (const extra of malformed) {
      const { run, mergeAttempted } = runCli({
        threads: [thread(true, 'P1 Badge — resolved')],
        receiptPath: receipt(1, extra),
      });
      expect(mergeAttempted, `${JSON.stringify(extra)} must not merge`).toBe(false);
      expect(run.stderr).toContain('pre_merge_receipt_not_qualified');
    }
  });

  it('CASUALTY: a TRUNCATED live read — zero visible findings does not merge', () => {
    /**
     * The second Codex P1, and the sharper one. The visible page is clean, so a boundary judging by
     * `findingCount` sees zero and merges — while a reopened P0/P1 sits on a page it never fetched.
     * `buildReviewReceipt()` already reports this as `review_threads_incomplete`; the fix is to consume
     * that verdict instead of counting what happened to come back.
     */
    const { run, mergeAttempted } = runCli({
      threads: [thread(true, 'P1 Badge — resolved')],
      receiptPath: receipt(1),
      truncatedThreads: true,
    });

    expect(mergeAttempted, 'an incomplete read is not a clean one').toBe(false);
    expect(run.stderr).toContain('pre_merge_live_receipt_not_qualified');
    expect(run.stderr, 'and it names WHY it could not be trusted').toContain('review_threads_incomplete');
  });

  it('CASUALTY: an OMITTED --repo never invokes gh', () => {
    // `ISOLATED_ENV` blanks the GITHUB_REPOSITORY fallback, so this observes a genuinely absent repository.
    const { run, mergeAttempted } = runCli({
      threads: [thread(true, 'P1 Badge — resolved')], receiptPath: receipt(1), repository: null,
    });
    expect(mergeAttempted, 'no repository, no merge').toBe(false);
    expect(run.status).toBe(2);
  });

  it('CASUALTY: a WRONG --repo never invokes gh — the guard and the merge must name one repository', () => {
    /**
     * Codex P1 `3986417417`. The guard validated `--repo` while `gh pr merge <n>` resolved `<n>` against
     * whatever repository the checkout belongs to. The stored receipt and the live pull request are both
     * bound to the repository GitHub reports, so naming another one refuses before `gh` is reached.
     */
    const { run, mergeAttempted } = runCli({
      threads: [thread(true, 'P1 Badge — resolved')], receiptPath: receipt(1), repository: 'someone/else',
    });
    expect(mergeAttempted).toBe(false);
    expect(run.stderr).toContain('pre_merge_receipt_addresses_another_repository');
    expect(run.stderr).toContain('pre_merge_live_pull_request_in_another_repository');
  });

  it('CASUALTY: a matching head on an ADVANCED base never invokes gh', () => {
    // Codex P1 `3986417422`, driven through the real CLI and the real query text.
    const { run, mergeAttempted } = runCli({
      threads: [thread(true, 'P1 Badge — resolved')], receiptPath: receipt(1), liveBase: 'c'.repeat(40),
    });
    expect(mergeAttempted, 'the reviewed head must not land on an unreviewed base').toBe(false);
    expect(run.stderr).toContain('pre_merge_base_moved');
  });

  it('CASUALTY: a MISSING or MALFORMED --base-sha never invokes gh', () => {
    for (const baseSha of [null, 'not-a-sha', BASE.slice(1)]) {
      const { run, mergeAttempted } = runCli({
        threads: [thread(true, 'P1 Badge — resolved')], receiptPath: receipt(1), baseSha,
      });
      expect(mergeAttempted, `--base-sha ${JSON.stringify(baseSha)} must not merge`).toBe(false);
      expect(run.status, 'an unusable authorization is a usage error').toBe(2);
    }
  });

  it('CASUALTY: `main` WITHOUT strict up-to-date enforcement never invokes gh', () => {
    /**
     * Codex P1 `3988517243`. No merge API can pin the base SHA, so only GitHub's "Require branches to be up to
     * date before merging" rule closes the race between the final live base read and the merge. Without it the
     * guard refuses, whether strict is switched off or status checks are not required at all.
     */
    for (const strict of [false, null]) {
      const { run, mergeAttempted } = runCli({
        threads: [thread(true, 'P1 Badge — resolved')], receiptPath: receipt(1),
        protection: { status: 200, strict, enforceAdmins: true },
      });
      expect(mergeAttempted, `strict=${JSON.stringify(strict)} must not merge`).toBe(false);
      expect(run.stderr).toContain('pre_merge_base_up_to_date_not_enforced');
    }
  });

  it('CASUALTY: strict enforcement that ADMINS can bypass never invokes gh', () => {
    const { run, mergeAttempted } = runCli({
      threads: [thread(true, 'P1 Badge — resolved')], receiptPath: receipt(1),
      protection: { status: 200, strict: true, enforceAdmins: false },
    });
    expect(mergeAttempted, 'an operator with admin rights would not be bound by the rule').toBe(false);
    expect(run.stderr).toContain('pre_merge_base_up_to_date_not_enforced');
  });

  it('CASUALTY: UNREADABLE protection never invokes gh — unreadable is not enabled', () => {
    for (const status of [401, 403, 404]) {
      const { run, mergeAttempted } = runCli({
        threads: [thread(true, 'P1 Badge — resolved')], receiptPath: receipt(1),
        protection: { status, strict: true, enforceAdmins: true },
      });
      expect(mergeAttempted, `protection HTTP ${status} must not merge`).toBe(false);
      expect(run.stderr).toContain('pre_merge_base_up_to_date_enforcement_unreadable');
    }
  });

  it('CASUALTY (race analogue): GitHub REJECTING the merge exits non-zero and never reports MERGED', () => {
    /**
     * The base can advance between the guard's final live read and the merge call. With strict up-to-date
     * enforcement GitHub then refuses the out-of-date head and `gh` exits non-zero. The recorder models that
     * refusal: it records the attempt, then exits 1. The CLI must name the rejection and fail.
     */
    const { run, mergeAttempted } = runCli({
      threads: [thread(true, 'P1 Badge — resolved')], receiptPath: receipt(1), ghExitCode: 1,
    });
    expect(mergeAttempted, 'the merge was attempted').toBe(true);
    expect(run.status, 'and the command failed').not.toBe(0);
    expect(run.stdout).not.toContain('MERGED');
    expect(run.stderr).toContain('pre_merge_merge_rejected_by_github');
  });

  it('CASUALTY (#1430 fix-forward `3991388525`): a RESOLVED same-head P1 with no later clean re-review never invokes gh', () => {
    /**
     * Codex security P1 `3991388525`. The final positive control below used to merge over exactly this: a
     * `P1 Badge` thread at the authorized head, resolved by anyone who can resolve threads, with nobody having
     * reviewed the fix. Resolution is not re-review, so the live read counts it and holds.
     */
    const { run, mergeAttempted } = runCli({
      threads: [thread(true, 'P1 Badge — resolved without re-review', HEAD)], receiptPath: receipt(1),
    });
    expect(mergeAttempted, 'a resolved same-head blocker must not merge').toBe(false);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('pre_merge_live_release_findings:1');
  });

  it('CONTROL (#1430 fix-forward `3991388525`): that resolved P1 followed by a clean re-review of this head DOES invoke gh', () => {
    const { run, mergeAttempted } = runCli({
      threads: [thread(true, 'P1 Badge — fixed and re-reviewed', HEAD)], receiptPath: receipt(1), laterCleanResult: true,
    });
    expect(run.stderr, 'a later bound clean result clears the resolved finding').not.toContain('MERGE HELD');
    expect(mergeAttempted).toBe(true);
    expect(run.status).toBe(0);
  });

  it('POSITIVE CONTROL: a clean-result COMMENT with no review object DOES invoke gh', () => {
    /**
     * Codex P1 `3985755149` at `c33644cd3e`. When Codex finds nothing it posts an issue comment and
     * creates NO review object — the normal clean outcome. The live query did not select `comments`,
     * so the gate could never see that evidence and refused every legitimately clean PR at merge.
     *
     * Every other case in this file carries a review object, which is why none of them could notice.
     * No threads and a fresh bound receipt, so the clean-result comment is the only thing that can
     * qualify this read — and the stub returns it only if the gate actually asks for it.
     */
    const { run, mergeAttempted } = runCli({ threads: [], receiptPath: receipt(1), cleanResultOnly: true });

    expect(run.stderr, 'no hold may be reported for a clean-result comment').not.toContain('MERGE HELD');
    expect(mergeAttempted, 'a clean-result comment alone is sufficient evidence to merge').toBe(true);
    expect(run.status).toBe(0);
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
    expect(invokedWith, 'in the repository the guard validated').toContain('--repo relativityE/speaksharp');
  });
});
