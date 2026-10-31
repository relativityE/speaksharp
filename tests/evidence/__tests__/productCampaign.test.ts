import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, webcrypto } from 'node:crypto';
import { CANDIDATES } from '../../../frontend/src/services/transcription/candidateRegistry';
import { sealModelPackage } from '../../../frontend/src/services/transcription/modelPackage';
import { readProductCampaign, verifyCampaignPackages, readCandidateCatalog } from '../../../scripts/model-evaluator/product-campaign';
describe('configuration-only product campaign',()=>{
  it('loads a fourth compatible JSON package, derives all four arms and refuses changed inputs/bounds',async()=>{
    vi.stubGlobal('crypto',webcrypto);
    const root=mkdtempSync(join(tmpdir(),'model-campaign-'));
    try{
      const dir=join(root,'frontend/src/services/transcription/model-packages');mkdirSync(dir,{recursive:true});
      const base=CANDIDATES['v2:base.en'];
      const pkg=await sealModelPackage({schemaVersion:1,kind:'speaksharp-model-package',id:'fourth:whisper',engine:base.engine,
        execution:base.execution,runtime:base.runtime,model:base.model,license:'fixture only',assets:{servedFrom:base.assets.servedFrom,
          files:base.assets.files!.map(f=>({...f,url:base.assets.servedFrom+'/'+f.path}))}});
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
      const rejected:Array<{file:string;code:string}>=[];
      expect(readCandidateCatalog(root,rejected)['v2:base.en'].id).toBe('v2:base.en');expect(rejected).toEqual([{file:'invalid.json',code:'PACKAGE_INVALID'}]);
      writeFileSync(join(root,'campaign.json'),JSON.stringify({...campaign,maximumTakes:19}));
      expect(()=>readProductCampaign(root,'campaign.json')).toThrow('campaign_invalid');
      writeFileSync(join(root,'campaign.json'),JSON.stringify(campaign));writeFileSync(join(root,'audio.wav'),'changed');
      expect(()=>readProductCampaign(root,'campaign.json')).toThrow('campaign_audio_hash_mismatch');
    }finally{rmSync(root,{recursive:true,force:true});vi.unstubAllGlobals();}
  });
});
