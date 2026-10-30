// Whole retained CLI command with explicit offline adapters, no browser/model.
import { it,expect } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { resolve,join,relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { decodeWav16kMono } from '../../../scripts/model-evaluator/wav';

function runControl(options:Record<string,unknown>={}){
  const outputRoot=resolve('test-results');mkdirSync(outputRoot,{recursive:true});
  const directory=mkdtempSync(join(outputRoot,'paired-command-'));
  try{
    const wav=Buffer.alloc(44+640);
    wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVE',8);
    wav.write('fmt ',12);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
    wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);
    wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);writeFileSync(join(directory,'control.wav'),wav);
    const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
    const pcm=decodeWav16kMono(wav);const pcmHash=sha(Buffer.from(pcm.buffer,pcm.byteOffset,pcm.byteLength));
    const identity={engine:'offline-control',modelId:'no-model',revision:null,assetDigest:'a'.repeat(64),runtime:'deterministic-test-double',backend:'wasm'};
    const adapterModule='./tests/evidence/fixtures/model-evaluator/offline-control-adapter.ts';
    const files={
      baseline:{version:1,identity,adapterModule},
      candidate:{version:1,identity,adapterModule,adapterOptions:options},
      corpus:{version:1,trials:2,clips:['a','b'].map(id=>({id,clusterId:`synthetic-${id}`,reference:'hello world',slices:['control'],path:'control.wav',wavSha256:sha(wav),sha256:pcmHash}))},
      device:{version:1,baseUrl:'http://unused.invalid',label:'offline command control',backend:'wasm'},
    };
    const args=['--import','tsx','scripts/model-evaluator/run.mts'];
    for(const [name,value]of Object.entries(files)){
      const path=join(directory,`${name}.json`);writeFileSync(path,JSON.stringify(value));args.push(`--${name}`,relative(process.cwd(),path));
    }
    const out=join(directory,'report.json');args.push('--out',out);
    const result=spawnSync(process.execPath,args,{cwd:process.cwd(),encoding:'utf8',timeout:20_000,maxBuffer:1024*1024});
    expect(result.error).toBeUndefined();
    const report=JSON.parse(readFileSync(out,'utf8'));
    return {status:result.status,report};
  }finally{rmSync(directory,{recursive:true,force:true});}
}
it('retained CLI consumes independent declared pairs and writes raw rows/observed identities with honest HOLD',()=>{
  const {status,report}=runControl();expect(status).toBe(2);
  expect(report.pairedEvidence).toMatchObject({status:'COMPLETE',expectedRows:4,validatedPairs:4});
  expect(report.declaredPopulation.trials).toBe(2);
  expect(report.baseline.results).toHaveLength(4);expect(report.candidate.results).toHaveLength(4);
  expect(report.candidate.observed.runtime).toBe('deterministic-test-double');
  expect(report.candidate.results[0].score).toMatchObject({ok:true,path:'corpus',row:{wer:0}});
  expect(report.adapterExecutionEvidence).toEqual({baseline:null,candidate:null});
  expect(report.acceptance.verdict).toBe('HOLD');expect(report.productPath).toBe('NOT_RUN');
},25_000);
it('retained CLI fails when successful decoding is followed by rejected shutdown',()=>{
  const {status,report}=runControl({disposeFailure:true});
  expect(report.candidate.results.every((row:{transcript:string|null})=>row.transcript==='hello world')).toBe(true);
  expect(report.pairedEvidence.status).toBe('COMPLETE');
  expect(report.acceptance).toMatchObject({verdict:'FAIL'});
  expect(report.acceptance.reasons).toContain('adapter_execution_or_retirement_failed');
  expect(status).toBe(1);
},25_000);
it('retained CLI keeps every decode failure and rejected disposal in the immutable report',()=>{
  const {report}=runControl({decodeFailure:true,disposeFailure:true});
  expect(report.candidate.results).toHaveLength(4);
  expect(report.candidate.results.every((row:{error?:string;transcript:string|null})=>row.transcript===null&&row.error?.includes('offline_decode_failure'))).toBe(true);
  expect(report.inputFailures.some((failure:string)=>failure.includes('candidate_dispose:Error: offline_dispose_failure'))).toBe(true);
  expect(report.pairedEvidence.status).toBe('COMPLETE');
  expect(report.acceptance.verdict).not.toBe('PASS');
},25_000);
it('retained CLI preserves wrong observed runtime identity rather than replacing it with the manifest',()=>{
  const {status,report}=runControl({observedBackend:'cpu'});expect(status).toBe(1);
  expect(report.candidate.observed.backend).toBe('cpu');expect(report.candidate.manifest.backend).toBe('wasm');
  expect(report.comparison.reasons).toContain('candidate_identity_mismatch_or_fallback');
},25_000);
