import { describe, expect, it } from 'vitest';
import { REQUIRED_RELEASE_JOBS } from '../../scripts/production-release-policy.mjs';
import { acquireManualSquashTrust } from '../../scripts/lib/releaseSquashTrust.mjs';

const repo = 'relativityE/speaksharp';
const repoId = 1030860260;
const ownerId = 36959427;
const main = 'refs/heads/main';
const before = '1'.repeat(40), after = '2'.repeat(40), tree = '3'.repeat(40), checkpoint = '4'.repeat(40);
const annotated = '5'.repeat(40);
const predecessorTag = 'v0.9.0-rc4';
const start = '2026-11-21T09:00:00Z', end = '2026-11-21T09:10:00Z';
const approvedAt = '2026-11-21T09:15:00Z', pushedAt = '2026-11-21T09:16:00Z';
const body = `APPROVE UNCHANGED-TREE MAIN SQUASH old=${before} new=${after} baseline=refs/tags/${predecessorTag}@${checkpoint}`;
const github = `/repos/${repo}`;

function fixture() {
  const event = { repository: { id: repoId, full_name: repo, pushed_at: Date.parse(pushedAt) / 1000 },
    ref: main, forced: true, created: false, deleted: false, before, after, sender: { type: 'User', id: ownerId } };
  const comment = { id: 'IC_owner', body, createdAt: approvedAt, lastEditedAt: null, authorAssociation: 'OWNER',
    author: { __typename: 'User', databaseId: ownerId } };
  const run = { id: 123, run_attempt: 2, head_sha: before, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success',
    path: '.github/workflows/ci.yml@main', repository: { id: repoId }, head_repository: { id: repoId },
    created_at: '2026-11-21T08:30:00Z', run_started_at: start, updated_at: end };
  const jobs = REQUIRED_RELEASE_JOBS.map((name, index) => ({ name, id: index + 1, run_id: 123, head_sha: before,
    status: 'completed', conclusion: 'success', started_at: start, completed_at: end, steps: name === 'exact-head-review-qualification' ? [{
      name:'Read independent review from GitHub and qualify the exact head', status:'completed', conclusion:'success',
      started_at:start, completed_at:end }] : [] }));
  const mainObject = { ref: main, object: { type: 'commit', sha: after } };
  const baseline = { ref: `refs/tags/${predecessorTag}`, object: { type: 'tag', sha: annotated } };
  const beforeObject = { sha: before, tree: { sha: tree } };
  const afterObject = { sha: after, tree: { sha: tree }, parents: [{ sha: checkpoint }] };
  const calls = [];
  const activity = [{ id: 456, before, after, ref: main, timestamp: pushedAt, activity_type: 'force_push', actor: { type: 'User', id: ownerId } }];
  const f = { event, activity, comment, comments: [comment], run, runs: [run], jobs, mainObject, baseline, beforeObject, afterObject, calls };
  f.fetchImpl = async (url, options) => {
    const u = new URL(url); calls.push(u.pathname + u.search);
    expect(u.origin).toBe('https://api.github.com');
    expect(options.redirect).toBe('error');
    expect(options.headers.authorization).toBe('Bearer test-only');
    let payload;
    if (u.pathname === '/graphql') {
      expect(options.method).toBe('POST');
      const query = JSON.parse(options.body);
      expect(query.query).toContain('pullRequest(number: 1905)');
      expect(query.query).toContain('lastEditedAt');
      payload = { data: { repository: { nameWithOwner: repo, databaseId: repoId, pullRequest: { number: 1905,
        comments: f.pages ? f.pages(query.variables.cursor) : {
          totalCount: f.comments.length, nodes: f.comments, pageInfo: { hasNextPage: false, endCursor: null },
        } } } } };
    } else {
      expect(options.method).toBe('GET');
      if (u.pathname === `${github}/activity`) {
        expect(Object.fromEntries(u.searchParams)).toEqual({ref:main,activity_type:'force_push',time_period:'day',per_page:'100'});
        payload = f.activity;
      }
      if (u.pathname === `${github}/git/ref/heads/main`) payload = f.mainObject;
      if (u.pathname === `${github}/git/ref/tags/${predecessorTag}`) payload = f.baseline;
      if (u.pathname === `${github}/git/tags/${annotated}`) payload = { sha: annotated, object: { type: 'commit', sha: checkpoint } };
      if (u.pathname === `${github}/git/commits/${before}`) payload = f.beforeObject;
      if (u.pathname === `${github}/git/commits/${after}`) payload = f.afterObject;
      if (u.pathname === `${github}/actions/workflows/ci.yml/runs`) {
        expect(Object.fromEntries(u.searchParams)).toEqual({branch:'main', event:'push', head_sha:before, per_page:'100'});
        payload = { total_count: f.runs.length, workflow_runs: f.runs };
      }
      if (u.pathname === `${github}/actions/runs/123/attempts/2`) payload = f.attempt ?? f.run;
      if (u.pathname === `${github}/actions/runs/123/attempts/2/jobs`) payload = { total_count: f.jobs.length, jobs: f.jobs };
    }
    if (!payload) throw new Error(`unexpected test read: ${url}`);
    return Response.json(payload);
  };
  f.execute = overrides => acquireManualSquashTrust({ eventName: 'push', event, token: 'test-only', fetchImpl: f.fetchImpl, ...overrides });
  return f;
}

