"""Closed PM executor. No shell/code/merge/deploy/Production operation is exposed."""
import hashlib
import json
import re

REPO = 'relativityE/speaksharp'
KINDS = {'refresh_reviews', 'mark_ready', 'rerun_failed_jobs', 'dispatch_full_ci', 'open_draft_pr'}
SHA = re.compile(r'^[0-9a-f]{40}$')
BRANCH = re.compile(r'^(?:(?:fix|test|telemetry)/1258-[A-Za-z0-9._/-]+|feat/1258-design-pr[1-5]-[A-Za-z0-9._/-]+)$')

class Hold(RuntimeError):
    pass

# Identity fields only. Nullable/extra/free-text fields must not create a second
# key for the same operation. A review refresh is one-per-candidate, whichever
# source comment requested it.
IDENTITY = {
    'refresh_reviews': ('kind', 'pr_number', 'head', 'base'),
    'mark_ready': ('kind', 'pr_number', 'head', 'base'),
    'rerun_failed_jobs': ('kind', 'pr_number', 'head', 'base', 'run_id', 'run_attempt'),
    'dispatch_full_ci': ('kind', 'pr_number', 'head', 'base'),
    'open_draft_pr': ('kind', 'branch', 'head', 'base'),
}

def canonical_key(action):
    kind = action.get('kind')
    fields = IDENTITY.get(kind, ('kind',))
    ident = {}
    for f in fields:
        v = action.get(f)
        if f in ('pr_number', 'run_id', 'run_attempt'):
            v = int(v or 0)
        elif isinstance(v, str):
            v = v.strip().lower() if f in ('head', 'base') else v.strip()
        ident[f] = v
    return hashlib.sha256(json.dumps(ident, sort_keys=True).encode()).hexdigest()

READY_MUTATION = 'query=mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{isDraft}}}'
DRAFT_MUTATION = 'query=mutation($id:ID!){convertPullRequestToDraft(input:{pullRequestId:$id}){pullRequest{isDraft}}}'

def need(value, message):
    if not value:
        raise Hold(message)

