import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildReviewReceipt } from '../../scripts/collect-review-qualification.mjs';
import { formatReviewQualification } from '../../scripts/review-qualification.mjs';

// Dependency-free controls also run in the ordinary Vitest lane, like testEfficacy.test.js.
const { test } = process.env.NODE_TEST_CONTEXT ? await import('node:test') : await import('vitest');
const HEAD = '69260dfcc4147607e81e2250eca407650c79e1a2';
const OLD = '1709fb998bde62f9ced86a4b89f2c9318223a029';
const REPO = 'relativityE/speaksharp';
const bot = { login: 'chatgpt-codex-connector[bot]' };
const row = (sha = HEAD, status = 'completed') => ({ commit_sha: sha, status,
  has_any_findings: false, has_unresolved_findings: false });
const state = () => ({ code_review: row(), security_review: row() });
const security = () => ({ headSha: HEAD, status: 'completed', repository: REPO, pullRequestNumber: 1778 });
// Observed system envelope: #1778 comment 6592828939 and #1782 comment 6601860163 (2026-11-04).
// Only the manual trigger/table text varies in these controls; full system identities are independent.
const summary = ({ reviewState = state(), securityState = security(), trigger = 'Manual request',
  author = bot, stateRaw, securityRaw, extra = '', prefix = '', legacy = false } = {}) => ({
  id: 'summary', author, createdAt: '2026-11-03T05:20:00Z',
  body: `${prefix}<!-- codex-pull-request-review-summary -->\n`
    + (legacy ? '' : `<!-- codex-review-state:v1 ${stateRaw ?? JSON.stringify(reviewState)} -->\n`)
    + `<!-- codex-security-review:v1 ${securityRaw ?? JSON.stringify(securityState)} -->\n${extra}`
    + '## Codex Review Summary\n\n| Review | Status | Commit | Review trigger |\n| --- | --- | --- | --- |\n'
    + ['📝 **Code Review**', '🔒 **Security Review**'].map(label =>
      `| ${label} | ✅ **Completed** <relative-time datetime="2026-11-03T05:30:00Z">2026-11-03T05:30:00Z</relative-time> | \`${HEAD.slice(0, 7)}\` | ${trigger} |`).join('\n'),
});
const review = (sha = HEAD, body = '', reviewState = 'COMMENTED') => ({ author: bot,
  state: reviewState, commit: { oid: sha }, submittedAt: '2026-11-03T05:30:00Z', body });
const pull = (over = {}) => ({ number: 1778, headRefOid: HEAD, baseRefOid: 'b'.repeat(40),
  baseRefName: 'main', baseRepository: { nameWithOwner: REPO },
  files: { nodes: [{ path: 'scripts/collect-review-qualification.mjs' }], pageInfo: { hasNextPage: false } },
  comments: { nodes: [summary()], pageInfo: { hasPreviousPage: false } },
  reviews: { nodes: [], pageInfo: { hasPreviousPage: false } },
  reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } }, ...over });
const receipt = (pr = pull(), expectedHeadSha = HEAD) => buildReviewReceipt({ pullRequest: pr, expectedHeadSha });
const withSummary = (options) => pull({ comments: { nodes: [summary(options)], pageInfo: { hasPreviousPage: false } } });

for (const trigger of ['Manual request', 'PR opened', 'Draft marked ready']) {
  test(`both full-SHA system completions qualify after ${trigger} without lifecycle guessing`, () => {
    const actual = receipt(withSummary({ trigger }));
    assert.equal(actual.qualified, true, JSON.stringify(actual));
    assert.equal(actual.reviewedSha, HEAD);
    assert.equal(actual.reviewEvidence, 'codex_review_state');
  });
}

test('reviews complete on A then push B: stale metadata holds and names both SHAs and the recovery', () => {
  const actual = receipt(withSummary({ reviewState: { code_review: row(OLD), security_review: row(OLD) },
    securityState: { ...security(), headSha: OLD } }));
  assert.equal(actual.qualified, false);
  assert.ok(actual.reasons.includes('code_review_head_mismatch'));
  assert.ok(actual.reasons.includes('security_review_head_mismatch'));
  const output = formatReviewQualification(actual);
  assert.ok(output.includes(HEAD));
  assert.ok(output.includes(OLD));
  assert.match(output, /Request Code review once/);
  assert.match(output, /Request Security review once/);
  assert.match(output, /do not rerun engineering tests/);
});

