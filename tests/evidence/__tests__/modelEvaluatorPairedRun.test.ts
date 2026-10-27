import { describe,expect,it } from 'vitest';
import { freezePairedRunPlan,plannedSample,evaluatePairedRun } from '../../../scripts/model-evaluator/paired-run';
import type { CorpusClip,ModelArm,ModelIdentity } from '../modelEvaluator';
import { countFillerWords } from '../../../frontend/src/utils/fillerWordUtils';
import { normalizeOfficialTrackA } from '../normalization/officialNormalizer';

const identity:ModelIdentity={engine:'offline-control',modelId:'control',revision:null,assetDigest:'a'.repeat(64),runtime:'offline',backend:'wasm'};
const corpus:CorpusClip[]=[
  {id:'a:0',clusterId:'speaker-a',sha256:'1'.repeat(64),reference:'hello world',slices:['clear']},
  {id:'b',clusterId:'speaker-b',sha256:'2'.repeat(64),reference:'um useful words',slices:['filler']},
];
function arms(clips=corpus) {
  const plan=freezePairedRunPlan(clips,2);
  const arm=():ModelArm=>({manifest:identity,observed:{...identity},results:clips.flatMap(clip=>[0,1].map(trial=>({
    clipId:clip.id,trial,transcript:clip.reference,inputSha256:clip.sha256,finalLatencyMs:10,
    evidence:plannedSample(plan,clip.id,trial),
  })))});
  return {plan,a:arm(),b:arm()};
}
describe('#1565 retained runner paired-population integration',()=>{
  it('uses independent frozen corpus × declared trials, not the intersection of observed arms',()=>{
    const {plan,a,b}=arms();
    a.results=a.results.filter(row=>row.clipId!=='b');b.results=b.results.filter(row=>row.clipId!=='b');
    const report=evaluatePairedRun(plan,corpus,a,b,null);
    expect(report.pairedEvidence.status).toBe('INVALID');
    expect(report.pairedEvidence.expectedRows).toBe(4);
    expect(report.pairedEvidence.error).toContain('sample_set_mismatch');
    expect(report.comparison).toBeNull();
  });
  it('freezes the declared population before execution and rejects mutated references',()=>{
    const clips=corpus.map(clip=>({...clip}));const {plan,a,b}=arms(clips);
    expect(Object.isFrozen(plan.expected)).toBe(true);
    expect(Object.isFrozen(plan.expected[0])).toBe(true);
    clips[0].reference='changed after measurement';
    expect(evaluatePairedRun(plan,clips,a,b,null).pairedEvidence.status).toBe('INVALID');
  });
  it('rejects an entire declared trial omitted identically from both arms',()=>{
    const {plan,a,b}=arms();a.results=a.results.filter(row=>row.trial===0);b.results=b.results.filter(row=>row.trial===0);
    const report=evaluatePairedRun(plan,corpus,a,b,null);
    expect(report.pairedEvidence.expectedRows).toBe(4);
    expect(report.pairedEvidence.status).toBe('INVALID');expect(report.comparison).toBeNull();
    expect(plan.trials).toBe(2);
  });
  it('retains failed trials and actual observed identity without replacing them from declarations',()=>{
    const {plan,a,b}=arms();
    b.observed={...identity,backend:'observed-other'};
    b.results[0]={...b.results[0],transcript:null,error:'offline injected decode rejection',finalLatencyMs:null};
    const failed=b.results[0];
    const report=evaluatePairedRun(plan,corpus,a,b,null);
    expect(report.pairedEvidence.status).toBe('COMPLETE');
    expect(report.comparison?.reasons).toContain('candidate_identity_mismatch_or_fallback');
    expect(report.comparison?.reasons).toContain('candidate_decode_error:a:0:0');
    expect(b.results).toHaveLength(4);expect(b.results[0]).toBe(failed);
    expect(b.observed.backend).toBe('observed-other');
  });
  it('rejects mismatched, duplicate and absent result identity before statistics',()=>{
    for(const mutation of ['ref','trial','duplicate','absent']){
      const {plan,a,b}=arms();
      if(mutation==='ref')b.results[0].evidence={...b.results[0].evidence!,referenceSha256:'f'.repeat(64)};
      if(mutation==='trial')b.results[0].trial=1;
      if(mutation==='duplicate')b.results[1]={...b.results[0]};
      if(mutation==='absent')delete b.results[0].evidence;
      expect(evaluatePairedRun(plan,corpus,a,b,null).comparison).toBeNull();
    }
  });
  it('preserves declared empty-reference rows; completeness alone grants no silence-quality PASS',()=>{
    const clips=[{...corpus[0],reference:''}];const {plan,a,b}=arms(clips);
    expect(plan.expected[0].referenceWords).toBe(0);
    expect(evaluatePairedRun(plan,clips,a,b,null).pairedEvidence.status).toBe('COMPLETE');
    expect(evaluatePairedRun(plan,clips,a,b,null).comparison?.verdict).not.toBe('PASS');
    expect(a.results).toHaveLength(2);
  });
  it('requires declared trial count independently of policy or available outputs',()=>{
    for(const count of [undefined,NaN,0,1,2.5])expect(()=>freezePairedRunPlan(corpus,count as number)).toThrow();
    expect(()=>freezePairedRunPlan([...corpus,corpus[0]],2)).toThrow('duplicate');
  });
  it('counts raw coachable fillers before WER normalization and keeps all-key counts separate',()=>{
    const reference='So um I think uh we should um review the plan today';
    const raw=countFillerWords(reference);
    expect(raw.total.count).toBe(3);expect(raw.um.count).toBe(2);expect(raw.uh.count).toBe(1);expect(raw.so.count).toBe(1);
    const observed=countFillerWords('So I think we should review the plan today');
    expect(observed.total.count).toBe(0);expect(observed.so.count).toBe(1);
    expect(normalizeOfficialTrackA(reference)).not.toContain('um');
    expect(normalizeOfficialTrackA(reference)).not.toContain('uh');
    expect(countFillerWords(normalizeOfficialTrackA(reference).join(' ')).total.count).toBe(0);
    // This string control does not establish audible fillers in the TTS fixture.
  });
});
