// @vitest-environment node
import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtemp,writeFile,rm,rename,symlink,unlink,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {closeVerifiedAssetIndex,indexCachedAssets,registeredAssetPins,startVerifiedAssetHttpServer} from './cachedModelAssets';
import { CANDIDATES } from '../../frontend/src/services/transcription/candidateRegistry';
let directory:string|undefined;
afterEach(async()=>{if(directory)await rm(directory,{recursive:true,force:true});directory=undefined;});
async function fixture(){directory=await mkdtemp(join(tmpdir(),'bounded-cache-control-'));const file=join(directory,'synthetic.bin');
  await writeFile(file,'synthetic weight control');const pin={url:'https://model.example.invalid/pinned.bin',bytes:24,
    sha256:createHash('sha256').update('synthetic weight control').digest('hex')};return {file,pin};}
describe('verified cached model delivery',()=>{
  it('derives a configuration-selected inventory, sharing identical bytes but refusing conflicting URLs',()=>{
    const base=CANDIDATES['v2:base.en'];
    const pins=registeredAssetPins('http://127.0.0.1:5174',[base,{...base,id:'fourth:compatible'}]);
    expect(pins.length).toBe(base.assets.files!.length);
    const changed={...base,id:'fourth:conflict',assets:{...base.assets,files:base.assets.files!.map((f,i)=>i?f:{...f,sha256:'a'.repeat(64)})}};
    expect(()=>registeredAssetPins('http://127.0.0.1:5174',[base,changed])).toThrow('cached_conflicting_inventory');
  });
  it('indexes only byte- and hash-matching entries without network access',async()=>{
    const {file,pin}=await fixture();const index=await indexCachedAssets([pin],[{...pin,file}]);expect(index.size).toBe(1);
    expect(index.has('https://model.example.invalid/unapproved.bin')).toBe(false);
  });
  it('refuses missing or duplicate inventory and changed model bytes',async()=>{
    const {file,pin}=await fixture();
    await expect(indexCachedAssets([pin],[])).rejects.toThrow('cached_inventory');
    await expect(indexCachedAssets([pin],[{...pin,file},{...pin,file}])).rejects.toThrow('cached_inventory');
    await expect(indexCachedAssets([pin],[{...pin,file,sha256:'a'.repeat(64)}])).rejects.toThrow('cached_pin_mismatch');
    await writeFile(file,'synthetic weight controX');
    await expect(indexCachedAssets([pin],[{...pin,file}])).rejects.toThrow('cached_hash_mismatch');
    await writeFile(file,'short');await expect(indexCachedAssets([pin],[{...pin,file}])).rejects.toThrow('cached_size_mismatch');
  });
  it('uses the shipping three-candidate registry inventory including self-hosted incumbent and runtime pins',()=>{
    const pins=registeredAssetPins('http://127.0.0.1:5174');expect(pins.length).toBe(28);
    expect(pins.some(pin=>pin.url.startsWith('http://127.0.0.1:5174/models/whisper-base.en/'))).toBe(true);
    expect(pins.every(pin=>pin.bytes>0&&/^[a-f0-9]{64}$/.test(pin.sha256))).toBe(true);
  });
});
describe('verified cache bytes cannot change between verification and delivery',()=>{
  const APP='http://127.0.0.1:5174';
  async function served(){const {file,pin}=await fixture();const index=await indexCachedAssets([pin],[{...pin,file}]);
    const server=await startVerifiedAssetHttpServer(index,APP);return {file,pin,index,server,url:server.lookup(pin.url)!};}
  it('delivers the verified bytes and closes every handle on close',async()=>{
    const {index,server,url}=await served();
    const response=await fetch(url);expect(response.status).toBe(200);expect(await response.text()).toBe('synthetic weight control');
    await server.close();expect([...index.values()].every(entry=>entry.handle.fd===-1)).toBe(true);
  });
  it('refuses bytes rewritten in place after indexing',async()=>{
    const {file,server,url}=await served();await writeFile(file,'synthetic weight controX');
    expect((await fetch(url)).status).toBe(409);expect(server.snapshot().cacheResponseCount).toBe(0);await server.close();
  });
  it('refuses a change between two range requests',async()=>{
    const {file,server,url}=await served();
    const first=await fetch(url,{headers:{Range:'bytes=0-4'}});expect(first.status).toBe(206);expect(await first.text()).toBe('synth');
    await writeFile(file,'synthetic weight controX');
    expect((await fetch(url,{headers:{Range:'bytes=5-9'}})).status).toBe(409);await server.close();
  });
  it('refuses an identical-bytes file swapped in at the verified path',async()=>{
    const {file,server,url}=await served();const replacement=join(directory!,'replacement.bin');
    await writeFile(replacement,'synthetic weight control');await rename(replacement,file);
    expect((await fetch(url)).status).toBe(409);await server.close();
  });
  it('refuses a symlink swapped in at the verified path',async()=>{
    const {file,server,url}=await served();const other=join(directory!,'other.bin');
    await writeFile(other,'synthetic weight control');await unlink(file);await symlink(other,file);
    expect((await fetch(url)).status).toBe(409);await server.close();
  });
  it('refuses a symlinked cache entry at indexing',async()=>{
    const {file,pin}=await fixture();const link=join(directory!,'link.bin');await symlink(file,link);
    await expect(indexCachedAssets([pin],[{...pin,file:link}])).rejects.toThrow('cached_size_mismatch');
  });
  it('closes handles already opened when a later entry fails verification',async()=>{
    const {file,pin}=await fixture();const bad=join(directory!,'bad.bin');await writeFile(bad,'synthetic weight controX');
    const second={...pin,url:'https://model.example.invalid/second.bin'};
    // FileHandle.close is a per-instance field, so count this process's open descriptors instead of spying on it.
    const openDescriptors=async()=>(await readdir(process.platform==='linux'?'/proc/self/fd':'/dev/fd')).length;
    const before=await openDescriptors();
    await expect(indexCachedAssets([pin,second],[{...pin,file},{...second,file:bad}])).rejects.toThrow('cached_hash_mismatch');
    expect(await openDescriptors()).toBe(before);
  });
  it('closes the verified handles when the server cannot be started',async()=>{
    const {file,pin}=await fixture();const index=await indexCachedAssets([pin],[{...pin,file}]);
    const listen=vi.spyOn((await import('node:http')).Server.prototype,'listen').mockImplementationOnce(function(this:import('node:http').Server){
      queueMicrotask(()=>this.emit('error',Object.assign(Error('bind refused'),{code:'EACCES'})));return this;});
    await expect(startVerifiedAssetHttpServer(index,APP)).rejects.toThrow('bind refused');listen.mockRestore();
    expect([...index.values()].every(entry=>entry.handle.fd===-1)).toBe(true);
    await closeVerifiedAssetIndex(new Map());
  });
});
