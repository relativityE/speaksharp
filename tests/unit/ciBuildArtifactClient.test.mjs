/* global Response */
import { Buffer } from 'node:buffer';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { trustedMainRuns, downloadTrustedArtifact } from '../../scripts/ci-build-artifact-client.mjs';
const bytes=Buffer.from('archive'), sha='b'.repeat(40), name='smart-build-receipt-v1-attempt-1';
function fixture(change = {}) {
 const calls=[];
 const run={id:12,run_attempt:1,workflow_id:5,path:'.github/workflows/ci.yml',event:'push',head_branch:'main',status:'completed',conclusion:'success',repository:{id:7,full_name:'a/b'},head_repository:{id:7},head_sha:sha,...change.run};
 const artifact={id:34,name,expired:false,size_in_bytes:7,digest:`sha256:${createHash('sha256').update(bytes).digest('hex')}`,workflow_run:{id:12,repository_id:7,head_repository_id:7,head_branch:'main',head_sha:sha},...change.artifact};
 const fetchImpl=async(url,opts)=>{
 calls.push([url,opts]);
 if(url.includes('/zip')) return new Response(null,{status:302,headers:{location:change.location||'https://test.blob.core.windows.net/archive'}});
 if(url.startsWith('https://test.blob')) return new Response(change.payload||bytes);
 let data;
 if(url.endsWith('/ci.yml')) data={id:5,path:'.github/workflows/ci.yml'};
 else if(url.includes('/runs?')) data={workflow_runs:[{id:12}]};
 else if(url.endsWith('/runs/12')) data=run;
 else if(url.includes('/artifacts?')) data={total_count:1,artifacts:[artifact]};
 else throw Error('unexpected URL');
 return Response.json(data);
 };
 return {calls, options:{repository:'a/b',repositoryId:7,token:'SECRET',fetchImpl}};
}
async function first(f) {
 for await (const candidate of trustedMainRuns(f.options)) return downloadTrustedArtifact(f.options,{...candidate,name,maxBytes:1024});
 return null;
}
test('authenticated API origin and digest; storage never receives token',async()=>{const f=fixture();const result=await first(f);assert.equal(result.origin.artifactId,34);const last=f.calls.at(-1);assert.equal(last[1].headers,undefined);assert.equal(last[1].redirect,'error');assert(f.calls.slice(0,-1).every(([,o])=>o.headers.Authorization==='Bearer SECRET'));});
test('PR run cannot be trusted even when list endpoint was filtered',async()=>{const f=fixture({run:{event:'pull_request'}});assert.equal(await first(f),null);assert.equal(f.calls.length,3);});
for (const [field,value] of Object.entries({head_branch:'feature',conclusion:'failure',workflow_id:6,repository:{id:8,full_name:'a/b'}})) test(`run ${field} is not trusted`,async()=>{const f=fixture({run:{[field]:value}});assert.equal(await first(f),null);});
test('foreign signed URL rejected before request',async()=>{const f=fixture({location:'https://evil.example/steal'});await assert.rejects(first(f),/HOST/);assert(!f.calls.some(([u])=>u.includes('evil.example')));});
test('changed ZIP digest fails closed',async()=>{const f=fixture({payload:Buffer.from('poison')});await assert.rejects(first(f),/UNTRUSTED/);});
test('redirect credentials rejected',async()=>{const f=fixture({location:'https://attacker:pw@test.blob.core.windows.net/'});await assert.rejects(first(f),/HOST/);});
test('HTTP signed URL rejected',async()=>{const f=fixture({location:'http://test.blob.core.windows.net/archive'});await assert.rejects(first(f),/HOST/);});
test('expired artifact not downloaded',async()=>{const f=fixture({artifact:{expired:true}});assert.equal(await first(f),null);assert(!f.calls.some(([u])=>u.includes('/zip')));});
test('oversized artifact not downloaded',async()=>{const f=fixture({artifact:{size_in_bytes:4096}});assert.equal(await first(f),null);assert(!f.calls.some(([u])=>u.includes('/zip')));});
test('a stream larger than declared is cut off',async()=>{const f=fixture({payload:Buffer.alloc(2048)});await assert.rejects(first(f),/TOO_LARGE/);});
test('an artifact named for another run is not the one requested',async()=>{const f=fixture({artifact:{name:'smart-build-receipt-v1-attempt-2'}});await assert.rejects(first(f),/UNTRUSTED/);});
