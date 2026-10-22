import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,type BrowserContext} from 'playwright';

export function validatePersistentProfile(profile:unknown,cdpEndpoint?:unknown):string|undefined {
  if(profile===undefined||profile==='')return undefined;
  if(cdpEndpoint)throw new Error('Persistent profile and borrowed CDP are mutually exclusive');
  if(typeof profile!=='string'||!/^\/private\/tmp\/speaksharp-eval-owned-[A-Za-z0-9][A-Za-z0-9._-]*$/.test(profile))
    throw new Error('Persistent profile must be a fresh evaluator-owned directory under /private/tmp');
  return profile;
}
export type PersistentEvidence={profile:string;cacheState:'FRESH_PROFILE';profileReuse:'REFUSED';
  browserOwnership:'owned-persistent-profile';profileDisposition:'RETAINED_NOT_DELETED'};

/** Exclusive mkdir refuses existing profiles (including symlinks and prior caches).
 * Closing this context closes only the Chrome process launched for this profile.
 * Files remain retained; this helper never clears or adopts another profile. */
export async function launchOwnedPersistent(profile:string,headless:boolean,
  launch:(profile:string,headless:boolean)=>Promise<BrowserContext>=
    (directory,hidden)=>chromium.launchPersistentContext(directory,{channel:'chrome',headless:hidden}),
  files:{mkdir:(path:string)=>Promise<unknown>;
    writeFile:(path:string,data:string,options:{flag:'wx'})=>Promise<unknown>}={mkdir,writeFile}) {
  if(!validatePersistentProfile(profile))throw new Error('Persistent profile missing');
  await files.mkdir(profile); // No recursive/exist-ok: ownership must be acquired atomically.
  const evidence:PersistentEvidence={profile,cacheState:'FRESH_PROFILE',profileReuse:'REFUSED',
    browserOwnership:'owned-persistent-profile',profileDisposition:'RETAINED_NOT_DELETED'};
  await files.writeFile(`${profile}/evaluator-owner.json`,JSON.stringify({
    ...evidence,createdUtc:new Date().toISOString(),controllerPid:process.pid,
  },null,2)+'\n',{flag:'wx'});
  const context=await launch(profile,headless);
  return {context,evidence};
}
