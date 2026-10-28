/**
 * #1573 (Browser PM 6067238534, user priority) — REVIEW ACTIVITY NEVER RE-RUNS OR CANCELS THE ENGINEERING LANE.
 *
 * `ci.yml` subscribed to review and inline-comment events, forced the full lane for both and shared `ci-<PR>` with
 * `cancel-in-progress: true`, so every Codex finding cancelled and rebuilt the same candidate. Review activity now runs a
 * separate, cheap review lane that reuses the exact-head engineering evidence and still fails closed on findings.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import { evaluateEngineeringEvidence, ENGINEERING_HOLD } from '../../scripts/ci-engineering-evidence.mjs';
import { DOCUMENTATION_EVIDENCE_ADMISSION } from '../../scripts/review-qualification.mjs';

describe('#1674 documentation metadata reaches the actual collection CLI', () => {
    it.each(['accepted', 'wrong blob', 'truncated tree', 'base drift'])('collects and refuses from the same shared reader: %s', scenario => {
        const root = mkdtempSync(resolve(tmpdir(), 'documentation-collection-'));
        const head = '985e45332313b2aaf27f9581e0df42be26e618df';
        const base = '8a79eafa23bd3beeee6d087270acd9ed5a16eb1e';
        const tree = 'f04e4e4a2cb1e8cdd9d10b0f4957c6a2a7f39b6d';
        const repo = 'relativityE/speaksharp';
        const pull = { number: 1674, headRefOid: head, baseRefOid: base, baseRefName: 'main', headRefName: 'docs',
            baseRepository: { nameWithOwner: repo }, headRepository: { nameWithOwner: repo },
            files: { nodes: DOCUMENTATION_EVIDENCE_ADMISSION.files.map(({ path }) => ({ path })), pageInfo: { hasNextPage: false } },
            reviews: { nodes: [{ author: { login: 'chatgpt-codex-connector' }, state: 'COMMENTED', commit: { oid: head },
                body: 'reviewed', submittedAt: '2026-10-28T17:34:11Z' }], pageInfo: { hasPreviousPage: false } },
            reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } }, comments: { nodes: [], pageInfo: { hasPreviousPage: false } } };
        const entries = DOCUMENTATION_EVIDENCE_ADMISSION.files.map(({ oid, ...row }) => ({ ...row, sha: oid, type: 'blob' }));
        if (scenario === 'wrong blob') entries[0].sha = 'a'.repeat(40);
        try {
            writeFileSync(resolve(root, 'fixture.json'), JSON.stringify({ pull, entries, head, base, tree, scenario }));
            writeFileSync(resolve(root, 'fetch.mjs'), `
                import { readFileSync, writeFileSync } from 'node:fs';
                const f=JSON.parse(readFileSync(new URL('./fixture.json',import.meta.url),'utf8'));const calls=[];
                process.on('exit',()=>writeFileSync(new URL('./calls.json',import.meta.url),JSON.stringify(calls)));
                globalThis.fetch=async(url,options)=>{
                    const u=new URL(url);calls.push(u.pathname+u.search);
                    if(u.origin!=='https://api.github.com'||options.headers.Authorization!=='Bearer synthetic')throw Error('unexpected network');
                    let value;
                    if(u.pathname==='/graphql'){
                        const query=JSON.parse(options.body).query;const pull=structuredClone(f.pull);
                        if(query.includes('documentationPostimageIdentity')&&f.scenario==='base drift')pull.baseRefOid='b'.repeat(40);
                        value={data:{repository:{pullRequest:pull}}};
                    }else if(u.pathname.endsWith('/git/commits/'+f.head))value={sha:f.head,tree:{sha:f.tree}};
                    else if(u.pathname.endsWith('/git/trees/'+f.tree))value={sha:f.tree,truncated:f.scenario==='truncated tree',tree:f.entries};
                    else if(u.pathname.endsWith('/activity'))value=[];
                    else if(u.pathname.endsWith('/branches/main/protection'))value={required_conversation_resolution:{enabled:true},enforce_admins:{enabled:true}};
                    else if(u.pathname.endsWith('/rules/branches/main'))value=[];
                    else throw Error('unexpected API');
                    return {ok:true,status:200,json:async()=>value};
                };`);
            const output = resolve(root, 'receipt.json');
            const child = spawnSync(process.execPath, ['--import', resolve(root, 'fetch.mjs'),
                resolve(process.cwd(), 'scripts/collect-review-qualification.mjs')], {
                cwd: process.cwd(), encoding: 'utf8', timeout: 10000,
                env: { GITHUB_REPOSITORY: repo, GITHUB_TOKEN: 'synthetic', PR_NUMBER: '1674',
                    EXPECTED_HEAD_SHA: head, REVIEW_QUALIFICATION_FILE: output },
            });
            expect(child.error).toBeUndefined();
            expect(child.status).toBe(scenario === 'accepted' ? 0 : 1);
            const receipt = JSON.parse(readFileSync(output, 'utf8'));
            expect(receipt.qualified).toBe(scenario === 'accepted');
            const calls = JSON.parse(readFileSync(resolve(root, 'calls.json'), 'utf8'));
            expect(calls).toContain('/repos/' + repo + '/git/commits/' + head);
            expect(calls).toContain('/repos/' + repo + '/git/trees/' + tree + '?recursive=1');
        } finally { rmSync(root, { recursive: true, force: true }); }
    });
});
const load = (f) => yaml.load(readFileSync(resolve(process.cwd(), '.github/workflows', f), 'utf8'));
const REVIEW_EVENTS = ['pull_request_review', 'pull_request_review_comment'];

describe('owner-selected #1740 exact reviewed workflow transition', () => {
    const HEAD = 'a'.repeat(40), BASE = 'b'.repeat(40);
    const oldCi = '9a45994600c44f35ec72e27998b20f313ab83e29';
    const newCi = 'f2d3223191d8cbbb0ccfcc328270a1d51e54d491';
    const review = '9c948004790029105bf437058d8913ecf7439c40';
    const run = (extra = {}) => ({ id: 174000, run_attempt: 1, event: 'pull_request', status: 'completed', conclusion: 'success',
        head_sha: HEAD, created_at: '2026-10-28T00:00:00Z', pull_requests: [{ number: 1740, base: { sha: BASE } }], ...extra });
    const jobs = () => ({ scope: 'success', 'full-evidence': 'success', report: 'success', build: 'success' });
    const input = () => ({ repository: 'relativityE/speaksharp', baseRepository: 'relativityE/speaksharp',
        headRepository: 'relativityE/speaksharp', baseRef: 'main', pr: 1740, liveHeadSha: HEAD, liveBaseSha: BASE,
        expectedHeadSha: HEAD, headContainsBase: true, workflowUnchanged: false,
        workflowBlobs: { baseCi: oldCi, headCi: newCi, baseReview: review, headReview: review },
        runsComplete: true, jobsComplete: true, runs: [run()], jobsByRun: { 174000: jobs() } });
    it('admits only the named real transition and records it rather than pretending the workflow is unchanged', () => {
        const decision = evaluateEngineeringEvidence(input());
        expect(decision).toMatchObject({ qualified: true, runId: 174000, reasons: [], workflowTransition: {
            repository: 'relativityE/speaksharp', pr: 1740, baseRef: 'main', baseCi: oldCi, headCi: newCi,
            reviewWorkflowUnchanged: true,
        } });
        expect(input().workflowUnchanged).toBe(false);
    });
    it.each([
        ['wrong repository', { repository: 'other/speaksharp' }], ['wrong base repository', { baseRepository: 'other/speaksharp' }],
        ['fork head', { headRepository: 'other/speaksharp' }], ['another PR', { pr: 1745 }],
        ['missing PR', { pr: undefined }], ['non-main base', { baseRef: 'release' }],
        ['missing base', { liveBaseSha: undefined }], ['missing head', { liveHeadSha: undefined }],
        ['missing expected head', { expectedHeadSha: undefined }], ['unknown workflow identity', { workflowUnchanged: undefined }],
        ['base not included', { headContainsBase: false }], ['incomplete run history', { runsComplete: false }],
        ['incomplete jobs', { jobsComplete: false }], ['missing completeness', { jobsComplete: undefined }],
    ])('holds %s despite successful jobs', (_name, extra) => {
        expect(evaluateEngineeringEvidence({ ...input(), ...extra }).qualified).toBe(false);
    });
    it.each([
        ['wrong old blob', { baseCi: 'c'.repeat(40) }], ['wrong new blob', { headCi: 'd'.repeat(40) }],
        ['reversed transition', { baseCi: newCi, headCi: oldCi }], ['review workflow edited', { headReview: 'e'.repeat(40) }],
        ['missing CI identity', { headCi: undefined }], ['missing review identity', { baseReview: undefined }],
        ['malformed review identity', { baseReview: 'same', headReview: 'same' }],
    ])('holds %s', (_name, extra) => {
        const value = input(); value.workflowBlobs = { ...value.workflowBlobs, ...extra };
        expect(evaluateEngineeringEvidence(value).qualified).toBe(false);
    });
    it('retains expected-head and stale-base refusals after the transition is admitted', () => {
        expect(evaluateEngineeringEvidence({ ...input(), expectedHeadSha: 'f'.repeat(40) }).reasons).toContain(ENGINEERING_HOLD.HEAD_MOVED);
        expect(evaluateEngineeringEvidence({ ...input(), runs: [run({ pull_requests: [{ number: 1740, base: { sha: 'f'.repeat(40) } }] })] }).reasons)
            .toContain(ENGINEERING_HOLD.BASE_MISMATCH);
    });
    it('never chooses an older success over a newer pending or failed run', () => {
        for (const state of ['in_progress', 'failure']) {
            const value = input();
            value.runs.push(run({ id: 174001, created_at: '2026-10-28T00:01:00Z', status: state === 'in_progress' ? state : 'completed',
                conclusion: state === 'in_progress' ? null : 'failure' }));
            value.jobsByRun[174001] = { ...jobs(), report: state === 'failure' ? 'failure' : null };
            expect(evaluateEngineeringEvidence(value)).toMatchObject({ qualified: false, runId: 174001 });
        }
    });
    it('still refuses missing, skipped or failed engineering evidence', () => {
        for (const outcome of [undefined, 'skipped', 'failure']) {
            const value = input(); value.jobsByRun[174000]['full-evidence'] = outcome;
            expect(evaluateEngineeringEvidence(value).qualified).toBe(false);
        }
    });
    it.each(['accepted', 'wrong-PR', 'wrong-CI', 'edited-review', 'missing-review', 'incomplete-history', 'incomplete-jobs'])(
        'actual CLI binds API identities and records the real transition: %s', (scenario) => {
        const dir = mkdtempSync(resolve(tmpdir(), 'engineering-transition-'));
        try {
            const pr = scenario === 'wrong-PR' ? 1745 : 1740;
            const prefix = '/repos/relativityE/speaksharp';
            const responses = {
                [`${prefix}/pulls/${pr}`]: { head: { sha: HEAD, repo: { full_name: 'relativityE/speaksharp' } },
                    base: { sha: BASE, ref: 'main', repo: { full_name: 'relativityE/speaksharp' } } },
                [`${prefix}/actions/workflows/ci.yml/runs?head_sha=${HEAD}&per_page=50`]: {
                    total_count: scenario === 'incomplete-history' ? 2 : 1, workflow_runs: [run()],
                },
                [`${prefix}/actions/runs/174000/jobs?filter=latest&per_page=100`]: {
                    total_count: scenario === 'incomplete-jobs' ? 5 : 4,
                    jobs: Object.entries(jobs()).map(([name, conclusion]) => ({ name, conclusion })),
                },
                [`${prefix}/compare/${BASE}...${HEAD}`]: { status: 'ahead' },
                [`${prefix}/contents/.github/workflows/ci.yml?ref=${BASE}`]: { sha: oldCi },
                [`${prefix}/contents/.github/workflows/ci.yml?ref=${HEAD}`]: { sha: scenario === 'wrong-CI' ? 'c'.repeat(40) : newCi },
                [`${prefix}/contents/.github/workflows/review-qualification.yml?ref=${BASE}`]: { sha: review },
                [`${prefix}/contents/.github/workflows/review-qualification.yml?ref=${HEAD}`]: {
                    sha: scenario === 'missing-review' ? undefined : scenario === 'edited-review' ? 'e'.repeat(40) : review,
                },
            };
            writeFileSync(resolve(dir, 'responses.json'), JSON.stringify(responses));
            writeFileSync(resolve(dir, 'fetch.mjs'), `
                import { readFileSync, writeFileSync } from 'node:fs';
                const responses = JSON.parse(readFileSync(new URL('./responses.json', import.meta.url), 'utf8'));
                const calls = [];
                process.on('exit', () => writeFileSync(new URL('./calls.json', import.meta.url), JSON.stringify(calls)));
                globalThis.fetch = async (url, options) => {
                    const parsed = new URL(url);
                    const key = parsed.pathname + parsed.search;
                    if (parsed.origin !== 'https://api.github.com' || !Object.hasOwn(responses, key)
                        || options?.headers?.Authorization !== 'Bearer synthetic-fixture-only') {
                        throw new Error('Unexpected request; external networking is forbidden in this fixture');
                    }
                    calls.push(key);
                    return { ok: true, status: 200, json: async () => responses[key] };
                };
            `);
            const output = resolve(dir, 'receipt.json');
            const child = spawnSync(process.execPath, ['--import', resolve(dir, 'fetch.mjs'),
                resolve(process.cwd(), 'scripts/ci-engineering-evidence.mjs')], {
                cwd: process.cwd(), encoding: 'utf8', timeout: 10000,
                env: { GITHUB_REPOSITORY: 'relativityE/speaksharp', GITHUB_TOKEN: 'synthetic-fixture-only',
                    PR_NUMBER: String(pr), EXPECTED_HEAD_SHA: HEAD, ENGINEERING_EVIDENCE_FILE: output },
            });
            expect(child.error).toBeUndefined();
            const calls = JSON.parse(readFileSync(resolve(dir, 'calls.json'), 'utf8'));
            expect(calls).toHaveLength(8);
            expect(child.status).toBe(scenario === 'accepted' ? 0 : 1);
            const receipt = existsSync(output) ? JSON.parse(readFileSync(output, 'utf8')) : null;
            expect(receipt?.workflowUnchanged).toBe(scenario === 'missing-review' ? undefined : false);
            expect(receipt?.qualified).toBe(scenario === 'missing-review' ? undefined : scenario === 'accepted');
            const admitted = expect.objectContaining({ pr: 1740, baseCi: oldCi, headCi: newCi });
            expect(receipt?.workflowTransition).toEqual(scenario === 'accepted' ? admitted : undefined);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('owner-selected #1747 exact reviewed workflow transition', () => {
    const HEAD = 'a'.repeat(40), BASE = 'b'.repeat(40);
    const oldCi = 'f2d3223191d8cbbb0ccfcc328270a1d51e54d491';
    const newCi = '8dd161fdee91ff4f3f9f1dcc3d635c047c590b54';
    const review = '9c948004790029105bf437058d8913ecf7439c40';
    const run = (extra = {}) => ({ id: 174700, run_attempt: 1, event: 'pull_request', status: 'completed', conclusion: 'success',
        head_sha: HEAD, created_at: '2026-10-28T00:00:00Z', pull_requests: [{ number: 1747, base: { sha: BASE } }], ...extra });
    const jobs = () => ({ scope: 'success', 'full-evidence': 'success', report: 'success', build: 'success' });
    const input = () => ({ repository: 'relativityE/speaksharp', baseRepository: 'relativityE/speaksharp',
        headRepository: 'relativityE/speaksharp', baseRef: 'main', pr: 1747, liveHeadSha: HEAD, liveBaseSha: BASE,
        expectedHeadSha: HEAD, headContainsBase: true, workflowUnchanged: false,
        workflowBlobs: { baseCi: oldCi, headCi: newCi, baseReview: review, headReview: review },
        runsComplete: true, jobsComplete: true, runs: [run()], jobsByRun: { 174700: jobs() } });
    it('admits only the named real transition and records it rather than pretending the workflow is unchanged', () => {
        const decision = evaluateEngineeringEvidence(input());
        expect(decision).toMatchObject({ qualified: true, runId: 174700, reasons: [], workflowTransition: {
            repository: 'relativityE/speaksharp', pr: 1747, baseRef: 'main', baseCi: oldCi, headCi: newCi,
            reviewWorkflowUnchanged: true,
        } });
        expect(input().workflowUnchanged).toBe(false);
    });
    it.each([
        ['wrong repository', { repository: 'other/speaksharp' }], ['wrong base repository', { baseRepository: 'other/speaksharp' }],
        ['fork head', { headRepository: 'other/speaksharp' }], ['another PR', { pr: 1745 }],
        ['missing PR', { pr: undefined }], ['non-main base', { baseRef: 'release' }],
        ['missing base', { liveBaseSha: undefined }], ['missing head', { liveHeadSha: undefined }],
        ['missing expected head', { expectedHeadSha: undefined }], ['unknown workflow identity', { workflowUnchanged: undefined }],
        ['base not included', { headContainsBase: false }], ['incomplete run history', { runsComplete: false }],
        ['incomplete jobs', { jobsComplete: false }], ['missing completeness', { jobsComplete: undefined }],
    ])('holds %s despite successful jobs', (_name, extra) => {
        expect(evaluateEngineeringEvidence({ ...input(), ...extra }).qualified).toBe(false);
    });
    it.each([
        ['wrong old blob', { baseCi: 'c'.repeat(40) }], ['wrong new blob', { headCi: 'd'.repeat(40) }],
        ['reversed transition', { baseCi: newCi, headCi: oldCi }], ['review workflow edited', { headReview: 'e'.repeat(40) }],
        ['missing CI identity', { headCi: undefined }], ['missing review identity', { baseReview: undefined }],
        ['malformed review identity', { baseReview: 'same', headReview: 'same' }],
    ])('holds %s', (_name, extra) => {
        const value = input(); value.workflowBlobs = { ...value.workflowBlobs, ...extra };
        expect(evaluateEngineeringEvidence(value).qualified).toBe(false);
    });
    it('refuses a different review workflow even when both blobs agree', () => {
        const value = input(); value.workflowBlobs.baseReview = 'f'.repeat(40); value.workflowBlobs.headReview = 'f'.repeat(40);
        expect(evaluateEngineeringEvidence(value).qualified).toBe(false);
    });
    it('retains expected-head and stale-base refusals after the transition is admitted', () => {
        expect(evaluateEngineeringEvidence({ ...input(), expectedHeadSha: 'f'.repeat(40) }).reasons).toContain(ENGINEERING_HOLD.HEAD_MOVED);
        expect(evaluateEngineeringEvidence({ ...input(), runs: [run({ pull_requests: [{ number: 1747, base: { sha: 'f'.repeat(40) } }] })] }).reasons)
            .toContain(ENGINEERING_HOLD.BASE_MISMATCH);
    });
    it('never chooses an older success over a newer pending or failed run', () => {
        for (const state of ['in_progress', 'failure']) {
            const value = input();
            value.runs.push(run({ id: 174701, created_at: '2026-10-28T00:01:00Z', status: state === 'in_progress' ? state : 'completed',
                conclusion: state === 'in_progress' ? null : 'failure' }));
            value.jobsByRun[174701] = { ...jobs(), report: state === 'failure' ? 'failure' : null };
            expect(evaluateEngineeringEvidence(value)).toMatchObject({ qualified: false, runId: 174701 });
        }
    });
    it('still refuses missing, skipped or failed engineering evidence', () => {
        for (const outcome of [undefined, 'skipped', 'failure']) {
            const value = input(); value.jobsByRun[174700]['full-evidence'] = outcome;
            expect(evaluateEngineeringEvidence(value).qualified).toBe(false);
        }
    });
    it.each(['accepted', 'wrong-PR', 'wrong-CI', 'edited-review', 'missing-review', 'incomplete-history', 'incomplete-jobs'])(
        'actual CLI binds API identities and records the real transition: %s', (scenario) => {
        const dir = mkdtempSync(resolve(tmpdir(), 'engineering-transition-'));
        try {
            const pr = scenario === 'wrong-PR' ? 1745 : 1747;
            const prefix = '/repos/relativityE/speaksharp';
            const responses = {
                [`${prefix}/pulls/${pr}`]: { head: { sha: HEAD, repo: { full_name: 'relativityE/speaksharp' } },
                    base: { sha: BASE, ref: 'main', repo: { full_name: 'relativityE/speaksharp' } } },
                [`${prefix}/actions/workflows/ci.yml/runs?head_sha=${HEAD}&per_page=50`]: {
                    total_count: scenario === 'incomplete-history' ? 2 : 1, workflow_runs: [run()],
                },
                [`${prefix}/actions/runs/174700/jobs?filter=latest&per_page=100`]: {
                    total_count: scenario === 'incomplete-jobs' ? 5 : 4,
                    jobs: Object.entries(jobs()).map(([name, conclusion]) => ({ name, conclusion })),
                },
                [`${prefix}/compare/${BASE}...${HEAD}`]: { status: 'ahead' },
                [`${prefix}/contents/.github/workflows/ci.yml?ref=${BASE}`]: { sha: oldCi },
                [`${prefix}/contents/.github/workflows/ci.yml?ref=${HEAD}`]: { sha: scenario === 'wrong-CI' ? 'c'.repeat(40) : newCi },
                [`${prefix}/contents/.github/workflows/review-qualification.yml?ref=${BASE}`]: { sha: review },
                [`${prefix}/contents/.github/workflows/review-qualification.yml?ref=${HEAD}`]: {
                    sha: scenario === 'missing-review' ? undefined : scenario === 'edited-review' ? 'e'.repeat(40) : review,
                },
            };
            writeFileSync(resolve(dir, 'responses.json'), JSON.stringify(responses));
            writeFileSync(resolve(dir, 'fetch.mjs'), `
                import { readFileSync, writeFileSync } from 'node:fs';
                const responses = JSON.parse(readFileSync(new URL('./responses.json', import.meta.url), 'utf8'));
                const calls = [];
                process.on('exit', () => writeFileSync(new URL('./calls.json', import.meta.url), JSON.stringify(calls)));
                globalThis.fetch = async (url, options) => {
                    const parsed = new URL(url);
                    const key = parsed.pathname + parsed.search;
                    if (parsed.origin !== 'https://api.github.com' || !Object.hasOwn(responses, key)
                        || options?.headers?.Authorization !== 'Bearer synthetic-fixture-only') {
                        throw new Error('Unexpected request; external networking is forbidden in this fixture');
                    }
                    calls.push(key);
                    return { ok: true, status: 200, json: async () => responses[key] };
                };
            `);
            const output = resolve(dir, 'receipt.json');
            const child = spawnSync(process.execPath, ['--import', resolve(dir, 'fetch.mjs'),
                resolve(process.cwd(), 'scripts/ci-engineering-evidence.mjs')], {
                cwd: process.cwd(), encoding: 'utf8', timeout: 10000,
                env: { GITHUB_REPOSITORY: 'relativityE/speaksharp', GITHUB_TOKEN: 'synthetic-fixture-only',
                    PR_NUMBER: String(pr), EXPECTED_HEAD_SHA: HEAD, ENGINEERING_EVIDENCE_FILE: output },
            });
            expect(child.error).toBeUndefined();
            const calls = JSON.parse(readFileSync(resolve(dir, 'calls.json'), 'utf8'));
            expect(calls).toHaveLength(8);
            expect(child.status).toBe(scenario === 'accepted' ? 0 : 1);
            const receipt = existsSync(output) ? JSON.parse(readFileSync(output, 'utf8')) : null;
            expect(receipt?.workflowUnchanged).toBe(scenario === 'missing-review' ? undefined : false);
            expect(receipt?.qualified).toBe(scenario === 'missing-review' ? undefined : scenario === 'accepted');
            const admitted = expect.objectContaining({ pr: 1747, baseCi: oldCi, headCi: newCi });
            expect(receipt?.workflowTransition).toEqual(scenario === 'accepted' ? admitted : undefined);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('engineering lane (ci.yml): review activity cannot start, force or cancel it', () => {
    const ci = load('ci.yml');
    it('does not subscribe to review or inline-comment events', () => {
        for (const e of REVIEW_EVENTS) expect(Object.keys(ci.on)).not.toContain(e);
    });
    it('a genuine code change still runs it (pull_request, push to main, merge queue, dispatch)', () => {
        expect(Object.keys(ci.on)).toEqual(expect.arrayContaining(['pull_request', 'push', 'merge_group', 'workflow_dispatch']));
    });
    it('no review event can force the full lane', () => {
        const forceFull = String(ci.jobs.scope.steps.find((s) => s.id === 'classify').env.FORCE_FULL);
        for (const e of REVIEW_EVENTS) expect(forceFull).not.toContain(e);
    });
    it('keeps its own concurrency group, so newer code still supersedes older code', () => {
        expect(ci.concurrency.group).toMatch(/^ci-\$\{\{/);
        expect(ci.concurrency['cancel-in-progress']).toBe(true);
    });
    it('`report` is still produced by the engineering lane', () => {
        expect(ci.jobs.report.name).toBe('report');
    });
});

describe('review trigger (review-event.yml): marks review activity and can be trusted with nothing', () => {
    const ev = load('review-event.yml');
    const steps = Object.values(ev.jobs).flatMap((j) => j.steps ?? []);
    it('is the "Review Event" workflow the review lane listens to, on review and inline-comment activity', () => {
        expect(ev.name).toBe('Review Event');
        expect(Object.keys(ev.on).sort()).toEqual([...REVIEW_EVENTS].sort());
    });
    it('has no permissions, no checkout, no action and no secret — only a no-op step', () => {
        expect(ev.permissions).toEqual({});
        expect(steps.some((s) => s.uses)).toBe(false);
        expect(steps.map((s) => s.run)).toEqual(['echo "review activity recorded"']);
        expect(JSON.stringify(ev)).not.toMatch(/secrets\.|github\.token|GITHUB_TOKEN/);
    });
});

describe('review lane (review-qualification.yml): cheap, isolated, read-only', () => {
    const wf = load('review-qualification.yml');
    const steps = Object.values(wf.jobs).flatMap((j) => j.steps ?? []);
    const runText = steps.map((s) => String(s.run ?? '')).join('\n');
    it('runs on engineering completion and review activity (`workflow_run`) and on Codex result comments (`issue_comment`)', () => {
        expect(Object.keys(wf.on)).toEqual(['workflow_run', 'issue_comment']);
        expect(wf.on.issue_comment.types).toEqual(['created', 'edited']);
        expect(wf.on.workflow_run.workflows).toEqual(['CI - Test Audit', 'Review Event']);
        expect(wf.on.workflow_run.types).toEqual(['completed']);
    });
    // Codex P1 4233038867: review events run the workflow FILE from the PR merge commit, so a candidate could rewrite a
    // review-triggered qualification and fabricate its result. `workflow_run` definitions always come from the default branch.
    it('CASUALTY (Codex P1 4233038867): never subscribes to a PR-controlled event; the PR and head come from the workflow_run', () => {
        // `issue_comment`, like `workflow_run`, always runs the default-branch definition, so it is not PR-controlled.
        const prControlled = ['pull_request', 'pull_request_target', ...REVIEW_EVENTS];
        expect(Object.keys(wf.on).filter((e) => prControlled.includes(e))).toEqual([]);
        const env = Object.values(wf.jobs)[0].env;
        expect(env.PR_NUMBER).toBe('${{ github.event.workflow_run.pull_requests[0].number || github.event.issue.number }}');
        expect(env.EXPECTED_HEAD_SHA).toBe('${{ github.event.workflow_run.head_sha }}');
    });
    // Codex P1 4233588262: a clean Codex result is a top-level PR comment; only the bot's comments on a PR start the job, and
    // the head it qualifies is the PR's LIVE head from the API, never a value carried by the comment.
    it('CASUALTY (Codex P1 4233588262): a Codex result comment re-qualifies the live head; other comments start nothing', () => {
        const job = Object.values(wf.jobs)[0];
        expect(job.if).toMatch(/github\.event\.issue\.pull_request/);
        expect(job.if).toMatch(/github\.event\.comment\.user\.login == 'chatgpt-codex-connector\[bot\]'/);
        expect(job.env.PR_NUMBER).toContain('github.event.issue.number');
        const resolve = job.steps.find((s) => s.name === 'Resolve the live head for a Codex result comment');
        expect(resolve?.if).toBe("${{ github.event_name == 'issue_comment' }}");
        expect(resolve?.run).toMatch(/gh api "repos\/\$\{GITHUB_REPOSITORY\}\/pulls\/\$\{PR_NUMBER\}" --jq \.head\.sha/);
        expect(JSON.stringify(job.steps)).not.toMatch(/github\.event\.comment\.body/);
        expect(JSON.stringify(wf)).not.toMatch(/github\.event\.pull_request\./);
    });
    it('uses a concurrency group that can never cancel the engineering lane', () => {
        expect(wf.concurrency.group).toMatch(/^review-qual-/);
        expect(wf.concurrency.group).not.toMatch(/^ci-/);
    });
    it('runs no build, unit, E2E or install step, and never reports the required `report` context', () => {
        expect(runText).not.toMatch(/vitest|playwright|pnpm (install|build|test|ci:)|build:test/);
        expect(Object.values(wf.jobs).map((j) => j.name)).not.toContain('report');
        expect(Object.values(wf.jobs).some((j) => j.strategy?.matrix)).toBe(false);
    });
    it('CASUALTY (Codex P1 4224002123): runs TRUSTED default-branch scripts, never the candidate\'s, and keeps no credentials', () => {
        // Review events check out the PR merge ref by default, so a fork/untrusted PR could rewrite the qualification scripts
        // to fabricate a receipt. The live PR head is still read through the API; only the code that judges it is trusted.
        const checkout = steps.find((s) => String(s.uses ?? '').startsWith('actions/checkout@'));
        expect(checkout?.with?.ref).toBe('${{ github.event.repository.default_branch }}');
        expect(checkout?.with?.['persist-credentials']).toBe(false);
    });
    it('has only read permissions', () => {
        expect(Object.values(wf.permissions)).toEqual(expect.arrayContaining(['read']));
        expect(Object.values(wf.permissions)).not.toContain('write');
    });
    it('checks engineering evidence AND live review state (Code and Security via the existing collector)', () => {
        expect(runText).toMatch(/scripts\/ci-engineering-evidence\.mjs/);
        expect(runText).toMatch(/scripts\/collect-review-qualification\.mjs/);
    });
});

describe('ci-engineering-evidence: only exact-head, complete, successful engineering evidence qualifies', () => {
    const HEAD = 'a'.repeat(40);
    const BASE = 'b'.repeat(40);
    const run = (over = {}) => ({
        id: 100, run_attempt: 1, event: 'pull_request', status: 'completed', conclusion: 'success', head_sha: HEAD,
        created_at: '2026-10-08T19:00:00Z', pull_requests: [{ number: 1573, base: { sha: BASE }, head: { sha: HEAD } }], ...over,
    });
    const jobs = (over = {}) => ({ scope: 'success', 'full-evidence': 'success', report: 'success', ...over });
    const evaluate = (runs, jobsByRun, extra = {}) => evaluateEngineeringEvidence({
        pr: 1573, liveHeadSha: HEAD, liveBaseSha: BASE, expectedHeadSha: HEAD, runs, jobsByRun, headContainsBase: true, workflowUnchanged: true, ...extra,
    });

    // Codex Security P2 4233624706: a PR runs its own ci.yml, so same-named no-op jobs would pass a name-only check.
    it('CASUALTY (Codex P2 4233624706): a head whose ci.yml differs from the base holds, however green its jobs', () => {
        expect([evaluate([run()], { 100: jobs() }, { workflowUnchanged: false }).reasons,
            evaluate([run()], { 100: jobs() }, { workflowUnchanged: undefined }).reasons])
            .toEqual([[ENGINEERING_HOLD.WORKFLOW_MODIFIED], [ENGINEERING_HOLD.WORKFLOW_MODIFIED]]);
    });
    it('passing exact-head engineering qualifies (no further test run needed)', () => {
        expect(evaluate([run()], { 100: jobs() })).toMatchObject({ qualified: true, runId: 100, reasons: [] });
    });
    it('a head that moved since the event holds', () => {
        expect(evaluate([run()], { 100: jobs() }, { expectedHeadSha: 'c'.repeat(40) }).reasons).toContain(ENGINEERING_HOLD.HEAD_MOVED);
    });
    it('no engineering run for the exact head holds', () => {
        expect(evaluate([run({ head_sha: 'c'.repeat(40) })], {}).reasons).toContain(ENGINEERING_HOLD.NO_RUN);
    });
    it('the NEWEST run decides: a newer in-progress or failed run never falls back to an older green one', () => {
        const older = run({ id: 100, created_at: '2026-10-08T18:00:00Z' });
        const newerRunning = run({ id: 200, status: 'in_progress', conclusion: null, created_at: '2026-10-08T19:30:00Z' });
        const newerFailed = run({ id: 300, conclusion: 'failure', created_at: '2026-10-08T19:30:00Z' });
        expect(evaluate([older, newerRunning], { 100: jobs() })).toMatchObject({ qualified: false, runId: 200 });
        expect(evaluate([older, newerRunning], { 100: jobs() }).reasons).toContain(ENGINEERING_HOLD.NOT_COMPLETED);
        expect(evaluate([older, newerFailed], { 100: jobs(), 300: jobs({ report: 'failure' }) })).toMatchObject({ qualified: false, runId: 300 });
    });
    it('LIVE CASUALTY (run 37835913578): a run whose ONLY failures are its own review gates still qualifies', () => {
        // The engineering run concludes `failure` while reviews are pending, purely because its exact-head review and merge
        // qualification jobs fail closed. Requiring run-level success made the review lane circular: it could never qualify.
        const pendingReview = run({ conclusion: 'failure' });
        const j = jobs({ 'exact-head-review-qualification': 'failure', 'merge-qualification': 'failure', build: 'success', 'e2e-shard-2': 'success' });
        expect(evaluate([pendingReview], { 100: j })).toMatchObject({ qualified: true, runId: 100 });
    });
    it('a run with any OTHER failed or cancelled job holds', () => {
        const failed = run({ conclusion: 'failure' });
        expect(evaluate([failed], { 100: jobs({ 'e2e-shard-2': 'failure', 'merge-qualification': 'failure' }) }).reasons)
            .toContain(ENGINEERING_HOLD.JOB_NOT_SUCCESSFUL);
        expect(evaluate([failed], { 100: jobs({ 'unit-shard-3': 'cancelled' }) }).reasons).toContain(ENGINEERING_HOLD.JOB_NOT_SUCCESSFUL);
    });
    it('a cancelled run holds', () => {
        expect(evaluate([run({ conclusion: 'cancelled' })], { 100: jobs() }).reasons).toContain(ENGINEERING_HOLD.RUN_NOT_SUCCESSFUL);
    });
    it('a draft-lane run (report green, full-evidence skipped) holds', () => {
        expect(evaluate([run()], { 100: jobs({ 'full-evidence': 'skipped' }) }).reasons).toContain(ENGINEERING_HOLD.JOB_NOT_SUCCESSFUL);
    });
    it('a missing required job holds', () => {
        const j = jobs(); delete j.report;
        expect(evaluate([run()], { 100: j }).reasons).toContain(ENGINEERING_HOLD.JOB_NOT_SUCCESSFUL);
    });
    it('a run against a different base holds; a dispatch run (no PR base) needs the head to contain the live base', () => {
        expect(evaluate([run({ pull_requests: [{ number: 1573, base: { sha: 'd'.repeat(40) }, head: { sha: HEAD } }] })], { 100: jobs() }).reasons)
            .toContain(ENGINEERING_HOLD.BASE_MISMATCH);
        const dispatch = run({ event: 'workflow_dispatch', pull_requests: [] });
        expect(evaluate([dispatch], { 100: jobs() })).toMatchObject({ qualified: true });
        expect(evaluate([dispatch], { 100: jobs() }, { headContainsBase: false }).reasons).toContain(ENGINEERING_HOLD.BASE_MISMATCH);
    });
    it('review-event runs are not engineering evidence', () => {
        expect(evaluate([run({ event: 'pull_request_review' })], { 100: jobs() }).reasons).toContain(ENGINEERING_HOLD.NO_RUN);
    });
});

const FINANCE_PINS = [
  {
    "path": "local-packets/1599-model-status-control/README.md",
    "oid": "23e345dea0da592e1c6a9cd9765d8ab22a21e57b",
    "mode": "100644",
    "size": 2624
  },
  {
    "path": "local-packets/1599-model-status-control/edit.mjs",
    "oid": "9942d9759b6ed2e09183fea1dff432212f1bb523",
    "mode": "100644",
    "size": 1459
  },
  {
    "path": "local-packets/1599-model-status-control/inspect-native.py",
    "oid": "e02ed0ca701232bdfa37eacbdebcd1f93b409363",
    "mode": "100644",
    "size": 723
  },
  {
    "path": "local-packets/1599-model-status-control/native-receipts.json",
    "oid": "058fbb2cb968b85d0cf66aee9aff08977064dc93",
    "mode": "100644",
    "size": 3906
  },
  {
    "path": "local-packets/1599-model-status-control/preserve-package.py",
    "oid": "ac271ead1d1c58d30a069a4b437cd6893eaf7acf",
    "mode": "100644",
    "size": 2442
  },
  {
    "path": "local-packets/1599-model-status-control/verify-native.test.mjs",
    "oid": "f0808c29474edb983b46358ea8931037e85800aa",
    "mode": "100644",
    "size": 6570
  },
  {
    "path": "product_release/ROADMAP.md",
    "oid": "1769c07635ead0df59990bcdb6fb949e182e0838",
    "mode": "100644",
    "size": 23129
  },
  {
    "path": "product_release/work_items/financial-analysis/FINANCIAL_MODEL_REVIEW_2026-10-12.md",
    "oid": "0cc9545660dff6709a4d5171268bedf04982b0fb",
    "mode": "100644",
    "size": 20082
  },
  {
    "path": "product_release/work_items/financial-analysis/SpeakSharp_Updated_Financial_Model_2026-10-12.xlsx",
    "oid": "c78f60fa0383ae2461f209bdb96a0a50b2909f5e",
    "mode": "100644",
    "size": 76656
  }
];
describe('#1599 documentation metadata reaches the actual collection CLI', () => {
    it.each(['accepted', 'wrong blob', 'truncated tree', 'base drift'])('collects and refuses from the same shared reader: %s', scenario => {
        const root = mkdtempSync(resolve(tmpdir(), 'documentation-collection-'));
        const head = 'c9747c6b9030045ec9303ec276f413b9c8d431bc';
        const base = 'd2425ee700eb1f1875d84d4144b68a29302e6c0a';
        const tree = 'ad14be301f760c1b776fa1597205d16b33028f9f';
        const repo = 'relativityE/speaksharp';
        const pull = { number: 1599, headRefOid: head, baseRefOid: base, baseRefName: 'main', headRefName: 'docs',
            baseRepository: { nameWithOwner: repo }, headRepository: { nameWithOwner: repo },
            files: { nodes: FINANCE_PINS.map(({ path }) => ({ path })), pageInfo: { hasNextPage: false } },
            reviews: { nodes: [{ author: { login: 'chatgpt-codex-connector' }, state: 'COMMENTED', commit: { oid: head },
                body: 'reviewed', submittedAt: '2026-10-28T17:34:11Z' }], pageInfo: { hasPreviousPage: false } },
            reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } }, comments: { nodes: [], pageInfo: { hasPreviousPage: false } } };
        const entries = FINANCE_PINS.map(({ oid, ...row }) => ({ ...row, sha: oid, type: 'blob' }));
        if (scenario === 'wrong blob') entries[0].sha = 'a'.repeat(40);
        try {
            writeFileSync(resolve(root, 'fixture.json'), JSON.stringify({ pull, entries, head, base, tree, scenario }));
            writeFileSync(resolve(root, 'fetch.mjs'), `
                import { readFileSync, writeFileSync } from 'node:fs';
                const f=JSON.parse(readFileSync(new URL('./fixture.json',import.meta.url),'utf8'));const calls=[];
                process.on('exit',()=>writeFileSync(new URL('./calls.json',import.meta.url),JSON.stringify(calls)));
                globalThis.fetch=async(url,options)=>{
                    const u=new URL(url);calls.push(u.pathname+u.search);
                    if(u.origin!=='https://api.github.com'||options.headers.Authorization!=='Bearer synthetic')throw Error('unexpected network');
                    let value;
                    if(u.pathname==='/graphql'){
                        const query=JSON.parse(options.body).query;const pull=structuredClone(f.pull);
                        if(query.includes('documentationPostimageIdentity')&&f.scenario==='base drift')pull.baseRefOid='b'.repeat(40);
                        value={data:{repository:{pullRequest:pull}}};
                    }else if(u.pathname.endsWith('/git/commits/'+f.head))value={sha:f.head,tree:{sha:f.tree}};
                    else if(u.pathname.endsWith('/git/trees/'+f.tree))value={sha:f.tree,truncated:f.scenario==='truncated tree',tree:f.entries};
                    else if(u.pathname.endsWith('/activity'))value=[];
                    else if(u.pathname.endsWith('/branches/main/protection'))value={required_conversation_resolution:{enabled:true},enforce_admins:{enabled:true}};
                    else if(u.pathname.endsWith('/rules/branches/main'))value=[];
                    else throw Error('unexpected API');
                    return {ok:true,status:200,json:async()=>value};
                };`);
            const output = resolve(root, 'receipt.json');
            const child = spawnSync(process.execPath, ['--import', resolve(root, 'fetch.mjs'),
                resolve(process.cwd(), 'scripts/collect-review-qualification.mjs')], {
                cwd: process.cwd(), encoding: 'utf8', timeout: 10000,
                env: { GITHUB_REPOSITORY: repo, GITHUB_TOKEN: 'synthetic', PR_NUMBER: '1599',
                    EXPECTED_HEAD_SHA: head, REVIEW_QUALIFICATION_FILE: output },
            });
            expect(child.error).toBeUndefined();
            expect(child.status).toBe(scenario === 'accepted' ? 0 : 1);
            const receipt = JSON.parse(readFileSync(output, 'utf8'));
            expect(receipt.qualified).toBe(scenario === 'accepted');
            const calls = JSON.parse(readFileSync(resolve(root, 'calls.json'), 'utf8'));
            expect(calls).toContain('/repos/' + repo + '/git/commits/' + head);
            expect(calls).toContain('/repos/' + repo + '/git/trees/' + tree + '?recursive=1');
        } finally { rmSync(root, { recursive: true, force: true }); }
    });
});
