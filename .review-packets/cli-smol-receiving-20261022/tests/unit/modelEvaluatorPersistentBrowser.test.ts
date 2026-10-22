import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {BrowserContext} from 'playwright';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const filesystem={mkdir:vi.fn(),writeFile:vi.fn()};
import {launchOwnedPersistent,validatePersistentProfile} from '../../scripts/model-evaluator/persistent-browser';

const profile='/private/tmp/speaksharp-eval-owned-unit';
beforeEach(()=>{vi.resetAllMocks();filesystem.mkdir.mockResolvedValue(undefined);filesystem.writeFile.mockResolvedValue(undefined);});
describe('exclusive evaluator disk-backed profile ownership',()=>{
  it.each(['llama','smol'])('actual %s runner acquires and closes only its persistent context',kind=>{
    const directory=mkdtempSync(join(tmpdir(),'persistent-runner-acquire-'));
    const output=join(directory,'report.json'),manifest=join(directory,'assets.json');
    const preload=join(directory,'preload.mjs'),loader=join(directory,'loader.mjs'),stub=join(directory,'playwright.mjs');
    const log=join(directory,'calls.jsonl'),runner=join(process.cwd(),'scripts/model-investigation.mts');
    const ownedProfile=`/private/tmp/speaksharp-eval-owned-unit-${process.pid}-${kind}-${Date.now()}`;
    writeFileSync(manifest,JSON.stringify({state:'TEST_EMPTY_MANIFEST',assets:[]}));
    writeFileSync(loader,`export async function resolve(name,context,next){
      if(name==='playwright'||name==='esbuild')return {url:${JSON.stringify(pathToFileURL(stub).href)},shortCircuit:true};
      return next(name,context);
    }`);
    writeFileSync(stub,`
      import {appendFileSync,writeFileSync} from 'node:fs';
      export const build=async(options)=>{writeFileSync(options.outfile,'export {};\\n');};
      const record=value=>appendFileSync(${JSON.stringify(log)},JSON.stringify(value)+'\\n');
      const forbidden=()=>{throw Error('TEST_FORBIDS_EPHEMERAL_OR_BORROWED_BROWSER');};
      const context={route:async()=>{},browser:()=>({close:forbidden}),
        newPage:async()=>{throw Error('TEST_STOP_BEFORE_MODEL');},close:async()=>record({type:'owned-close'})};
      export const chromium={launchPersistentContext:async(profile,options)=>{record({type:'persistent-launch',profile,options});return context;},
        launchServer:forbidden,connect:forbidden,connectOverCDP:forbidden};
    `);
    writeFileSync(preload,`
      import child from 'node:child_process';
      import {syncBuiltinESMExports,register} from 'node:module';
      const original=child.execFileSync;
      child.spawn=()=>{throw Error('TEST_FORBIDS_REAL_BROWSER_OR_SERVICE_SPAWN');};
      child.execFileSync=(command,args,options)=>{
        if(command==='/usr/bin/memory_pressure')return 'System-wide memory free percentage: 100%';
        if(command==='cat'&&args?.[0]==='/proc/meminfo')return 'MemAvailable: 8388608 kB';
        return original(command,args,options);
      };
      syncBuiltinESMExports();register(${JSON.stringify(pathToFileURL(loader).href)},import.meta.url);
      process.argv=${JSON.stringify([process.execPath,runner,`--kind=${kind}`,'--coaching-protocol=product-contract',
        `--persistent-profile=${ownedProfile}`,`--assets=${manifest}`,`--out=${output}`])};
      await import(${JSON.stringify(pathToFileURL(runner).href)});
    `);
    try{
      const result=spawnSync(process.execPath,['--import','tsx',preload],{encoding:'utf8',timeout:20000});
      expect(result.error).toBeUndefined();expect(result.status).toBe(1);
      const report=JSON.parse(readFileSync(output,'utf8'));
      expect(report.error).toContain('TEST_STOP_BEFORE_MODEL');
      expect(report.protocol.kind).toBe(kind);expect(report.protocol.cells).toHaveLength(18);
      expect(report.protocol.cacheState).toBe('FRESH_PROFILE_REUSE_REFUSED');
      expect(report.protocol.executedSourceFiles.some((x:{file:string})=>x.file==='scripts/model-evaluator/persistent-browser.ts')).toBe(true);
      expect(report.cellDispatchesAttempted).toBe(0);expect(report.acquisition).toBeUndefined();
      expect(report.ownedContextState).toBe('CLOSED');expect(report.transportCleanup).toBe('OWNED_PERSISTENT_CONTEXT_CLOSED');
      const calls=readFileSync(log,'utf8').trim().split('\n').map(line=>JSON.parse(line));
      expect(calls).toEqual([{type:'persistent-launch',profile:ownedProfile,options:{channel:'chrome',headless:false}},{type:'owned-close'}]);
      expect(JSON.parse(readFileSync(join(ownedProfile,'evaluator-owner.json'),'utf8')).profile).toBe(ownedProfile);
      expect(report.cleanup.every((x:{status:string})=>x.status==='COMPLETE')).toBe(true);
    }finally{rmSync(directory,{recursive:true,force:true});rmSync(ownedProfile,{recursive:true,force:true});}
  });
  it.each(['llama','smol'])('actual %s runner never reports CLOSED after a pre-acquisition resource refusal',kind=>{
    const directory=mkdtempSync(join(tmpdir(),'persistent-runner-refusal-'));
    const output=join(directory,'report.json');
    const manifest=join(directory,'assets.json');
    const preload=join(directory,'refuse-memory.mjs');
    const runner=join(process.cwd(),'scripts/model-investigation.mts');
    writeFileSync(manifest,JSON.stringify({state:'TEST_EMPTY_MANIFEST',assets:[]}));
    writeFileSync(preload,`
      import child from 'node:child_process';
      import {syncBuiltinESMExports} from 'node:module';
      const original=child.execFileSync;
      child.spawn=()=>{throw new Error('TEST_FORBIDS_BROWSER_OR_SERVICE_SPAWN');};
      child.execFileSync=(command,args,options)=>{
        if(command==='/usr/bin/memory_pressure')return 'System-wide memory free percentage: 0%';
        if(command==='cat'&&args?.[0]==='/proc/meminfo')return 'MemAvailable: 0 kB';
        return original(command,args,options);
      };
      syncBuiltinESMExports();
      process.argv=${JSON.stringify([process.execPath,runner,`--kind=${kind}`,'--coaching-protocol=product-contract',
        '--persistent-profile=/private/tmp/speaksharp-eval-owned-MUST-NOT-BE-CREATED',`--assets=${manifest}`,`--out=${output}`])};
      await import(${JSON.stringify(pathToFileURL(runner).href)});
    `);
    try{
      const result=spawnSync(process.execPath,['--import','tsx',preload],{encoding:'utf8',timeout:10000});
      expect(result.error).toBeUndefined();expect(result.status).toBe(2);
      const report=JSON.parse(readFileSync(output,'utf8'));
      expect(report.error).toContain('HOLD_RESOURCE_HEADROOM_BELOW_2GIB');
      expect(report.cellDispatchesAttempted).toBe(0);
      expect(report.ownedContextState).toBe('NOT_CREATED');
      expect(report.transportCleanup).not.toContain('CLOSED');
      expect(report.transportCleanup).toBe('OWNED_PERSISTENT_CONTEXT_NOT_CREATED');
    }finally{rmSync(directory,{recursive:true,force:true});}
  });
  it('records a fresh owned profile before launching and retains its files',async()=>{
    const context={close:vi.fn()} as unknown as BrowserContext;
    const launch=vi.fn(async()=>context);
    const owned=await launchOwnedPersistent(profile,false,launch,filesystem);
    expect(filesystem.mkdir).toHaveBeenCalledExactlyOnceWith(profile);
    expect(filesystem.writeFile).toHaveBeenCalledWith(profile+'/evaluator-owner.json',expect.any(String),{flag:'wx'});
    expect(filesystem.mkdir.mock.invocationCallOrder[0]).toBeLessThan(launch.mock.invocationCallOrder[0]);
    expect(filesystem.writeFile.mock.invocationCallOrder[0]).toBeLessThan(launch.mock.invocationCallOrder[0]);
    expect(launch).toHaveBeenCalledExactlyOnceWith(profile,false);
    expect(owned.context).toBe(context);
    expect(owned.evidence).toMatchObject({profile,cacheState:'FRESH_PROFILE',profileReuse:'REFUSED',profileDisposition:'RETAINED_NOT_DELETED'});
  });
  it('refuses an existing directory or symlink without launch or owner-marker writes',async()=>{
    filesystem.mkdir.mockRejectedValue(Object.assign(new Error('exists'),{code:'EEXIST'}));
    const launch=vi.fn();
    await expect(launchOwnedPersistent(profile,false,launch,filesystem)).rejects.toThrow('exists');
    expect(launch).not.toHaveBeenCalled();expect(filesystem.writeFile).not.toHaveBeenCalled();
  });
  it('does not launch after owner-marker creation fails',async()=>{
    filesystem.writeFile.mockRejectedValue(new Error('marker denied'));
    const launch=vi.fn();
    await expect(launchOwnedPersistent(profile,false,launch,filesystem)).rejects.toThrow('marker denied');
    expect(launch).not.toHaveBeenCalled();
  });
  it('preserves launch failure without falling back to another browser or profile',async()=>{
    const launch=vi.fn(async()=>{throw new Error('launch failed');});
    await expect(launchOwnedPersistent(profile,false,launch,filesystem)).rejects.toThrow('launch failed');
    expect(launch).toHaveBeenCalledOnce();expect(filesystem.mkdir).toHaveBeenCalledOnce();
  });
  it('rejects arbitrary user profiles and ambiguous modes before filesystem operations',async()=>{
    for(const path of ['/Users/fibonacci/speaksharp-eval-profile','/private/tmp/../owned',
      '/private/tmp/speaksharp-eval-owned-x/subdir','/tmp/speaksharp-eval-owned-x',42]){
      expect(()=>validatePersistentProfile(path)).toThrow();
    }
    expect(()=>validatePersistentProfile(profile,'http://127.0.0.1:9222')).toThrow(/mutually exclusive/);
    expect(filesystem.mkdir).not.toHaveBeenCalled();
  });
});

