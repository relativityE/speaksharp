import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { CANDIDATES } from '../../../frontend/src/services/transcription/candidateRegistry';
import { candidateFromPackage, effectiveBackend, parseModelPackage, sealModelPackage, verifyModelPackage, expectedModelIdentity, productModelMetadata, type ModelPackage } from '../../../frontend/src/services/transcription/modelPackage';

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
  it('a preparation budget is bounded package data, and the large pinned-asset adapters must declare one',async()=>{
    // Parse order puts the budget check before the profile/asset checks, so the registered candidates' own descriptors suffice here.
    const shaped=(id:string,execution:Record<string,unknown>)=>{const c=CANDIDATES[id];
      return {schemaVersion:1,kind:'speaksharp-model-package',id:'imported:'+c.engine,packageDigest:'a'.repeat(64),assetDigest:'b'.repeat(64),
        engine:c.engine,runtime:c.runtime,model:c.model,execution,assets:{files:[]},license:'fixture'};};
    for(const id of ['granite:turboctc-q4f16','parakeet:tdt-v3:int8']){
      const {preparationBudgetMs,...withoutBudget}=CANDIDATES[id].execution;
      expect(preparationBudgetMs,`${id} carries its budget as data`).toBeGreaterThan(5000);
      expect(()=>parseModelPackage(shaped(id,withoutBudget))).toThrow('PACKAGE_PREPARATION_BUDGET_MISSING');
      for(const bad of [4_999,600_001,120_000.5,'120000',Number.NaN])
        expect(()=>parseModelPackage(shaped(id,{...withoutBudget,preparationBudgetMs:bad}))).toThrow('PACKAGE_PREPARATION_BUDGET_INVALID');
    }
    // A Whisper package may omit it (service default) or declare an in-range value; the declared value is sealed into the digest.
    const pkg=await fourthPackage();expect(pkg.execution.preparationBudgetMs).toBeUndefined();
    // Re-seal from the UNSEALED body: a sealed package's own digests are derived fields, never inputs.
    const unsealed=structuredClone(pkg) as Partial<ModelPackage>;delete unsealed.packageDigest;delete unsealed.assetDigest;
    const declared=await sealModelPackage({...unsealed,execution:{...pkg.execution,preparationBudgetMs:30_000}} as Parameters<typeof sealModelPackage>[0]);
    expect(candidateFromPackage(declared,'fourth.json').execution.preparationBudgetMs).toBe(30_000);
    const raised=structuredClone(declared);raised.execution.preparationBudgetMs=600_000;
    await expect(verifyModelPackage(raised)).rejects.toThrow('PACKAGE_DIGEST_MISMATCH');
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

describe('independent review of 27607fb3: admission applies the adapters\' own file rules', () => {
  const granite = CANDIDATES['granite:turboctc-q4f16'];
  const granitePackage = (change: (decode: Record<string, unknown>, files: Array<Record<string, unknown>>) => void = () => {}) => {
    const decode = { ...(granite.execution.decode as unknown as Record<string, unknown>) };
    const files = granite.assets.files!.map(f => ({ ...f })) as Array<Record<string, unknown>>;
    change(decode, files);
    return sealModelPackage({ schemaVersion: 1, kind: 'speaksharp-model-package', id: 'fixture:granite-files', engine: granite.engine,
      runtime: granite.runtime, model: granite.model, execution: { ...granite.execution, decode } as never,
      assets: { files } as never, license: 'fixture declaration; no model copied' } as never);
  };
  it('CONTROL: the built-in Granite file set is admitted', async () => {
    expect(candidateFromPackage(await granitePackage(), 'fixture.json').engine).toBe('granite-ctc');
  });
  it.each([
    ['a model file the package does not ship', (d: Record<string, unknown>) => { d.modelFile = 'does-not-exist.onnx'; }],
    ['the model\'s external data missing', (_d: Record<string, unknown>, f: Array<Record<string, unknown>>) => { f.splice(f.findIndex(x => String(x.path).endsWith('.onnx.data')), 1); }],
    ['the frontend configuration missing', (_d: Record<string, unknown>, f: Array<Record<string, unknown>>) => { f.splice(f.findIndex(x => String(x.path).endsWith('frontend_config.json')), 1); }],
    ['the vocabulary missing', (_d: Record<string, unknown>, f: Array<Record<string, unknown>>) => { f.splice(f.findIndex(x => String(x.path).endsWith('/vocab.json')), 1); }],
    ['two files with the same basename', (_d: Record<string, unknown>, f: Array<Record<string, unknown>>) => {
      const vocab = f.find(x => String(x.path).endsWith('/vocab.json'))!;
      f.push({ ...vocab, path: 'extra/vocab.json', url: String(vocab.url).replace(/vocab\.json$/, 'extra/vocab.json') });
    }],
  ])('Granite: REFUSED at admission instead of failing after the consented download: %s', async (_label, change) => {
    await expect(granitePackage(change)).rejects.toThrow('UNSUPPORTED_GRANITE_ASSETS');
  });
  it.each([['/models/../../index.html'], ['/models/x/%2e%2e/index.html'], ['/models/./x.onnx']])(
    'a local asset URL with a dot segment is refused (the URL constructor had already removed it): %s', async (bad) => {
      await expect(granitePackage((_d, f) => { f[0].url = bad; })).rejects.toThrow('PACKAGE_ASSET_LOCATION_INVALID');
    });
});
