// Read-only verification for a separately owner-executed history squash.
// The caller MUST execute these reviewed bytes from a trusted pre-push checkout and use the
// platform's own push event. A candidate checkout, a commit trailer and a manually supplied
// ref/SHA are not authority. This module does not create commits/tags or move any ref.
import { REQUIRED_RELEASE_JOBS } from '../production-release-policy.mjs';
import { verifyReleaseSquashIdentity } from './releaseSquashIdentity.mjs';

const REPOSITORY = 'relativityE/speaksharp';
const REPOSITORY_ID = 1030860260;
const OWNER_ID = 36959427;
const PR = 1905;
const MAIN = 'refs/heads/main';
const API = 'https://api.github.com';
const BASE = `/repos/${REPOSITORY}`;
const SHA = /^(?!0{40}$)[0-9a-f]{40}$/;
const TAG = 'v[0-9]+\\.[0-9]+\\.[0-9]+(?:-[a-z0-9]+(?:[.-][a-z0-9]+)*)?';
const SCOPED_LINE = new RegExp(`^APPROVE UNCHANGED-TREE MAIN SQUASH old=([0-9a-f]{40}) new=([0-9a-f]{40}) baseline=refs/tags/(${TAG})@([0-9a-f]{40})$`);
const COMMENTS_QUERY = `query ManualSquashApproval($cursor: String) {
  repository(owner: "relativityE", name: "speaksharp") {
    nameWithOwner databaseId
    pullRequest(number: 1905) {
      number
      comments(first: 100, after: $cursor) {
        totalCount pageInfo { hasNextPage endCursor }
        nodes { id body createdAt lastEditedAt authorAssociation
          author { __typename ... on User { databaseId } }
        }
      }
    }
  }
}`;
const positive = n => Number.isSafeInteger(n) && n > 0;
const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value)
  ? Date.parse(value) : Number.NaN;
const pushEventTimestamp = value => positive(value) && value < 10_000_000_000 ? value * 1000 : timestamp(value);
const hold = reason => ({ ok: false, reason });
class Refusal extends Error {}
const requireFact = (test, reason) => { if (!test) throw new Refusal(reason); };

async function readApproval(graphql, push) {
    let cursor = null; let count; const ids = new Set(), cursors = new Set(), matches = [];
    for (let page = 0; page < 10; page++) {
        const result = await graphql(COMMENTS_QUERY, { cursor });
        const repo = result?.data?.repository;
        const comments = repo?.pullRequest?.comments;
        requireFact(!result?.errors && repo?.nameWithOwner === REPOSITORY && repo?.databaseId === REPOSITORY_ID
            && repo?.pullRequest?.number === PR && Array.isArray(comments?.nodes)
            && Number.isSafeInteger(comments.totalCount) && comments.totalCount >= 0
            && comments.nodes.length <= 100 && typeof comments.pageInfo?.hasNextPage === 'boolean',
        'approval-list-unproven');
        count ??= comments.totalCount;
        requireFact(count === comments.totalCount, 'approval-list-unproven');
        for (const c of comments.nodes) {
            requireFact(typeof c?.id === 'string' && c.id && !ids.has(c.id), 'approval-list-unproven');
            ids.add(c.id);
            if (c.author?.__typename !== 'User' || c.author.databaseId !== OWNER_ID || c.authorAssociation !== 'OWNER') continue;
            if (typeof c.body !== 'string' || /[\r\n]/.test(c.body)) continue;
            const parts = SCOPED_LINE.exec(c.body);
            if (!parts || parts[1] !== push.before || parts[2] !== push.after) continue;
            matches.push({ id: c.id, createdAt: c.createdAt, lastEditedAt: c.lastEditedAt,
                scope: { repository: REPOSITORY, ref: MAIN, before: parts[1], after: parts[2],
                    baselineTag: parts[3], baselineSha: parts[4] } });
        }
        if (!comments.pageInfo.hasNextPage) {
            requireFact(ids.size === count, 'approval-list-unproven');
            requireFact(matches.length === 1, matches.length ? 'approval-ambiguous' : 'approval-missing');
            const match = matches[0];
            requireFact(match.lastEditedAt === null && Number.isFinite(timestamp(match.createdAt)), 'approval-edited-or-unproven');
            return match;
        }
        cursor = comments.pageInfo.endCursor;
        requireFact(typeof cursor === 'string' && cursor && !cursors.has(cursor) && ids.size < count, 'approval-list-unproven');
        cursors.add(cursor);
    }
    throw new Refusal('approval-list-unproven');
}

