// A read-only engineering reuse decision. The normal CI and review gates remain
// responsible for current branch status and review authority; never post a check here.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectBaseOnlyCiInputs } from './ciCarryInputIdentity.mjs';
import { REQUIRED_RELEASE_JOBS } from '../production-release-policy.mjs';

const SHA = /^(?!0{40}$)[0-9a-f]{40}$/;
const REPO = 'relativityE/speaksharp';
const CI = '.github/workflows/ci.yml';
const MAX_ORIGIN_ARCHIVE = 25_000_000;
const ORIGIN_FILE = 'artifacts/software-quality-input-origin.json';
const ORIGIN_DIGEST = /^sha256:[a-f0-9]{64}$/;
const REQUIRED = new Set([...REQUIRED_RELEASE_JOBS, 'scope', 'quality', 'report']);
const positive = n => Number.isSafeInteger(n) && n > 0;
const validSha = x => typeof x === 'string' && SHA.test(x);
const hold = reason => ({ eligible: false, reason });
const date = value => typeof value === 'string' ? Date.parse(value) : NaN;

export function verifyIntegrationCheckout(root, base, head, checkout, priorHead) {
    const git = (...args) => execFileSync('git', ['--no-replace-objects',...args], {cwd:root,encoding:'utf8',timeout:10000}).trim();
    return git('rev-parse','HEAD') === checkout
        && git('show','-s','--format=%P',checkout) === `${base} ${head}`
        && git('rev-parse',`${checkout}^{tree}`) === git('rev-parse',`${head}^{tree}`)
        && git('rev-parse',`${head}^{tree}`) === git('rev-parse',`${priorHead}^{tree}`);
}

