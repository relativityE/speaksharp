import { readFileSync, readdirSync, existsSync, realpathSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { CANDIDATES, type Candidate } from '../../frontend/src/services/transcription/candidateRegistry';
import { candidateFromPackage, effectiveBackend, expectedModelIdentity, verifyModelPackage } from '../../frontend/src/services/transcription/modelPackage';

export const DEFAULT_CAMPAIGN = 'tests/evidence/fixtures/model-evaluator/product-campaign.json';
export interface ProductCampaign {
    schemaVersion: 1;
    mode: 'product-lifecycle';
    candidates: string[];
    corpus: string;
    maximumTakes: number;
}
export function readCandidateCatalog(root: string, rejected: Array<{file:string;code:string}> = []): Readonly<Record<string, Candidate>> {
    const catalog = { ...CANDIDATES };
    const directory = join(root, 'frontend/src/services/transcription/model-packages');
    if (existsSync(directory)) for (const file of readdirSync(directory).filter(f => f.endsWith('.json')).sort()) {
        const path = join(directory,file);
        try {
            const candidate = candidateFromPackage(JSON.parse(readFileSync(path,'utf8')), relative(root,path));
            if (catalog[candidate.id] && catalog[candidate.id].modelPackage?.digest !== candidate.modelPackage!.digest) throw Error('PACKAGE_DUPLICATE_ID');
            catalog[candidate.id] = candidate;
        } catch (error) { rejected.push({file,code:error instanceof Error && /^[A-Z_]+$/.test(error.message)?error.message:'PACKAGE_INVALID'}); }
    }
    return Object.freeze(catalog);
}
/** One configuration for the actual product journey; no per-arm identity or adapter restatement. */
export function readProductCampaign(root: string, file = DEFAULT_CAMPAIGN) {
    root = realpathSync(root);
    const path = resolve(root,file);
    if (!path.startsWith(root+'/') || realpathSync(path)!==path) throw Error('campaign_outside_source');
    const bytes = readFileSync(path);
    const campaign = JSON.parse(bytes.toString()) as ProductCampaign;
    if (campaign.schemaVersion !== 1 || campaign.mode !== 'product-lifecycle'
        || !Array.isArray(campaign.candidates) || !campaign.candidates.length
        || campaign.candidates.some(id=>typeof id!=='string'||!id.length)
        || new Set(campaign.candidates).size !== campaign.candidates.length
        || typeof campaign.corpus !== 'string' || !Number.isInteger(campaign.maximumTakes)
        || campaign.maximumTakes < 1 || campaign.maximumTakes > 18) throw Error('campaign_invalid');
    const corpusPath = resolve(root,campaign.corpus);
    if (!corpusPath.startsWith(root+'/') || realpathSync(corpusPath)!==corpusPath) throw Error('campaign_corpus_outside_source');
    const corpusBytes = readFileSync(corpusPath);
    const corpus = JSON.parse(corpusBytes.toString()) as {trials:number;clips:Array<{id:string;path:string;wavSha256:string;reference:string}>};
    if (!Number.isInteger(corpus.trials) || corpus.trials < 2 || !Array.isArray(corpus.clips) || !corpus.clips.length
        || corpus.clips.some(c=>!c || typeof c.id!=='string' || !/^[A-Za-z0-9_-]+$/.test(c.id)
            || typeof c.reference!=='string' || typeof c.path!=='string' || !/^[a-f0-9]{64}$/.test(c.wavSha256))
        || new Set(corpus.clips.map(c=>c.id)).size !== corpus.clips.length) throw Error('campaign_population_invalid');
    const takes = campaign.candidates.length * corpus.trials * corpus.clips.length;
    if (takes !== campaign.maximumTakes || takes > 18) throw Error('campaign_take_bound_invalid');
    for(const clip of corpus.clips){const wav=resolve(dirname(corpusPath),clip.path);
        if(!wav.startsWith(root+'/')||realpathSync(wav)!==wav)throw Error('campaign_audio_outside_source');
        if(createHash('sha256').update(readFileSync(wav)).digest('hex')!==clip.wavSha256)throw Error('campaign_audio_hash_mismatch');}
    const catalog = readCandidateCatalog(root);
    const candidates = campaign.candidates.map(id => {
        const c = Object.hasOwn(catalog,id) ? catalog[id] : null;
        if (!c || !c.execution.implemented || !c.browser.ok || !['wasm','webgpu'].includes(effectiveBackend(c)??'')) throw Error('campaign_candidate_unsupported');
        return c;
    });
    return { campaign, candidates, corpus, corpusPath, corpusBytes, takes,
        sha256:createHash('sha256').update(bytes).digest('hex'),
        expectedIdentities:candidates.map(expectedModelIdentity) };
}
export async function verifyCampaignPackages(candidates: readonly Candidate[]) {
    for (const candidate of candidates) if (candidate.modelPackage) await verifyModelPackage(candidate.modelPackage.descriptor);
}