const gitObject = object => ['commit', 'tag'].includes(object?.type) && SHA.test(object.sha ?? '');
async function readTag(read, tag) {
    const expectedRef = `refs/tags/${tag}`;
    const ref = await read(`${BASE}/git/ref/tags/${encodeURIComponent(tag)}`);
    requireFact(ref?.ref === expectedRef && gitObject(ref.object), 'tag-ref-mismatch');
    let object = ref.object;
    const seen = new Set();
    while (object.type === 'tag') {
        requireFact(seen.size < 4 && !seen.has(object.sha), 'tag-peel-unproven');
        seen.add(object.sha);
        const annotated = await read(`${BASE}/git/tags/${object.sha}`);
        requireFact(annotated?.sha === object.sha && gitObject(annotated.object), 'tag-peel-unproven');
        object = annotated.object;
    }
    return { ref: expectedRef, objectSha: ref.object.sha, commit: object.sha };
}
async function verifyMain(read, sha) {
    const ref = await read(`${BASE}/git/ref/heads/main`);
    requireFact(ref?.ref === MAIN && ref.object?.type === 'commit' && ref.object.sha === sha, 'current-main-mismatch');
}

// The webhook's repository.pushed_at is repository-level metadata. Instead, GitHub's
// repository activity supplies the server timestamp attached to these exact before/after refs.
// Require both timestamps to agree, so an old event cannot borrow a replayed before/after pair.
async function verifiedPushActivity(read, push, eventTimestamp) {
    const history = await read(`${BASE}/activity?ref=refs%2Fheads%2Fmain&activity_type=force_push&time_period=day&per_page=100`);
    requireFact(Array.isArray(history) && history.length < 100, 'push-activity-unproven');
    const matches = history.filter(entry => entry?.before === push.before && entry.after === push.after && entry.ref === MAIN);
    const [entry] = matches;
    const pushedAt = timestamp(entry?.timestamp);
    requireFact(matches.length === 1 && positive(entry.id) && entry.activity_type === 'force_push'
        && entry.actor?.type === 'User' && entry.actor.id === OWNER_ID
        && !['push_type','pusher','pushed_at'].some(key => Object.hasOwn(entry,key))
        && pushedAt === eventTimestamp, 'push-activity-unproven');
    return { id: entry.id, pushedAt };
}

async function priorMainCi(read, sha, approvedAt) {
    const response = await read(`${BASE}/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${sha}&per_page=100`);
    requireFact(Array.isArray(response?.workflow_runs) && response.workflow_runs.length === response.total_count
        && response.total_count <= 100, 'prior-ci-incomplete');
    const runs = response.workflow_runs.filter(run => run.head_sha === sha && run.head_branch === 'main' && run.event === 'push');
    requireFact(runs.length > 0 && runs.every(run => positive(run.id)) && new Set(runs.map(run => run.id)).size === runs.length,
        'prior-ci-unproven');
    // Do not select earlier success through a newer failed/re-running attempt.
    const run = runs.sort((left, right) => right.id - left.id)[0];
    requireFact(run.repository?.id === REPOSITORY_ID && run.head_repository?.id === REPOSITORY_ID
        && ['.github/workflows/ci.yml', '.github/workflows/ci.yml@main', '.github/workflows/ci.yml@refs/heads/main'].includes(run.path) && positive(run.run_attempt)
        && run.status === 'completed' && run.conclusion === 'success'
        && timestamp(run.created_at) <= timestamp(run.updated_at) && timestamp(run.updated_at) <= approvedAt,
    'prior-ci-unproven');
    const attempted = await read(`${BASE}/actions/runs/${run.id}/attempts/${run.run_attempt}`);
    const began = timestamp(attempted?.run_started_at);
    requireFact(attempted?.id === run.id && attempted.run_attempt === run.run_attempt
        && attempted.head_sha === sha && attempted.head_branch === 'main' && attempted.event === 'push'
        && attempted.status === 'completed' && attempted.conclusion === 'success'
        && began >= timestamp(run.created_at) && began <= timestamp(run.updated_at)
        && timestamp(attempted.updated_at) === timestamp(run.updated_at), 'prior-attempt-unproven');
    const jobs = []; let total;
    for (let page = 1; page <= 10; page++) {
        const r = await read(`${BASE}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`);
        requireFact(Array.isArray(r?.jobs) && Number.isSafeInteger(r.total_count) && r.total_count >= 0 && r.jobs.length <= 100, 'prior-jobs-incomplete');
        total ??= r.total_count;
        requireFact(total === r.total_count, 'prior-jobs-incomplete');
        jobs.push(...r.jobs);
        if (jobs.length === total) break;
        requireFact(jobs.length < total && r.jobs.length === 100, 'prior-jobs-incomplete');
    }
    requireFact(jobs.length === total && jobs.every(j => positive(j.id)) && new Set(jobs.map(j => j.id)).size === jobs.length, 'prior-jobs-incomplete');
    for (const name of REQUIRED_RELEASE_JOBS) {
        const found = jobs.filter(j => j.name === name);
        const [job] = found;
        requireFact(found.length === 1 && job.run_id === run.id && (!Object.hasOwn(job, 'run_attempt') || job.run_attempt === run.run_attempt)
            && job.head_sha === sha && job.status === 'completed' && job.conclusion === 'success'
            && timestamp(job.started_at) >= began && timestamp(job.completed_at) >= timestamp(job.started_at)
            && timestamp(job.completed_at) <= timestamp(run.updated_at),
        'prior-jobs-unproven');
        if (name === 'exact-head-review-qualification') {
            const reviews = Array.isArray(job.steps)
                ? job.steps.filter(step => step.name === 'Read independent review from GitHub and qualify the exact head') : [];
            requireFact(reviews.length === 1 && reviews[0].status === 'completed' && reviews[0].conclusion === 'success'
                && timestamp(reviews[0].started_at) >= timestamp(job.started_at)
                && timestamp(reviews[0].completed_at) >= timestamp(reviews[0].started_at)
                && timestamp(reviews[0].completed_at) <= timestamp(job.completed_at), 'prior-independent-review-unproven');
        }
    }
    return { runId: run.id, attempt: run.run_attempt };
}

