import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, webcrypto } from 'node:crypto';
import { CANDIDATES } from '../../../frontend/src/services/transcription/candidateRegistry';
import { sealModelPackage } from '../../../frontend/src/services/transcription/modelPackage';
import { readProductCampaign, verifyCampaignPackages, readCandidateCatalog } from '../../../scripts/model-evaluator/product-campaign';
import { caseMs, registerPackageCaseLimits } from '../../model-dropin/comparisonBounds';
describe('independent re-review of 2cc05908 (N1): the evaluator catalogue admits exactly what the product admits',()=>{
  it('a copy of the incumbent (same cache directory) is refused by the campaign catalogue, as the bundle refuses it',async()=>{
    vi.stubGlobal('crypto',webcrypto);
    const root=mkdtempSync(join(tmpdir(),'model-campaign-collision-'));
    try{
      const dir=join(root,'frontend/src/services/transcription/model-packages');mkdirSync(dir,{recursive:true});
      const base=CANDIDATES['v2:base.en'];
      const copy=await sealModelPackage({schemaVersion:1,kind:'speaksharp-model-package',id:'fixture:copy-incumbent',engine:base.engine,
        execution:base.execution,runtime:base.runtime,model:{...base.model,device:'wasm'},license:'fixture only',assets:{servedFrom:base.assets.servedFrom,
          files:base.assets.files!.map(f=>({...f,url:base.assets.servedFrom+'/'+f.path}))}});
      writeFileSync(join(dir,'copy.json'),JSON.stringify(copy));
      const rejected:Array<{file:string;code:string}>=[];
      const catalog=readCandidateCatalog(root,rejected);
      expect(rejected).toEqual([{file:'copy.json',code:'PACKAGE_IDENTITY_COLLISION'}]);
      expect(Object.hasOwn(catalog,'fixture:copy-incumbent')).toBe(false);
    }finally{rmSync(root,{recursive:true,force:true});vi.unstubAllGlobals();}
  });
});

describe('configuration-only product campaign',()=>{
  it('loads a fourth compatible JSON package, derives all four arms and refuses changed inputs/bounds',async()=>{
    vi.stubGlobal('crypto',webcrypto);
    const root=mkdtempSync(join(tmpdir(),'model-campaign-'));
    try{
      const dir=join(root,'frontend/src/services/transcription/model-packages');mkdirSync(dir,{recursive:true});
      const base=CANDIDATES['v2:base.en'];
      // Its own cache directory: a package reusing the incumbent's localModelId is refused by the product (and so here).
      const pkg=await sealModelPackage({schemaVersion:1,kind:'speaksharp-model-package',id:'fourth:whisper',engine:base.engine,
        execution:{...base.execution,localModelId:'fourth-whisper'},runtime:base.runtime,model:{...base.model,device:'wasm'},license:'fixture only',assets:{servedFrom:'/models/fourth-whisper',
          files:base.assets.files!.map(f=>({...f,url:'/models/fourth-whisper/'+f.path}))}});
      writeFileSync(join(dir,'fourth.json'),JSON.stringify(pkg));
      writeFileSync(join(dir,'invalid.json'),'{bad json');
      writeFileSync(join(root,'audio.wav'),'fixture bytes');
      const hash=createHash('sha256').update('fixture bytes').digest('hex');
      const corpus={trials:2,clips:[{id:'clip',path:'audio.wav',wavSha256:hash,reference:'a reference'}]};
      writeFileSync(join(root,'corpus.json'),JSON.stringify(corpus));
      const campaign={schemaVersion:1,mode:'product-lifecycle',candidates:['v2:base.en','parakeet:tdt-v3:int8','granite:turboctc-q4f16',pkg.id],corpus:'corpus.json',maximumTakes:8};
      writeFileSync(join(root,'campaign.json'),JSON.stringify(campaign));
      const result=readProductCampaign(root,'campaign.json');await verifyCampaignPackages(result.candidates);
      expect(result.takes).toBe(8);expect(result.candidates[3].modelPackage?.digest).toBe(pkg.packageDigest);
      expect(result.expectedIdentities[3]).toMatchObject({assetDigest:pkg.assetDigest,backend:'wasm'});
      // Codex P2 on 73cf517b: every admitted arm, the imported package included, gets a bounded case limit before any take.
      registerPackageCaseLimits(result.candidates);
      expect(result.candidates.map(c=>caseMs(c.id))).toEqual([420_000,1_110_000,420_000,420_000]);
      const rejected:Array<{file:string;code:string}>=[];
      expect(readCandidateCatalog(root,rejected)['v2:base.en'].id).toBe('v2:base.en');expect(rejected).toEqual([{file:'invalid.json',code:'PACKAGE_INVALID'}]);
      writeFileSync(join(root,'campaign.json'),JSON.stringify({...campaign,maximumTakes:19}));
      expect(()=>readProductCampaign(root,'campaign.json')).toThrow('campaign_invalid');
      writeFileSync(join(root,'campaign.json'),JSON.stringify(campaign));writeFileSync(join(root,'audio.wav'),'changed');
      expect(()=>readProductCampaign(root,'campaign.json')).toThrow('campaign_audio_hash_mismatch');
      writeFileSync(join(root,'audio.wav'),'fixture bytes');
      writeFileSync(join(root,'campaign.json'),JSON.stringify({...campaign,candidates:['v2:base.en','v4:base:q4'],maximumTakes:4}));
      expect(()=>readProductCampaign(root,'campaign.json')).toThrow('campaign_candidate_unsupported');
    }finally{rmSync(root,{recursive:true,force:true});vi.unstubAllGlobals();}
  });
});

describe('committed campaigns read through the real reader from this checkout', () => {
  const repo = join(__dirname, '..', '..', '..');
  it('the full three-model campaign is 18 takes', () => {
    const r = readProductCampaign(repo, 'tests/evidence/fixtures/model-evaluator/product-campaign.json');
    expect([r.takes, r.candidates.map(c => c.id)]).toEqual([18, ['v2:base.en', 'parakeet:tdt-v3:int8', 'granite:turboctc-q4f16']]);
  });
  it('the first paired milestone is incumbent then Parakeet on fixture-001 only: 3 trials, 6 takes, no Granite before the pair', () => {
    const r = readProductCampaign(repo, 'tests/evidence/fixtures/model-evaluator/product-campaign.parakeet-fixture-001.json');
    expect(r.takes).toBe(6);
    expect(r.candidates.map(c => c.id)).toEqual(['v2:base.en', 'parakeet:tdt-v3:int8']);
    expect(r.corpus.clips.map(c => c.id)).toEqual(['fixture-001']);
    expect(r.corpus.trials).toBe(3);
  });
});
