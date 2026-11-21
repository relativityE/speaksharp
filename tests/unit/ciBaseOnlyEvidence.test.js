import { describe, expect, it, vi } from 'vitest';
import { evaluateEngineeringEvidence, ENGINEERING_HOLD } from '../../scripts/ci-engineering-evidence.mjs';
import { collectLiveReviewReceipt } from '../../scripts/collect-review-qualification.mjs';
import { guardedMerge } from '../../scripts/pre-merge-gate.mjs';
import { acceptBaseOnlyAudit, verifyBaseOnlyEngineering } from '../../scripts/lib/ciBaseOnlyEvidence.mjs';
import { REQUIRED_RELEASE_JOBS } from '../../scripts/production-release-policy.mjs';

const SHA = n=>String(n).repeat(40);
const repository = 'relativityE/speaksharp', repo = {full_name:repository}, ref='main', CI='.github/workflows/ci.yml';
const begin = '2026-11-21T01:00:00Z', end = '2026-11-21T01:10:00Z';
function fixture() {
    const oldHead = SHA(1), newHead = SHA(2), oldBase=SHA(3), newBase=SHA(4), checkoutHead=SHA(5);
    const pull = {number:1915, state:'open',draft:false, head:{sha:newHead,repo},base:{sha:newBase,ref,repo}};
    const run = {id:8,run_attempt:2,event:'pull_request',head_sha:oldHead,status:'completed',conclusion:'success',
        path:CI,repository:repo,head_repository:repo,pull_requests:[{number:1915,head:{sha:oldHead},base:{sha:oldBase,ref}}],
        created_at:begin,updated_at:end,run_started_at:begin};
    const jobs = [...REQUIRED_RELEASE_JOBS,'scope','quality','report'].map((name,index)=>({name,id:index+1,run_id:8,run_attempt:2,
        head_sha:oldHead,status:'completed',conclusion:'success',started_at:begin,completed_at:end}));
    const checkout = SHA(7), tree=SHA(8);
    const origin = {schemaVersion:1,comparisonBase:oldBase,originatingCi:{runId:'8',runAttempt:'2',commit:checkout},
        qualityProvenance:{source:'github-actions',runId:'8',runAttempt:'2',commit:checkout,tree}};
    const artifact = {id:12,name:'ci-metrics',expired:false,size_in_bytes:1500,workflow_run:{id:8,head_sha:oldHead}};
    const oldCheckout = {sha:checkout,tree:{sha:tree},parents:[{sha:oldBase},{sha:oldHead}]};
    const f = {origin, artifact, oldCheckout,pull,run,jobs,runs:[run],attempt:run,inspection:{status:'INPUT_MATCH'},blob:SHA(6),check:true,
        event:{action:'synchronize',before:oldHead,after:newHead,pull_request:pull},calls:0};
    const read = async path=>{
        if (path.endsWith('/pulls/1915')) return f.calls++ === 0 ? f.pull : f.nextPull ?? f.pull;
        if (path.includes('/contents/')) return {sha:path.endsWith(newHead) ? f.blob : SHA(6)};
        if (path.includes('/workflows/')) return {total_count:f.runs.length,workflow_runs:f.runs};
        if (path.includes('/artifacts?')) return {total_count:1,artifacts:[f.artifact]};
        if (path.endsWith('/git/commits/'+checkout)) return f.oldCheckout;
        if (path.endsWith('/git/commits/'+oldHead)) return {sha:oldHead,tree:{sha:tree}};
        if (path.includes('/jobs?')) return {total_count:f.jobs.length,jobs:f.jobs};
        if (path.endsWith('/attempts/2')) return f.attempt;
        if (path.endsWith('/actions/runs/8')) return f.latestAttempt ?? f.run;
        throw Error(path);
    };
    f.runCheck = () => verifyBaseOnlyEngineering({repository,eventName:'pull_request',event:f.event,checkoutHead,read,readArtifact:async({runId,artifactId})=>{expect([runId,artifactId]).toEqual([8,12]);return f.origin;},
        inspect: input=>{expect(input).toMatchObject({oldBase,oldHead,newBase,newHead});return f.inspection;},
        verifyCheckout:(_root,base,head,checked)=>f.check && base===newBase && head===newHead && checked===checkoutHead});
    return f;
}