/** Fetch only from the fixed GitHub API. fetchImpl is solely the transport seam for offline controls. */
export async function acquireManualSquashTrust({ eventName, event, token, fetchImpl = globalThis.fetch } = {}) {
    if (eventName !== 'push' || event?.repository?.id !== REPOSITORY_ID || event.repository.full_name !== REPOSITORY
        || event.ref !== MAIN || event.forced !== true || event.created !== false || event.deleted !== false
        || event.sender?.type !== 'User' || event.sender.id !== OWNER_ID
        || !SHA.test(event.before ?? '') || !SHA.test(event.after ?? '') || event.before === event.after) return hold('not-forced-main-push');
    const eventTimestamp = pushEventTimestamp(event.repository.pushed_at);
    if (!Number.isFinite(eventTimestamp)) return hold('push-time-unproven');
    if (typeof token !== 'string' || !token || /[\r\n]/.test(token)) return hold('github-reader-unavailable');
    const whole = AbortSignal.timeout(60_000);
    const request = async (pathname, query, variables) => {
        const response = await fetchImpl(API + pathname, {
            method: query ? 'POST' : 'GET',
            redirect: 'error', signal: AbortSignal.any([whole, AbortSignal.timeout(10_000)]),
            headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json',
                'x-github-api-version': '2022-11-28', 'cache-control': 'no-cache',
                ...(query ? { 'content-type': 'application/json' } : {}) },
            ...(query ? { body: JSON.stringify({ query, variables }) } : {}),
        });
        if (!response.ok || response.redirected) throw new Error('GitHub read failed');
        const reader = response.body?.getReader();
        if (!reader) throw new Error('Missing GitHub body');
        const decoder = new TextDecoder('utf-8', { fatal: true });
        let length = 0, text = '';
        try {
            for (;;) {
                const { value, done } = await reader.read();
                if (done) return JSON.parse(text + decoder.decode());
                length += value.byteLength;
                if (length > 2_000_000) throw new Error('GitHub response too large');
                text += decoder.decode(value, { stream: true });
            }
        } finally { void reader.cancel().catch(() => {}); }
    };
    const read = path => request(path);
    const gql = (query, variables) => request('/graphql', query, variables);
    try {
        await verifyMain(read, event.after);
        const [activity, approval] = await Promise.all([verifiedPushActivity(read,event,eventTimestamp), readApproval(gql, event)]);
        const approvedAt = timestamp(approval.createdAt);
        requireFact(approvedAt < activity.pushedAt, 'approval-not-prior-to-push');
        const [before, after, baseline] = await Promise.all([
            read(`${BASE}/git/commits/${event.before}`), read(`${BASE}/git/commits/${event.after}`),
            readTag(read, approval.scope.baselineTag),
        ]);
        const structural = verifyReleaseSquashIdentity({ push: event, before, after, approval: approval.scope, baselineTag: baseline });
        requireFact(structural.ok, structural.reason);
        const ci = await priorMainCi(read, event.before, approvedAt);
        // The independent reads may race an edit/ref change. Revalidate the authority and the exact tag objects.
        const [secondApproval, secondBaseline] = await Promise.all([
            readApproval(gql, event), readTag(read, approval.scope.baselineTag),
        ]);
        requireFact(JSON.stringify(secondApproval) === JSON.stringify(approval), 'approval-changed');
        requireFact(JSON.stringify(secondBaseline) === JSON.stringify(baseline), 'tag-changed');
        await verifyMain(read, event.after);
        return { ...structural, approvalCommentId: approval.id, pushActivityId: activity.id, priorCiRunId: ci.runId, priorCiAttempt: ci.attempt,
            baselineRef: baseline.ref, baselineSha: baseline.commit };
    } catch (error) {
        return hold(error instanceof Refusal ? error.message : 'github-trust-unavailable');
    }
}
