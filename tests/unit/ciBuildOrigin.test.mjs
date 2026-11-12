import { Buffer } from 'node:buffer';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyArtifactOrigin, canReuseBuild } from '../../scripts/ci-build-origin.mjs';
const sha = 'a'.repeat(40), bytes = Buffer.from('real immutable archive');
const expected = { repositoryId: 1030860260, repository: 'relativityE/speaksharp', workflowId: 42,
 workflowPath: '.github/workflows/ci.yml', artifactName: 'build-reuse-v1', sourceSha: sha, runId: 123, attempt: 1, artifactId: 456 };
const fixture = () => ({ expected: {...expected}, archive: bytes,
 apiRun: { id:123, run_attempt:1, workflow_id:42, path:expected.workflowPath, repository:{id:expected.repositoryId,full_name:expected.repository},
 head_repository:{id:expected.repositoryId},event:'push',head_branch:'main',head_sha:sha,status:'completed',conclusion:'success' },
 apiArtifact: {id:456,name:expected.artifactName,expired:false,digest:`sha256:${createHash('sha256').update(bytes).digest('hex')}`,
 workflow_run:{id:123,repository_id:expected.repositoryId,head_repository_id:expected.repositoryId,head_branch:'main',head_sha:sha}} });
test('accept exact authenticated successful main run plus independently hashed archive',()=>assert.equal(verifyArtifactOrigin(fixture()).artifactId,456));
for (const [field,value] of Object.entries({event:'pull_request',head_branch:'feature',head_sha:'b'.repeat(40),status:'in_progress',conclusion:'failure',path:'.github/workflows/evil.yml',workflow_id:7,id:124,run_attempt:2,repository:{id:7,full_name:expected.repository},head_repository:{id:7}})) {
 test(`reject producer ${field}`,()=>{const input=fixture();input.apiRun[field]=value;assert.throws(()=>verifyArtifactOrigin(input));});
}
for (const [field,value] of Object.entries({id:457,name:'other',expired:true,digest:'',workflow_run:{id:999}})) {
 test(`reject artifact ${field}`,()=>{const input=fixture();input.apiArtifact[field]=value;assert.throws(()=>verifyArtifactOrigin(input));});
}
test('manifest beside poisoned payload cannot bless bytes',()=>{const input=fixture();input.archive=Buffer.from('poison');assert.throws(()=>verifyArtifactOrigin(input));});
test('self-written receipt cannot replace API provenance',()=>{const input=fixture();input.apiRun={...expected};assert.throws(()=>verifyArtifactOrigin(input));});
const graph = () => Object.fromEntries([['schema',1],['complete',true],...['toolchain','environment','controls','modules','watched','globTrees','runtimeBindings'].map(k=>[k,'c'.repeat(64)])]);
test('equal complete build inputs permit reuse regardless of commit',()=>assert.equal(canReuseBuild({producer:{...graph(),commit:sha},consumer:{...graph(),commit:'b'.repeat(40)}}),true));
for(const key of ['toolchain','environment','controls','modules','watched','globTrees','runtimeBindings']) test(`changed ${key} requires rebuild`,()=>assert.equal(canReuseBuild({producer:graph(),consumer:{...graph(),[key]:'d'.repeat(64)}}),false));
test('new glob file rebuilds even if old module hashes match',()=>assert.equal(canReuseBuild({producer:graph(),consumer:{...graph(),globTrees:'e'.repeat(64)}}),false));
test('incomplete discovery never reuses',()=>assert.equal(canReuseBuild({producer:graph(),consumer:{...graph(),complete:false}}),false));
