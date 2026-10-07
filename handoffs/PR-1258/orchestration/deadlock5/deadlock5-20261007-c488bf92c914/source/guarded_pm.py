"""Closed PM executor. No shell/code/merge/deploy/Production operation is exposed."""
import re
import threading

REPO = 'relativityE/speaksharp'
KINDS = {'refresh_reviews', 'mark_ready', 'rerun_failed_jobs', 'dispatch_full_ci', 'open_draft_pr'}
SHA = re.compile(r'^[0-9a-f]{40}$')
BRANCH = re.compile(r'^(?:(?:fix|test|telemetry)/1258-[A-Za-z0-9._/-]+|feat/1258-design-pr[1-5]-[A-Za-z0-9._/-]+)$')

class Hold(RuntimeError):
    pass

_REFRESH_LOCKS = {}
_REFRESH_LOCKS_GUARD = threading.Lock()

def _refresh_lock(pr_number):
    with _REFRESH_LOCKS_GUARD:
        return _REFRESH_LOCKS.setdefault(int(pr_number), threading.Lock())

def need(value, message):
    if not value:
        raise Hold(message)

class Executor:
    def __init__(self, request, qualify):
        self.request, self.qualify = request, qualify

    def read(self, path):
        return self.request(['api', f'repos/{REPO}/{path}'])

    def guard(self, action):
        need(action.get('kind') in KINDS, 'Operation is outside the PM allowlist')
        head, base = action.get('head'), action.get('base')
        need(isinstance(head,str) and SHA.fullmatch(head), 'Exact head required')
        need(isinstance(base,str) and SHA.fullmatch(base), 'Exact base required')
        source=int(action.get('source_comment_id') or 0)
        need(source>0, 'Source packet/checkpoint required')
        comment=self.read(f'issues/comments/{source}')
        need(comment.get('issue_url','').endswith('/issues/1258'), 'Source must belong to #1258')
        need(comment.get('user',{}).get('login')=='relativityE', 'Source actor is not the approved repository owner account')
        # Freeze the candidate from a source record; a model cannot nominate another SHA.
        need(head in comment.get('body',''), 'Source does not name the full candidate head')
        need(base in comment.get('body',''), 'Source does not name the full base')
        need(self.read('branches/main')['commit']['sha']==base, 'Main drifted')
        kind=action['kind'];pr=None
        if kind!='open_draft_pr':
            n=int(action.get('pr_number') or 0)
            need(n>0, 'PR number required')
            pr=self.read(f'pulls/{n}')
            need(pr.get('state')=='open' and not pr.get('merged'), 'PR closed/merged')
            need(pr['head']['sha']==head and pr['base']['sha']==base, 'PR head/base drifted')
            need(pr['head']['repo']['full_name']==REPO, 'Fork mutations not allowed')
            branch=pr['head']['ref']
        else:
            branch=action.get('branch','')
        need(BRANCH.fullmatch(branch or ''), 'Branch outside RWT scope')
        # Both dispatch and PR-event concurrency groups must be idle.
        runs=self.read(f'actions/workflows/ci.yml/runs?branch={branch}&per_page=100')['workflow_runs']
        need(len(runs)<100, 'Run pagination incomplete; use a reviewed larger read')
        related=[r for r in runs if r.get('name')=='CI - Test Audit' and
                 (r.get('head_branch')==branch or any(p.get('number')==int(action.get('pr_number') or 0) for p in r.get('pull_requests',[])))]
        need(all(r.get('status')=='completed' for r in related), 'Related CI active; do not cancel it')
        if kind in ('rerun_failed_jobs','dispatch_full_ci'):
            need(pr and not pr.get('draft'), 'Ready PR required for full recovery')
            self.qualify(pr['number'],head)
        return pr,related,branch

    def execute(self, action):
        if action.get('kind') == 'refresh_reviews':
            # Serialize distinct authorized requests for the same PR in this
            # executor process; the durable action journal covers exact retries.
            with _refresh_lock(action.get('pr_number') or 0):
                return self._execute(action)
        return self._execute(action)

    def _execute(self, action):
        pr,runs,branch=self.guard(action)
        kind=action['kind'];head=action['head'];base=action['base']
        if kind=='refresh_reviews':
            source=self.read(f"issues/comments/{int(action['source_comment_id'])}")
            need(re.search(r'Draft\s*(?:→|->|to)\s*Ready',source.get('body',''),re.I), 'Source does not request a review lifecycle refresh')
            reviews=self.read(f"pulls/{pr['number']}/reviews?per_page=100")
            need(len(reviews)<100, 'Review pagination incomplete')
            if any(r.get('commit_id')==head and 'codex' in r.get('user',{}).get('login','').lower() for r in reviews):
                return f'OBSERVE ONLY: exact-head review already exists for #{pr["number"]} at {head}; lifecycle unchanged and review completion not inferred'
            fresh=self.read(f"pulls/{pr['number']}")
            need(fresh.get('state')=='open' and not fresh.get('merged') and
                 fresh['head']['sha']==head and fresh['base']['sha']==base, 'Lifecycle precondition changed')
            if not fresh.get('draft'):
                self.request(['api','graphql','-f','query=mutation($id:ID!){convertPullRequestToDraft(input:{pullRequestId:$id}){pullRequest{isDraft}}}','-f',f"id={fresh['node_id']}"])
            fresh=self.read(f"pulls/{pr['number']}")
            need(fresh.get('state')=='open' and not fresh.get('merged') and
                 fresh['head']['sha']==head and fresh['base']['sha']==base and fresh.get('draft'),
                 'Lifecycle changed between transitions')
            self.request(['api','graphql','-f','query=mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{isDraft}}}','-f',f"id={fresh['node_id']}"])
            final=self.read(f"pulls/{pr['number']}")
            need(final.get('state')=='open' and not final.get('merged') and
                 final['head']['sha']==head and final['base']['sha']==base and
                 not final.get('draft'), 'Post-refresh readback did not confirm the exact open Ready candidate')
            return f"LIFECYCLE COMPLETE: #{pr['number']} is open/Ready at {head}/{base}; REVIEWS PENDING: await fresh exact-head reviews and inspect findings"
        if kind=='mark_ready':
            if not pr.get('draft'):
                return 'Already Ready; no duplicate transition'
            # Fresh read immediately before the write.
            fresh=self.read(f"pulls/{pr['number']}")
            need(fresh['head']['sha']==head and fresh['base']['sha']==base and fresh.get('draft'), 'Ready precondition changed')
            self.request(['api','graphql','-f','query=mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{isDraft}}}','-f',f"id={fresh['node_id']}"])
            return f"Marked #{pr['number']} Ready at {head}; lifecycle reviews must finish"
        if kind=='rerun_failed_jobs':
            run_id=int(action.get('run_id') or 0)
            run=self.read(f'actions/runs/{run_id}')
            need(run.get('name')=='CI - Test Audit' and run.get('head_sha')==head and run.get('head_branch')==branch, 'Wrong CI run/head')
            need(run.get('status')=='completed' and run.get('conclusion') in ('failure','cancelled'), 'Run already active/successful')
            need(run.get('run_attempt')==int(action.get('run_attempt') or 0), 'Attempt changed; another recovery already happened')
            jobs=self.read(f'actions/runs/{run_id}/jobs?per_page=100')
            need(jobs.get('total_count',0)<=100, 'Job pagination incomplete')
            evidence={j['name']:j.get('conclusion') for j in jobs.get('jobs',[])}
            need(evidence.get('full-evidence') in ('success','failure','cancelled'), 'No full-lane job; failed-only rerun cannot fill a skipped Draft lane')
            self.guard(action)
            final=self.read(f'actions/runs/{run_id}')
            need(final.get('run_attempt')==run.get('run_attempt') and final.get('status')=='completed' and final.get('conclusion') in ('failure','cancelled'), 'Recovery attempt changed immediately before write')
            self.request(['api','-X','POST',f'repos/{REPO}/actions/runs/{run_id}/rerun-failed-jobs'])
            return f'Recovered failed jobs of run {run_id}; inspect next attempt'
        if kind=='dispatch_full_ci':
            # Never duplicate a full lane, even if a previous model turn proposed it again.
            need(not any(r.get('head_sha')==head and r.get('event')=='workflow_dispatch' for r in runs), 'Full dispatch already exists; inspect it rather than repeat')
            self.guard(action)
            self.request(['api','-X','POST',f'repos/{REPO}/actions/workflows/ci.yml/dispatches','-f',f'ref={branch}','-F','inputs[force_full]=true'])
            return f'Dispatched ci.yml force_full once on {branch}@{head}'
        # Draft opening needs no review qualification, but packet bytes must exist remotely.
        ref=self.read(f'git/ref/heads/{branch}')
        need(ref['object']['sha']==head, 'Pushed branch does not match packet')
        existing=self.read(f'pulls?state=open&head=relativityE:{branch}&per_page=100')
        if existing:
            return f"Draft/PR already exists: #{existing[0]['number']}"
        title=action.get('title','');body=action.get('body','')
        need(0<len(title)<=200 and 0<len(body)<=12000, 'Draft title/body bounds')
        need(head in body and base in body, 'Draft must disclose exact candidate and base')
        self.guard(action)
        need(self.read(f'git/ref/heads/{branch}')['object']['sha']==head, 'Remote branch drifted before Draft creation')
        opened=self.request(['api','-X','POST',f'repos/{REPO}/pulls','-f',f'title={title}','-f',f'body={body}','-f',f'head={branch}','-f','base=main','-F','draft=true'])
        return f"Opened Draft #{opened['number']} at {head}"
