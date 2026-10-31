import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {indexCachedAssets,registeredAssetPins} from './cachedModelAssets';
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