describe('manual squash trust comes only from exact owner approval and old main CI', () => {
  it('verifies the annotated baseline and exact workflow attempt without any new tag', async () => {
    const f = fixture();
    expect(await f.execute()).toEqual({ ok: true, beforeSha: before, afterSha: after, treeSha: tree,
      approvalCommentId: 'IC_owner', pushActivityId: 456, priorCiRunId: 123, priorCiAttempt: 2,
      baselineRef: `refs/tags/${predecessorTag}`, baselineSha: checkpoint });
    expect(f.calls.filter(value => value === '/graphql')).toHaveLength(2);
    expect(f.calls.filter(value => value.includes('/git/ref/tags/'))).toEqual(
      Array(2).fill(`${github}/git/ref/tags/${predecessorTag}`));
    expect(f.calls.filter(value => value === `${github}/git/ref/heads/main`)).toHaveLength(2);
  });

  it('refuses alternative or mixed REST activity aliases', async () => {
    const f = fixture();
    f.activity[0].push_type = 'force_push';
    expect(await f.execute()).toEqual({ ok:false, reason:'push-activity-unproven' });
  });

  it.each([
    ['ordinary push', f => { f.event.forced = false; }],
    ['untrusted sender', f => { f.event.sender = { type: 'Bot', id: ownerId }; }],
    ['untrusted repository ID', f => { f.event.repository.id = 1; }],
  ])('refuses %s before any trust read', async (_, mutate) => {
    const f = fixture(); mutate(f);
    expect(await f.execute()).toEqual({ok:false, reason:'not-forced-main-push'});
    expect(f.calls).toEqual([]);
  });

  it.each([
    ['no approval despite forged title/trailer and equal tree', f => { f.comments = []; f.afterObject.message = body; }, 'approval-missing'],
    ['different user', f => { f.comment.author.databaseId = 1; }, 'approval-missing'],
    ['bot impersonation', f => { f.comment.author.__typename = 'Bot'; }, 'approval-missing'],
    ['approval formatted as a quotation', f => { f.comment.body = '> ' + body; }, 'approval-missing'],
    ['multiline or trailing prose', f => { f.comment.body += '\nLooks good'; }, 'approval-missing'],
    ['edited approval', f => { f.comment.lastEditedAt = approvedAt; }, 'approval-edited-or-unproven'],
    ['missing edit state', f => { delete f.comment.lastEditedAt; }, 'approval-edited-or-unproven'],
    ['approval after push', f => { f.comment.createdAt = '2026-11-21T09:18:00Z'; }, 'approval-not-prior-to-push'],
    ['same-second approval cannot prove ordering', f => { f.comment.createdAt = pushedAt; }, 'approval-not-prior-to-push'],
    ['duplicate approval', f => { f.comments.push({ ...f.comment, id:'IC_duplicate' }); }, 'approval-ambiguous'],
    ['incomplete comment pagination', f => { f.pages = () => ({totalCount:2,nodes:[f.comment],pageInfo:{hasNextPage:false}}); }, 'approval-list-unproven'],
    ['different tree', f => { f.afterObject.tree.sha = '6'.repeat(40); }, 'tree-mismatch'],
    ['mismatched peeled checkpoint', f => { f.afterObject.parents[0].sha = '6'.repeat(40); }, 'baseline-parent-mismatch'],
    ['adding a desired tag changes the reviewed approval grammar', f => { f.comment.body += ' intended=refs/tags/v0.9.5'; }, 'approval-missing'],
    ['older success followed by newer failure', f => { f.runs.push({...f.run,id:124,conclusion:'failure'}); }, 'prior-ci-unproven'],
    ['other event CI instead of actual main push', f => { f.run.event='pull_request'; }, 'prior-ci-unproven'],
    ['CI completed after approval', f => { f.run.updated_at=pushedAt; }, 'prior-ci-unproven'],
    ['other attempt metadata', f => { f.attempt={...f.run,run_attempt:1}; }, 'prior-attempt-unproven'],
    ['job reused from older attempt', f => { f.jobs[0].started_at='2026-11-21T08:45:00Z'; }, 'prior-jobs-unproven'],
    ['job binding forged despite good time', f => { f.jobs[0].run_attempt=1; }, 'prior-jobs-unproven'],
    ['prior job only verified an earlier squash', f => { f.jobs.find(j => j.name==='exact-head-review-qualification').steps[0].conclusion='skipped'; }, 'prior-independent-review-unproven'],
    ['prior successful review job lacks the independent collector step', f => { f.jobs.find(j => j.name==='exact-head-review-qualification').steps=[]; }, 'prior-independent-review-unproven'],
    ['missing required job', f => { f.jobs.pop(); }, 'prior-jobs-unproven'],
    ['ambiguous duplicate required job', f => { f.jobs.push({...f.jobs[0],id:99}); }, 'prior-jobs-unproven'],
    ['push webhook timestamp missing', f => { delete f.event.repository.pushed_at; }, 'push-time-unproven'],
    ['old webhook cannot borrow a replayed matching SHA pair', f => { f.event.repository.pushed_at-=120; }, 'push-activity-unproven'],
    ['push activity time absent despite webhook time', f => { delete f.activity[0].timestamp; }, 'push-activity-unproven'],
    ['push activity names a different commit', f => { f.activity[0].after=before; }, 'push-activity-unproven'],
    ['push activity is ambiguous', f => { f.activity.push({...f.activity[0],id:457}); }, 'push-activity-unproven'],
    ['activity is not an owner-recorded force push', f => { f.activity[0].activity_type='normal'; }, 'push-activity-unproven'],
  ])('fails closed on %s', async (_, mutate, reason) => {
    const f = fixture(); mutate(f);
    expect(await f.execute()).toEqual({ok:false, reason});
  });

  it('rechecks owner approval, and refuses when it changes between reads', async () => {
    const f = fixture(); let reads=0;
    f.pages = () => ({totalCount:1, nodes:[{...f.comment,lastEditedAt: reads++ ? pushedAt : null}], pageInfo:{hasNextPage:false}});
    expect(await f.execute()).toEqual({ok:false,reason:'approval-edited-or-unproven'});
  });
});
