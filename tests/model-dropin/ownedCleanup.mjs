import {mkdir,writeFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import process from 'node:process';
import console from 'node:console';
import {setTimeout as delay} from 'node:timers/promises';
const retired=new WeakSet();
function observe(job,probe){if(retired.has(job))return 'absent';const state=probe(job.pid);if(state==='absent')retired.add(job);return state;}

/** A deliberately fail-closed interlock record. Existing assertClear rejects it even after owner death. */
export async function createCleanupBarrier(root,runId){
  if(!/^[A-Za-z0-9_-]{8,80}$/.test(runId))throw Error('cleanup_run_identity_invalid');
  await mkdir(join(root,'.host-locks'),{recursive:true});
  const path=join(root,'.host-locks',`benchmark.cleanup-${process.pid}-${runId}.lock`);
  await writeFile(path,JSON.stringify({kind:'cleanup_exclusion',runId,ownerPid:process.pid,
    reason:'owned_workload_absence_not_yet_verified; do not reclaim by PID expiry'})+'\n',{flag:'wx',mode:0o600});
  let released=false;
  return {path,release:async()=>{if(!released){await unlink(path);released=true;}}};
}
export function groupState(pid){
  try{process.kill(-pid,0);return 'live';}catch(error){return error.code==='ESRCH'?'absent':'unknown';}
}
export function signalOwnedGroups(jobs,signal){
  for(const job of [...jobs].reverse())if(job.pid&&observe(job,groupState)==='live'){
    try{process.kill(-job.pid,signal);}catch{/* unknown retains exclusion */}
  }
}
/** No timeout returns 'uncertain'. Model work stops at its cap; cleanup exclusion persists until proof. */
export async function awaitOwnedCleanup(jobs,barrier,{graceMs=5000,probe=groupState,
  ownershipComplete=()=>true,onHold=()=>console.error('CLEANUP_HOLD: host exclusion retained; owned absence is unverified'),
  sleep=delay}={}){
  signalOwnedGroups(jobs,'SIGTERM');
  const started=Date.now();let killed=false;let notified=false;
  for(;;){
    const states=jobs.filter(job=>job.pid).map(job=>observe(job,probe));
    if(ownershipComplete()&&states.every(state=>state==='absent')){await barrier.release();return {verified:true};}
    if(!killed&&Date.now()-started>=graceMs){
      // Stop deepest separately registered groups first, allowing their parents to reap them.
      for(const job of [...jobs].reverse())if(job.pid&&observe(job,probe)==='live'){
        try{process.kill(-job.pid,'SIGKILL');}catch{/* unknown => exclusion remains */}await sleep(50);
      }
      killed=true;
    }
    if(killed&&!notified){notified=true;onHold();}
    await sleep(100);
  }
}