describe('read-only base-only CI reuse',()=>{
    it('records the exact successful prior attempt and target checkout',async()=>{
        expect(await fixture().runCheck()).toEqual({eligible:true,kind:'verified-base-only-engineering-reuse',repository,pr:1915,
            source:{head:SHA(1),base:SHA(3),checkoutHead:SHA(7),tree:SHA(8),artifactId:12,runId:8,attempt:2},target:{head:SHA(2),base:SHA(4),checkoutHead:SHA(5)}});
    });
    it('can prove old checkout from origin when Actions omits PR association', async()=>{
        const f=fixture();
        f.run.pull_requests=[];
        expect((await f.runCheck()).eligible).toBe(true);
    });
    it.each([
        ['changed PR patch', f=>{f.inspection={status:'HOLD',reason:'candidate-patch-changed'}},'candidate-patch-changed'],
        ['changed base contents', f=>{f.inspection={status:'HOLD',reason:'engineering-inputs-changed-or-unproven'}},'engineering-inputs-changed-or-unproven'],
        ['copied/stale job', f=>{f.jobs[0].run_attempt=1},'prior-required-job-not-green'],
        ['review gate absent', f=>{f.jobs=f.jobs.filter(j=>j.name!=='exact-head-review-qualification')},'prior-required-job-not-green'],
        ['full evidence absent despite green qualifier', f=>{f.jobs=f.jobs.filter(j=>j.name!=='full-evidence')},'prior-required-job-not-green'],
        ['old run newer failure', f=>{f.runs.push({...f.run,id:9,conclusion:'failure'})},'prior-exact-full-run-not-green'],
        ['run belongs to another PR', f=>{f.run.pull_requests[0].number=1916},'prior-run-pr-association-mismatch'],
        ['old run attempt superseded during proof', f=>{f.latestAttempt={...f.run,run_attempt:3,status:'in_progress'}},'prior-attempt-superseded'],
        ['copied old receipt', f=>{f.origin.originatingCi.runAttempt='1'},'prior-origin-identity-mismatch'],
        ['old actual checkout parents differ', f=>{f.oldCheckout.parents.reverse()},'prior-integration-checkout-not-exact'],
        ['old actual checkout tree differs', f=>{f.oldCheckout.tree.sha=SHA(9)},'prior-integration-checkout-not-exact'],
        ['old reported tree differs despite matching metadata and commit', f=>{f.origin.qualityProvenance.tree=SHA(9)},'prior-integration-checkout-not-exact'],
        ['unbound metrics artifact', f=>{f.artifact.workflow_run.id=9},'prior-origin-artifact-unproven'],
        ['candidate controlled old workflow', f=>{f.blob=SHA(7)},'prior-workflow-not-trusted'],
        ['copied checkout', f=>{f.check=false},'integration-checkout-not-exact'],
        ['branch moved during proof', f=>{f.nextPull={...f.pull,head:{sha:SHA(7),repo}}},'live-pr-moved'],
    ])('rejects %s',async(_,mutation,reason)=>{
        const f=fixture();mutation(f);expect(await f.runCheck()).toEqual({eligible:false,reason});
    });
});


it('a same-attempt proof alone can enter the explicitly named reuse lane', async()=>{
    const proof = {...await fixture().runCheck(),runId:'100',runAttempt:'2',reviewHead:SHA(2),reviewBase:SHA(4)};
    const env = {GITHUB_REPOSITORY:repository,GITHUB_EVENT_NAME:'pull_request',GITHUB_RUN_ID:'100',
        GITHUB_RUN_ATTEMPT:'2',PR_NUMBER:'1915',PR_HEAD_SHA:SHA(2),PR_BASE_SHA:SHA(4),GITHUB_SHA:SHA(5),PR_BEFORE_SHA:SHA(1)};
    expect(acceptBaseOnlyAudit(proof,env)).toBe(true);
    for (const mutate of [{runAttempt:'1'}, {runId:'101'}, {eligible:false}, {kind:'fresh-engineering'}, {target:{...proof.target,base:SHA(7)}}])
        expect(acceptBaseOnlyAudit({...proof,...mutate},env)).toBe(false);
    expect(acceptBaseOnlyAudit(undefined,env)).not.toBe(true);
    expect(acceptBaseOnlyAudit(proof,{...env,GITHUB_EVENT_NAME:'push'})).toBe(false);
});

