import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { CANDIDATES } from '../../../frontend/src/services/transcription/candidateRegistry';
import { candidateFromPackage, effectiveBackend, sealModelPackage, verifyModelPackage, expectedModelIdentity, productModelMetadata, type ModelPackage } from '../../../frontend/src/services/transcription/modelPackage';

beforeAll(()=>{vi.stubGlobal('crypto',webcrypto);});
afterAll(()=>vi.unstubAllGlobals());
export async function fourthPackage() {
  const base=CANDIDATES['v2:base.en'];
  return sealModelPackage({schemaVersion:1,kind:'speaksharp-model-package',id:'justworks:compatible-whisper',
    engine:base.engine,runtime:base.runtime,model:{...base.model,device:'wasm'},execution:{...base.execution,localModelId:'justworks-whisper'},
    assets:{servedFrom:'/models/justworks-whisper',files:base.assets.files!.map(f=>({...f,url:'/models/justworks-whisper/'+f.path}))},license:'MIT (fixture declaration; no new model copied)'});
}
describe('one serializable compatible package',()=>{
  it('derives a fourth identity, inventory and product attribution without catalogue/engine/scorer edits',async()=>{
    const pkg=await fourthPackage();const c=candidateFromPackage(pkg,'fourth.json');
    expect(CANDIDATES[pkg.id]).toBeUndefined();
    expect(c.assets.componentCount).toBe(pkg.assets.files.length);
    expect(c.assets.totalBytes).toBe(pkg.assets.files.reduce((n,f)=>n+f.bytes,0));
    expect(expectedModelIdentity(c)).toMatchObject({engine:'private-v2',assetDigest:pkg.assetDigest,backend:'wasm'});
    expect(productModelMetadata(c)).toEqual({engineVersion:'private_v2:justworks-whisper',modelName:'justworks-whisper',deviceType:'browser'});
    expect(c.activationReady).toBe(false);expect(c.comparisonReady).toBe(false);
    expect(CANDIDATES['v2:base.en'].model.id).toBe('Xenova/whisper-base.en');
  });
  it('rejects byte-pin and config substitutions under an unchanged package digest',async()=>{
    const pkg=await fourthPackage();
    for(const mutate of [(p:ModelPackage)=>{p.assets.files[0].sha256='1'.repeat(64);},(p:ModelPackage)=>{p.model.id='different';}]){
      const changed=structuredClone(pkg);mutate(changed);await expect(verifyModelPackage(changed)).rejects.toThrow('PACKAGE_DIGEST_MISMATCH');
    }
  });
  it('refuses a version label upgrade, unsupported architecture, executable model assets and traversal before execution',async()=>{
    const pkg=await fourthPackage();
    for(const changed of [{...pkg,runtime:{...pkg.runtime,version:'5.6.0'}},{...pkg,engine:'arbitrary-runtime'},
      {...pkg,execution:{...pkg.execution,localModelId:'../escape'}},
      {...pkg,assets:{...pkg.assets,files:[...pkg.assets.files,{path:'run.mjs',url:'/models/justworks-whisper/run.mjs',bytes:1,sha256:'a'.repeat(64)}]}}]){
      await expect(verifyModelPackage(changed)).rejects.toThrow();
    }
  });
  it('derives the backend each registered candidate actually runs on, never guessing an undeclared one',()=>{
    // The v2 worker's ONNX Runtime build is wasm-only, so the incumbent's undeclared device is wasm; declared devices pass through.
    expect(effectiveBackend(CANDIDATES['v2:base.en'])).toBe('wasm');
    expect(expectedModelIdentity(CANDIDATES['v2:base.en'])).toMatchObject({engine:'private-v2',backend:'wasm'});
    expect(effectiveBackend(CANDIDATES['granite:turboctc-q4f16'])).toBe('webgpu');
    expect(effectiveBackend(CANDIDATES['parakeet:tdt-v3:int8'])).toBe('wasm');
    expect(CANDIDATES['v4:base:q4'].model.device).toBeNull();
    expect(effectiveBackend(CANDIDATES['v4:base:q4'])).toBeNull();
    expect(expectedModelIdentity(CANDIDATES['v4:base:q4']).backend).toBe('');
  });
});