for (const kind of ['code_review', 'security_review']) {
  for (const status of ['running', 'failed', 'cancelled', 'queued', 'unknown']) {
    test(`${kind} ${status} cannot be replaced by the other completed review`, () => {
      const actual = receipt(withSummary({ reviewState: { ...state(), [kind]: row(HEAD, status) },
        securityState: { ...security(), ...(kind === 'security_review' ? { status } : {}) } }));
      assert.equal(actual.qualified, false);
      assert.ok(actual.reasons.includes(`${kind}_not_completed:${status}`));
      if (['running', 'queued'].includes(status)) {
        assert.match(formatReviewQualification(actual), /Wait for the running/);
        assert.doesNotMatch(formatReviewQualification(actual), /Request .* review once/);
      }
    });
  }
  test(`${kind} missing or stale cannot borrow the other review's full SHA`, () => {
    for (const value of [undefined, row(OLD), row(HEAD.slice(0, 10)), row(HEAD.toUpperCase())]) {
      assert.equal(receipt(withSummary({ reviewState: { ...state(), [kind]: value } })).qualified, false);
    }
  });
}

test('partial, malformed, duplicated, misplaced and foreign metadata all hold, with no legacy downgrade', () => {
  for (const options of [
    { stateRaw: '{invalid}' }, { stateRaw: 'null' }, { stateRaw: '[]' },
    { stateRaw: `{"code_review":${JSON.stringify(row(OLD))},"code_review":${JSON.stringify(row())},"security_review":${JSON.stringify(row())}}` },
    { reviewState: { ...state(), code_review: { commit_sha: HEAD, status: 'completed' } } },
    { reviewState: { ...state(), extra: row() } },
    { extra: '<!-- codex-review-state:v1 broken -->\n' },
    { extra: `<!-- codex-security-review:v1 ${JSON.stringify(security())} -->\n` },
    { prefix: 'Here is your requested example:\n' },
    { securityState: { ...security(), repository: 'attacker/repo' } },
    { securityState: { ...security(), pullRequestNumber: 1779 } },
    { securityState: { headSha: HEAD, status: 'completed' } },
    { securityState: { ...security(), headSha: OLD } },
    { securityState: { ...security(), status: 'running' } },
    { author: { login: 'relativityE' } }, { author: { login: 'fake-chatgpt-codex-connector' } },
  ]) assert.equal(receipt(withSummary(options)).qualified, false, JSON.stringify(options));
});

test('duplicate bot summaries and truncated findings/comments never qualify', () => {
  for (const pr of [
    pull({ comments: { nodes: [summary(), { ...summary(), id: 'duplicate' }] } }),
    pull({ comments: { nodes: [summary()], pageInfo: { hasPreviousPage: true } } }),
    pull({ reviewThreads: { nodes: [], pageInfo: { hasNextPage: true } } }),
    pull({ reviews: { nodes: [], pageInfo: { hasPreviousPage: true } } }),
    pull({ files: { nodes: [], pageInfo: { hasNextPage: true } } }),
  ]) assert.equal(receipt(pr).qualified, false);
});

test('a GitHub review object cannot stand in for independent Security completion', () => {
  const reviews = { nodes: [review()], pageInfo: { hasPreviousPage: false } };
  const missing = receipt(pull({ reviews, comments: { nodes: [], pageInfo: { hasPreviousPage: false } } }));
  assert.equal(missing.qualified, false);
  assert.equal(missing.reviewDiagnostics.code.reviewedSha, HEAD);
  assert.match(formatReviewQualification(missing), /Request Security review once/);
  assert.doesNotMatch(formatReviewQualification(missing), /Request Code review once/);
  assert.equal(receipt(pull({ reviews })).qualified, true);
  const independentlyBound = withSummary({ reviewState: { ...state(), code_review: row(OLD) } });
  independentlyBound.reviews = reviews;
  assert.equal(receipt(independentlyBound).qualified, true, 'exact GitHub Code identity plus exact Security metadata is sufficient');
});

test('an unsubmitted PENDING review is not Code completion', () => {
  const pr = withSummary({ legacy: true });
  pr.reviews.nodes = [review(HEAD, '', 'PENDING')];
  assert.equal(receipt(pr).qualified, false);
  pr.reviews.nodes = [review()];
  assert.equal(receipt(pr).qualified, true);
});