export async function verifyBaseOnlyEngineering({ root, repository, eventName, event, checkoutHead, read, readArtifact,
    inspect = inspectBaseOnlyCiInputs, verifyCheckout = verifyIntegrationCheckout } = {}) {
    const pr = event?.pull_request?.number;
    const oldHead = event?.before, newHead = event?.after, newBase = event?.pull_request?.base?.sha;
    if (repository !== REPO || eventName !== 'pull_request' || event?.action !== 'synchronize'
        || !positive(pr) || ![oldHead,newHead,newBase,checkoutHead].every(validSha)
        || oldHead === newHead || event.pull_request.head?.sha !== newHead || event.pull_request.base?.ref !== 'main'
        || event.pull_request.base?.repo?.full_name !== REPO || event.pull_request.head?.repo?.full_name !== REPO
        || event.pull_request.draft !== false) return hold('not-a-bounded-same-repo-refresh');
    try {
        if (!verifyCheckout(root,newBase,newHead,checkoutHead,oldHead)) return hold('integration-checkout-not-exact');
        const endpoint = `/repos/${REPO}`;
        const pull = await read(`${endpoint}/pulls/${pr}`);
        const same = p => p?.number === pr && p.state === 'open' && p.draft === false
            && p.head?.sha === newHead && p.base?.sha === newBase && p.base?.ref === 'main'
            && p.head?.repo?.full_name === REPO && p.base?.repo?.full_name === REPO;
        if (!same(pull)) return hold('live-pr-moved');
        const list = await read(`${endpoint}/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${oldHead}&per_page=100`);
        if (!Array.isArray(list?.workflow_runs) || list.total_count !== list.workflow_runs.length || list.total_count > 100
            || list.workflow_runs.some(r => !positive(r.id) || !Number.isFinite(date(r.created_at)))
            || new Set(list.workflow_runs.map(r => r.id)).size !== list.workflow_runs.length) return hold('prior-run-list-incomplete');
        const candidates = list.workflow_runs.filter(r => r.head_sha === oldHead && r.event === 'pull_request');
        const run = candidates.sort((a,b) => date(b.created_at)-date(a.created_at) || b.id-a.id)[0];
        if (!run || run.repository?.full_name !== REPO || run.head_repository?.full_name !== REPO
            || run.path !== CI || !positive(run.run_attempt) || run.status !== 'completed' || run.conclusion !== 'success')
            return hold('prior-exact-full-run-not-green');
        const detailed = await read(`${endpoint}/actions/runs/${run.id}/attempts/${run.run_attempt}`);
        if (detailed.id !== run.id || detailed.run_attempt !== run.run_attempt || detailed.head_sha !== oldHead
            || detailed.event !== 'pull_request' || detailed.path !== CI || detailed.status !== 'completed'
            || detailed.conclusion !== 'success' || detailed.updated_at !== run.updated_at
            || !Number.isFinite(date(detailed.run_started_at))) return hold('prior-attempt-not-exact');
        const response = await read(`${endpoint}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
        const jobs = response?.jobs;
        if (!Array.isArray(jobs) || response.total_count !== jobs.length || jobs.length > 100
            || new Set(jobs.map(j => j.id)).size !== jobs.length || jobs.some(j => !positive(j.id)))
            return hold('prior-job-list-incomplete');
        for (const name of REQUIRED) {
            const matching = jobs.filter(j=> j.name === name);
            const [job] = matching;
            if (matching.length !== 1 || job.head_sha !== oldHead || job.run_id !== run.id
                || (Object.hasOwn(job,'run_attempt') && job.run_attempt !== run.run_attempt)
                || job.status !== 'completed' || job.conclusion !== 'success'
                || !(date(job.started_at) >= date(detailed.run_started_at)
                    && date(job.completed_at) >= date(job.started_at) && date(job.completed_at) <= date(run.updated_at)))
                return hold('prior-required-job-not-green');
        }
        const listArtifacts = await read(`${endpoint}/actions/runs/${run.id}/artifacts?name=ci-metrics&per_page=100`);
        const records = listArtifacts?.artifacts;
        const [artifact] = Array.isArray(records) ? records : [];
        if (listArtifacts?.total_count !== 1 || records.length !== 1 || artifact.name !== 'ci-metrics'
            || !positive(artifact.id) || artifact.expired !== false || !positive(artifact.size_in_bytes)
            || artifact.size_in_bytes > MAX_ORIGIN_ARCHIVE || artifact.workflow_run?.id !== run.id
            || artifact.workflow_run?.head_sha !== oldHead || typeof readArtifact !== 'function')
            return hold('prior-origin-artifact-unproven');
        if (typeof artifact.digest !== 'string' || !ORIGIN_DIGEST.test(artifact.digest)) return hold('prior-origin-digest-unproven');
        const origin = await readArtifact({ runId:run.id, artifactId:artifact.id, digest:artifact.digest });
        const recorded = origin?.originatingCi;
        const observed = origin?.qualityProvenance;
        const recordedCheckout = recorded?.commit;
        const oldBase = origin?.comparisonBase;
        if (!validSha(oldBase)) return hold('prior-origin-identity-mismatch');
        // GitHub omits associations on some historical PR runs. If present,
        // they must agree; the independently resolved actual checkout binds the base.
        const links = run.pull_requests;
        if (!Array.isArray(links) || (links.length && (links.length !== 1 || links[0].number !== pr
            || links[0].head?.sha !== oldHead || links[0].base?.sha !== oldBase || links[0].base?.ref !== 'main')))
            return hold('prior-run-pr-association-mismatch');
        if (origin?.schemaVersion !== 1 || !validSha(recordedCheckout)
            || recorded.runId !== String(run.id) || recorded.runAttempt !== String(run.run_attempt)
            || observed?.source !== 'github-actions' || observed.commit !== recordedCheckout
            || observed.runId !== recorded.runId || observed.runAttempt !== recorded.runAttempt || !validSha(observed.tree))
            return hold('prior-origin-identity-mismatch');
        const [originalCheckout, previousHead] = await Promise.all([
            read(`${endpoint}/git/commits/${recordedCheckout}`), read(`${endpoint}/git/commits/${oldHead}`),
        ]);
        if (originalCheckout?.sha !== recordedCheckout || previousHead?.sha !== oldHead || previousHead.tree?.sha !== observed.tree
            || originalCheckout.tree?.sha !== observed.tree || originalCheckout.parents?.length !== 2
            || originalCheckout.parents[0].sha !== oldBase || originalCheckout.parents[1].sha !== oldHead)
            return hold('prior-integration-checkout-not-exact');
        const inputs = inspect({root,oldBase,oldHead,newBase,newHead});
        if (inputs.status !== 'INPUT_MATCH') return hold(inputs.reason);
        // An equal PR tree is insufficient if a candidate supplied a replacement
        // workflow; compare exact GitHub-controlled Git blobs across the four refs.
        for (const file of [CI, 'scripts/production-release-policy.mjs']) {
            const blobs = await Promise.all([oldBase,oldHead,newBase,newHead].map(sha => read(`${endpoint}/contents/${file}?ref=${sha}`)));
            if (!validSha(blobs[0]?.sha) || blobs.some(x => x?.sha !== blobs[0].sha)) return hold('prior-workflow-not-trusted');
        }
        const stillCurrent = await read(`${endpoint}/actions/runs/${run.id}`);
        if (stillCurrent?.id !== run.id || stillCurrent.head_sha !== oldHead || stillCurrent.run_attempt !== run.run_attempt
            || stillCurrent.status !== 'completed' || stillCurrent.conclusion !== 'success' || stillCurrent.updated_at !== run.updated_at)
            return hold('prior-attempt-superseded');
        if (!same(await read(`${endpoint}/pulls/${pr}`))) return hold('live-pr-moved');
        return { eligible:true, kind:'verified-base-only-engineering-reuse', repository, pr,
            source:{head:oldHead,base:oldBase,checkoutHead:recordedCheckout,tree:observed.tree,artifactId:artifact.id,artifactDigest:artifact.digest,runId:run.id,attempt:run.run_attempt},
            target:{head:newHead,base:newBase,checkoutHead} };
    } catch {
        return hold('github-engineering-proof-unavailable');
    }
}

export function acceptBaseOnlyAudit(proof, env) {
    return proof?.eligible === true && proof.kind === 'verified-base-only-engineering-reuse'
        && proof.repository === REPO && env.GITHUB_REPOSITORY === REPO && env.GITHUB_EVENT_NAME === 'pull_request'
        && String(proof.pr) === env.PR_NUMBER && validSha(proof.target?.head) && proof.target.head === env.PR_HEAD_SHA
        && validSha(proof.target.base) && proof.target.base === env.PR_BASE_SHA
        && validSha(proof.target.checkoutHead) && proof.target.checkoutHead === env.GITHUB_SHA
        && validSha(proof.source?.head) && proof.source.head === env.PR_BEFORE_SHA && proof.source.head !== proof.target.head
        && validSha(proof.source.base) && proof.source.base !== proof.target.base
        && validSha(proof.source.checkoutHead) && validSha(proof.source.tree) && positive(proof.source.artifactId)
        && typeof proof.source.artifactDigest === 'string' && ORIGIN_DIGEST.test(proof.source.artifactDigest)
        && positive(proof.source.runId) && positive(proof.source.attempt)
        && proof.reviewHead === proof.target.head && proof.reviewBase === proof.target.base
        && proof.runId === env.GITHUB_RUN_ID && proof.runAttempt === env.GITHUB_RUN_ATTEMPT
        && /^[1-9]\d*$/.test(proof.runId ?? '') && /^[1-9]\d*$/.test(proof.runAttempt ?? '');
}


// Download the selected immutable artifact ID, never a mutable run/name lookup.
export async function downloadPriorCiOrigin({ artifactId, digest, token, fetchImpl = globalThis.fetch } = {}) {
    if (!positive(artifactId) || typeof token !== 'string' || !token || /[\r\n]/.test(token)
        || (typeof digest !== 'string' || !ORIGIN_DIGEST.test(digest))) throw new Error('Missing artifact read authority');
    const endpoint = `https://api.github.com/repos/${REPO}/actions/artifacts/${artifactId}/zip`;
    const ttl = AbortSignal.timeout(20_000);
    const authorization = await fetchImpl(endpoint, { redirect:'manual', credentials:'omit', signal:ttl,
        headers:{ authorization:`Bearer ${token}`, accept:'application/vnd.github+json', 'x-github-api-version':'2022-11-28' } });
    let location;
    if (authorization.status === 302 && !authorization.redirected) {
        const redirected = authorization.headers.get('location');
        if (redirected) location = new URL(redirected);
    }
    await authorization.body?.cancel();
    // GitHub supplies the signed storage address over its authenticated API.
    // Do not forward the API token or follow an additional redirect.
    if (!location || location.protocol !== 'https:' || location.username || location.password || location.port || location.hash || !location.search
        || !/^productionresultssa[0-9]+\.blob\.core\.windows\.net$/.test(location.hostname))
        throw new Error('Unproven artifact redirect');
    const storage = await fetchImpl(location.href, { redirect:'error', credentials:'omit', signal:ttl });
    if (storage.status !== 200 || storage.redirected || !storage.body) throw new Error('Artifact archive unavailable');
    const reader = storage.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
        for (;;) {
            const { done,value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > MAX_ORIGIN_ARCHIVE) throw new Error('Artifact archive exceeds bound');
            chunks.push(value);
        }
    } finally { await reader.cancel().catch(() => {}); }
    const archive = Buffer.concat(chunks,bytes);
    if (!bytes || digest !== `sha256:${createHash('sha256').update(archive).digest('hex')}`)
        throw new Error('Artifact archive digest mismatch');
    const temp = mkdtempSync(join(tmpdir(),'prior-ci-origin-'));
    try {
        const zip = join(temp,'artifact.zip');
        writeFileSync(zip,archive,{flag:'wx',mode:0o600});
        const options = {timeout:5_000,encoding:'utf8',maxBuffer:32_768,stdio:['ignore','pipe','ignore'],env:{PATH:process.env.PATH,LANG:'C'}};
        const names = execFileSync('unzip',['-Z1',zip],options).split('\n');
        if (names.filter(name=>name===ORIGIN_FILE).length !== 1) throw new Error('Invalid old origin archive entry');
        return JSON.parse(execFileSync('unzip',['-p',zip,ORIGIN_FILE],options));
    } finally { rmSync(temp,{recursive:true,force:true}); }
}
