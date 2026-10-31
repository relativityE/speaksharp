import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,URL} from 'node:url';
import process from 'node:process';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {createCleanupBarrier,awaitOwnedCleanup,groupState} from './ownedCleanup.mjs';
import {assertClear} from '../../scripts/lib/hostInterlock.mjs';
const fixtureEnv={...process.env,SPEAKSHARP_INTERLOCK_HELD:'',SPEAKSHARP_INTERLOCK:'',GITHUB_ACTIONS:''};
const clear=root=>assertClear('local',{root,env:fixtureEnv});
test('uncertain ownership cannot complete or release host exclusion',{timeout:5000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'comparison-unknown-'));const barrier=await createCleanupBarrier(root,'unknown-control');
  let known=false;let done=false;let holds=0;
  const waiting=awaitOwnedCleanup([],barrier,{graceMs:0,ownershipComplete:()=>known,onHold:()=>{holds++;}}).then(()=>{done=true;});
  try{await delay(150);assert.equal(done,false);assert.equal(holds,1);assert.throws(()=>clear(root),/unreadable/);
    known=true;await waiting;assert.equal(done,true);assert.doesNotThrow(()=>clear(root));
  }finally{known=true;await waiting;await rm(root,{recursive:true,force:true});}
});
test('separately registered detached descendant survives TERM but is killed and verified before release',{timeout:10_000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'comparison-descendant-'));const barrier=await createCleanupBarrier(root,'descendant-control');
  const code=`const {spawn}=require('node:child_process');process.on('SIGTERM',()=>{});const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000)"],{detached:true,stdio:['ignore','ignore','ignore','ipc']});child.once('message',()=>process.send(child.pid));setInterval(()=>{},1000);`;
  const leader=spawn(process.execPath,['-e',code],{detached:true,stdio:['ignore','ignore','ignore','ipc']});
  const descendant=await new Promise(resolve=>leader.once('message',resolve));
  const jobs=[{pid:leader.pid},{pid:descendant}];let done=false;
  const waiting=awaitOwnedCleanup(jobs,barrier,{graceMs:350,onHold:()=>{}}).then(()=>{done=true;});
  try{await delay(100);assert.equal(groupState(descendant),'live');assert.equal(done,false);assert.throws(()=>clear(root),/unreadable/);
    await waiting;assert.equal(groupState(descendant),'absent');assert.equal(groupState(leader.pid),'absent');assert.doesNotThrow(()=>clear(root));
  }finally{for(const job of jobs){try{process.kill(-job.pid,'SIGKILL');}catch{/* terminal */}}await waiting;await rm(root,{recursive:true,force:true});}
});
test('killing the runner lets the old wrapper exit but does not erase durable cleanup exclusion',{timeout:10_000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'comparison-wrapper-'));
  const guard=fileURLToPath(new URL('../../scripts/host-interlock.mjs',import.meta.url));
  const helper=new URL('./ownedCleanup.mjs',import.meta.url).href;
  const code=`import {createCleanupBarrier} from ${JSON.stringify(helper)};const b=await createCleanupBarrier(process.cwd(),'killed-control');console.log(JSON.stringify({pid:process.pid,path:b.path}));setInterval(()=>{},1000);`;
  const wrapper=spawn(process.execPath,[guard,'hold','benchmark','--',process.execPath,'--input-type=module','-e',code],
    {cwd:root,env:fixtureEnv,stdio:['ignore','pipe','pipe']});
  const terminal=new Promise(resolve=>wrapper.once('exit',resolve));
  const record=await new Promise(resolve=>{let body='';wrapper.stdout.on('data',chunk=>{body+=chunk;const line=body.split('\n')[0];try{resolve(JSON.parse(line));}catch{/* await complete line */}});});
  try{assert.throws(()=>clear(root));process.kill(-record.pid,'SIGKILL');await terminal;
    assert.equal(groupState(record.pid),'absent');assert.ok((await readFile(record.path,'utf8')).includes('owned_workload_absence_not_yet_verified'));
    assert.throws(()=>clear(root),/unreadable/);
    // Explicit fixture handoff: the only spawned workload is verified absent before removing this test barrier.
    await unlink(record.path);assert.doesNotThrow(()=>clear(root));
  }finally{try{process.kill(-record.pid,'SIGKILL');}catch{/* terminal */}await terminal;await rm(root,{recursive:true,force:true});}
});