test('system completion cannot clear any same-head P0/P1, even after its thread is resolved', () => {
  const finding = { author: bot, body: 'P1 Badge: real defect', pullRequestReview: { state: 'COMMENTED', commit: { oid: HEAD } } };
  for (const pr of [
    pull({ reviews: { nodes: [review(HEAD, 'P0 Badge: real defect')], pageInfo: { hasPreviousPage: false } } }),
    pull({ reviews: { nodes: [review(HEAD, '', 'CHANGES_REQUESTED')], pageInfo: { hasPreviousPage: false } } }),
    ...[true, false].map(isResolved => pull({ reviewThreads: { nodes: [{ isResolved, comments: {
      nodes: [finding], pageInfo: { hasPreviousPage: false } } }], pageInfo: { hasNextPage: false } } })),
    pull({ comments: { nodes: [summary(), { author: bot,
      body: `P1 Badge: real defect\n**Reviewed commit:** \`${HEAD.slice(0, 10)}\`` }], pageInfo: { hasPreviousPage: false } } }),
  ]) {
    const actual = receipt(pr);
    assert.equal(actual.qualified, false);
    assert.ok(actual.findingCount > 0);
  }
});

test('P2 remains advisory and a head mismatch with the workflow still holds', () => {
  const actual = receipt(pull({ comments: { nodes: [summary(), { author: bot,
    body: `P2 Badge: advisory\n**Reviewed commit:** \`${HEAD.slice(0, 10)}\`` }], pageInfo: { hasPreviousPage: false } } }));
  assert.equal(actual.qualified, true);
  assert.equal(actual.advisoryFindingCount, 1);
  assert.equal(receipt(pull(), OLD).qualified, false);
});

test('legacy security-only metadata retains its strict Ready and branch-history binding', () => {
  const pr = withSummary({ legacy: true, trigger: 'Draft marked ready' });
  assert.equal(receipt(pr).qualified, false);
  pr.timelineItems = { nodes: [{ createdAt: '2026-11-03T05:00:00Z' }] };
  pr.headRefHistory = { complete: true, moves: [{ after: HEAD, timestamp: '2026-11-03T04:59:59Z' }] };
  assert.equal(receipt(pr).qualified, true);
  pr.headRefHistory.moves.push({ after: HEAD, timestamp: '2026-11-03T05:00:00Z' });
  assert.equal(receipt(pr).qualified, false);
});

test('the real collector CLI reads system metadata, emits receipts and exits 0/1 for current/stale evidence', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'review-state-cli-')));
  try {
    const loader = join(directory, 'github-fixture.mjs');
    const output = join(directory, 'receipt.json');
    for (const stale of [false, true]) {
      const pr = withSummary(stale ? { reviewState: { code_review: row(OLD), security_review: row(OLD) },
        securityState: { ...security(), headSha: OLD } } : {});
      writeFileSync(loader, `globalThis.fetch = async (url, init) => {
        // Administrative reads are unreadable, as with the normal read-only Actions token.
        if (/\\/branches\\/main\\/protection$|\\/rules\\/branches\\/main\\?/.test(String(url))) return {ok:false,status:403};
        if (String(url) === 'https://api.github.com/graphql') {
          const {query} = JSON.parse(init.body);
          if (!query.includes('author{login}') || !query.includes('comments(last:100')) throw new Error('missing review query');
          return {ok:true,status:200,json:async()=>({data:{repository:{pullRequest:${JSON.stringify(pr)}}}})};
        }
        throw new Error('unexpected network request: ' + url);
      };\n`, { mode: 0o600 });
      const run = spawnSync(process.execPath, ['--import', loader,
        fileURLToPath(new URL('../../scripts/collect-review-qualification.mjs', import.meta.url))], {
        encoding: 'utf8', timeout: 10000,
        env: { PATH: process.env.PATH, GITHUB_REPOSITORY: REPO, PR_NUMBER: '1778',
          EXPECTED_HEAD_SHA: HEAD, GITHUB_TOKEN: 'fixture-only', REVIEW_QUALIFICATION_FILE: output },
      });
      assert.equal(run.status, stale ? 1 : 0, `${run.stdout}\n${run.stderr}`);
      const emitted = JSON.parse(readFileSync(output, 'utf8'));
      assert.equal(emitted.qualified, !stale);
      assert.equal(emitted.currentSha, HEAD);
      assert.equal(emitted.reviewDiagnostics.security.reviewedSha, stale ? OLD : HEAD);
      if (stale) assert.match(run.stdout, /Request Security review once/);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