it('the required report executes the actual reuse branch and refuses missing or copied proof', async()=>{
    const { spawnSync } = await import('node:child_process');
    const { readFileSync } = await import('node:fs');
    const { default: yaml } = await import('js-yaml');
    const workflow = yaml.load(readFileSync('.github/workflows/ci.yml','utf8'));
    const report = workflow.jobs.report.steps.find(step=>step.name==='Enforce Selected Lane').run;
    const proof = {...await fixture().runCheck(),runId:'100',runAttempt:'2',reviewHead:SHA(2),reviewBase:SHA(4)};
    const env = { ...process.env,GITHUB_REPOSITORY:repository,GITHUB_EVENT_NAME:'pull_request',GITHUB_RUN_ID:'100',
        GITHUB_RUN_ATTEMPT:'2', PR_NUMBER:'1915',PR_HEAD_SHA:SHA(2),PR_BASE_SHA:SHA(4),GITHUB_SHA:SHA(5),PR_BEFORE_SHA:SHA(1),
        SCOPE_RESULT:'success',FULL_REQUIRED:'true',DOCS_LANE:'false',QUALITY_RESULT:'skipped', UNIT_RESULT:'skipped',
        EDGE_RESULT:'skipped', BUILD_RESULT:'skipped', HEALTH_RESULT:'skipped', E2E_RESULT:'skipped', EVIDENCE_RESULT:'skipped',
        BASE_ONLY_PROOF:JSON.stringify(proof) };
    const run = override=>spawnSync('bash',['-c',report],{env:{...env,...override},encoding:'utf8'});
    expect(run({}).status).toBe(0);
    for (const bad of [{BASE_ONLY_PROOF:''},{GITHUB_RUN_ATTEMPT:'3'},{BASE_ONLY_PROOF:JSON.stringify({...proof,reviewHead:SHA(9)})},{SCOPE_RESULT:'failure'},{FULL_REQUIRED:'false'}])
        expect(run(bad).status).not.toBe(0);
    // The trusted advisory consumer cannot claim fresh engineering for this run.
    const advisory = evaluateEngineeringEvidence({pr:1915, liveHeadSha:SHA(2), liveBaseSha:SHA(4),
        expectedHeadSha:SHA(2), workflowUnchanged:true, headContainsBase:true,
        runs:[{id:100,head_sha:SHA(2),event:'pull_request',status:'completed',conclusion:'success'}],
        jobsByRun:{100:{scope:'success',report:'success','full-evidence':'skipped'}}});
    expect(advisory).toMatchObject({qualified:false,reasons:[ENGINEERING_HOLD.JOB_NOT_SUCCESSFUL]});

    // The actual default API guard does not read that workflow or a receipt
    // file; it still refuses a finding reopened after the first API snapshot.
    const reviewer = {login:'chatgpt-codex-connector'};
    const head = SHA(2), base = SHA(4);
    const clean = {number:1915,state:'OPEN',headRefOid:head,baseRefOid:base,baseRefName:'main',
        baseRepository:{nameWithOwner:repository},
        files:{nodes:[{path:'scripts/representative.mjs'}],pageInfo:{hasNextPage:false}},
        comments:{nodes:[],pageInfo:{hasPreviousPage:false}},
        reviews:{nodes:[{author:reviewer,commit:{oid:head},state:'COMMENTED',body:'reviewed',submittedAt:end}],
            pageInfo:{hasPreviousPage:false}},
        reviewThreads:{nodes:[],pageInfo:{hasNextPage:false}}};
    const reopened = { ...clean, reviewThreads:{ ...clean.reviewThreads,nodes:[{isResolved:false,
        comments:{nodes:[{author:reviewer,body:'P1 Badge — unresolved finding',commit:{oid:head},
            pullRequestReview:{state:'COMMENTED',commit:{oid:head}}}],pageInfo:{hasPreviousPage:false}}}]}};
    for (const final of [clean,reopened]) {
        const read = vi.fn().mockResolvedValueOnce(clean).mockResolvedValueOnce(final);
        const mergeExecutor=vi.fn(async()=>({sha:'mock-merge'}));
        const result = await guardedMerge({repository,prNumber:1915,expectedHeadSha:head,expectedBaseSha:base,token:'synthetic',
            collectDefaultReceipt:args=>collectLiveReviewReceipt({...args,readPull:read,readEnforcement:async()=>true}),
            readPullRequest:read,readBaseProtection:async()=>'enforced',mergeExecutor});
        expect(read).toHaveBeenCalledTimes(2);
        expect(result.mergeInvoked).toBe(final===clean);
        expect(mergeExecutor).toHaveBeenCalledTimes(final===clean ? 1 : 0);
    }
    expect(workflow.jobs['review-qualification'].needs).toEqual(['scope','full-evidence']);
    expect(workflow.jobs.report.needs).not.toContain('review-qualification');
    expect(workflow.jobs['merge-qualification'].steps.at(-1).run).toContain('results["review-qualification"] !== "success"');
});