class Executor:
    def __init__(self, request, qualify, phase=None):
        self.request, self.qualify = request, qualify
        # Journals a lifecycle step before/after each write so a restart can resume it.
        self.phase = phase or (lambda _name: None)

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
        self._require_action_authorization(action, comment.get('body', ''))
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

    @staticmethod
    def _require_action_authorization(action, body):
        """Require an affirmative, source-authored authorization for this exact operation.

        Mentioning candidate SHAs or discussing a possible action is not authorization.
        The canonical line is deliberately machine-readable so quoted prose, negation,
        and unrelated approvals cannot widen the bounded executor's authority.
        """
        kind = action['kind']
        fields = [f'kind={kind}']
        if kind != 'open_draft_pr' and action.get('pr_number'):
            fields.append(f"pr={int(action['pr_number'])}")
        if action.get('branch'):
            fields.append(f"branch={action['branch']}")
        fields.extend((f"head={action['head'].lower()}", f"base={action['base'].lower()}"))
        if kind == 'rerun_failed_jobs':
            fields.extend((f"run_id={int(action.get('run_id') or 0)}",
                           f"run_attempt={int(action.get('run_attempt') or 0)}"))
        expected = 'ACTION AUTHORIZATION: ' + ' '.join(fields)
        lines = []
        in_fence = False
        for raw_line in str(body).splitlines():
            line = raw_line.strip()
            if line.startswith('```') or line.startswith('~~~'):
                in_fence = not in_fence
                continue
            if in_fence or line.startswith('>'):
                continue
            lines.append(line)
        if expected not in lines:
            raise Hold(f'Source lacks exact affirmative authorization: {expected}')
        action_ref = re.compile(rf"\b{re.escape(kind)}\b", re.I)
        for line in lines:
            blocks = re.search(r'\b(HOLD|BLOCKED|DO\s+NOT|NOT\s+AUTHORIZED|CANCEL(?:LED)?)\b', line, re.I)
            scope_ref = action_ref.search(line) or re.search(r'\b(PM\s+)?(actions?|executor|mutation)\b', line, re.I)
            if blocks and scope_ref:
                raise Hold(f'Source contradicts {kind} authorization with a hold/revocation')

    def _ready_with_readback(self, number, head, base, node_id, verb):
        self.phase('ready_requested')
        self.request(['api','graphql','-f',READY_MUTATION,'-f',f"id={node_id}"])
        after=self.read(f"pulls/{number}")
        if after.get('draft') or after['head']['sha']!=head or after['base']['sha']!=base:
            # The write may or may not have landed; never call it complete without readback.
            raise RuntimeError(f'Ready readback failed for #{number}: draft={after.get("draft")} head={after["head"]["sha"]}')
        self.phase('ready_confirmed')
        return (f"{verb}: refresh Draft→Ready for #{number} at {head}; readback isDraft=false. "
                "Code/Security reviews PENDING — lifecycle completion is not review completion")

    def resume_refresh(self, action, phase):
        """Finish a journaled refresh after a crash/uncertain write. Never starts a second cycle."""
        head, base = action.get('head'), action.get('base')
        number = int(action.get('pr_number') or 0)
        need(number > 0, 'PR number required')
        pr = self.read(f'pulls/{number}')
        need(pr.get('state')=='open' and not pr.get('merged'), 'PR closed/merged; nothing to resume')
        need(pr['head']['sha']==head and pr['base']['sha']==base, 'Stale candidate: PR head/base changed during the interrupted refresh')
        if pr.get('draft'):
            if phase == 'draft_requested' or phase in ('draft_confirmed', 'ready_requested'):
                return self._ready_with_readback(number, head, base, pr['node_id'], 'RESUMED')
            raise Hold('PR is Draft but no journaled Draft step belongs to this request')
        if phase in ('ready_requested', 'ready_confirmed'):
            self.phase('ready_confirmed')
            return (f"RESUMED: readback isDraft=false for #{number} at {head}; prior Ready write landed. "
                    "Code/Security reviews PENDING — lifecycle completion is not review completion")
        # draft_requested/draft_confirmed but Ready now: the Draft conversion never landed,
        # or another actor already restored Ready. No cycle is proven; do not start one.
        raise Hold('Interrupted refresh left PR Ready with no proven Draft→Ready cycle; PM may re-request')

    def resolve_uncertain(self, action):
        """Resolve a possibly-landed write by typed readback; never replay the write."""
        kind = action.get('kind')
        head, base = action.get('head'), action.get('base')
        if kind == 'mark_ready':
            number = int(action.get('pr_number') or 0)
            pr = self.read(f'pulls/{number}')
            need(pr.get('state') == 'open' and not pr.get('merged'), 'PR closed/merged during uncertain Ready action')
            need(pr['head']['sha'] == head and pr['base']['sha'] == base, 'Candidate drifted during uncertain Ready action')
            if not pr.get('draft'):
                return f"RESOLVED: readback confirms #{number} Ready at {head}; no write replayed"
            raise RuntimeError('Ready write is not visible in readback; action remains unconfirmed and will not be replayed')
        if kind == 'open_draft_pr':
            branch = action.get('branch', '')
            ref = self.read(f'git/ref/heads/{branch}')
            need(ref.get('object', {}).get('sha') == head, 'Remote branch moved during uncertain Draft creation')
            rows = self.read(f'pulls?state=open&head=relativityE:{branch}&per_page=100')
            if len(rows) >= 100:
                raise RuntimeError('Draft readback pagination incomplete; action remains unconfirmed')
            for pr in rows:
                if (pr.get('head', {}).get('sha') == head and pr.get('base', {}).get('sha') == base
                        and pr.get('state') == 'open'):
                    return f"RESOLVED: readback found Draft/PR #{pr['number']} at {head}; no write replayed"
            raise RuntimeError('No matching Draft is visible; action remains unconfirmed and will not be replayed')
        if kind in ('dispatch_full_ci', 'rerun_failed_jobs'):
            if kind == 'rerun_failed_jobs':
                run_id = int(action.get('run_id') or 0)
                run = self.read(f'actions/runs/{run_id}')
                need(run.get('head_sha') == head, 'CI run head changed during uncertain recovery')
                if int(run.get('run_attempt') or 0) > int(action.get('run_attempt') or 0):
                    return f"RESOLVED: run {run_id} advanced to attempt {run['run_attempt']}; no rerun replayed"
                raise RuntimeError('Rerun attempt is not visible; action remains unconfirmed and will not be replayed')
            branch = action.get('branch', '')
            rows = self.read(f'actions/workflows/ci.yml/runs?branch={branch}&per_page=100')['workflow_runs']
            if len(rows) >= 100:
                raise RuntimeError('CI readback pagination incomplete; action remains unconfirmed')
            match = [r for r in rows if r.get('head_sha') == head and r.get('event') == 'workflow_dispatch'
                     and r.get('head_branch') == branch]
            if match:
                return f"RESOLVED: workflow dispatch readback found run {match[0].get('id')} at {head}; no dispatch replayed"
            raise RuntimeError('No matching workflow dispatch is visible; action remains unconfirmed and will not be replayed')
        raise Hold(f'No typed uncertain-write resolver exists for {kind!r}')

    def execute(self, action):
        pr,runs,branch=self.guard(action)
        kind=action['kind'];head=action['head'];base=action['base']
        if kind=='refresh_reviews':
            source=self.read(f"issues/comments/{int(action['source_comment_id'])}")
            need(re.search(r'Draft\s*(?:→|->|to)\s*Ready',source.get('body',''),re.I), 'Source does not request a review lifecycle refresh')
            reviews=self.read(f"pulls/{pr['number']}/reviews?per_page=100")
            need(len(reviews)<100, 'Review pagination incomplete')
            if any(r.get('commit_id')==head and 'codex' in r.get('user',{}).get('login','').lower() for r in reviews):
                return f"OBSERVED: exact-head Codex review already exists for #{pr['number']} at {head}; no lifecycle executed"
            fresh=self.read(f"pulls/{pr['number']}")
            need(fresh['head']['sha']==head and fresh['base']['sha']==base, 'Lifecycle precondition changed')
            # Starting from Draft could be another actor's half-finished cycle or a
            # deliberate Draft. Only a journaled step of THIS request may resume it.
            need(not fresh.get('draft'), 'PR is Draft; refresh starts only from Ready (another lifecycle may be in progress)')
            self.phase('draft_requested')
            self.request(['api','graphql','-f',DRAFT_MUTATION,'-f',f"id={fresh['node_id']}"])
            fresh=self.read(f"pulls/{pr['number']}")
            need(fresh['head']['sha']==head and fresh['base']['sha']==base and fresh.get('draft'), 'Lifecycle changed between transitions')
            self.phase('draft_confirmed')
            return self._ready_with_readback(pr['number'], head, base, fresh['node_id'], 'EXECUTED')
        if kind=='mark_ready':
            if not pr.get('draft'):
                return 'Already Ready; no duplicate transition'
            # Fresh read immediately before the write.
            fresh=self.read(f"pulls/{pr['number']}")
            need(fresh['head']['sha']==head and fresh['base']['sha']==base and fresh.get('draft'), 'Ready precondition changed')
            self.request(['api','graphql','-f',READY_MUTATION,'-f',f"id={fresh['node_id']}"])
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
