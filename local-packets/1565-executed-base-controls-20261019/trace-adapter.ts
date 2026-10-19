// Evidence-only lifecycle decorator around the accepted deterministic adapter. Never a model adapter.
import {appendFileSync} from 'node:fs';
import {createAdapter as acceptedFactory} from '../../tests/evidence/fixtures/model-evaluator/offline-control-adapter';
import type {AdapterFactory} from '../../scripts/model-evaluator/adapter';
const resident=new Set<string>();
const record=(arm:string,phase:string)=>appendFileSync('artifacts/pm-1565-adapter-trace.jsonl',JSON.stringify({arm,phase,logicalResident:[...resident]})+'\n');
export const createAdapter:AdapterFactory=context=>{
 const adapter=acceptedFactory(context),arm=String(context.options.arm);
 return {
  async initialize(){const result=await adapter.initialize();resident.add(arm);record(arm,'initialized');return result;},
  async decode(pcm){record(arm,'decode');return adapter.decode(pcm);},
  async finalize(){return adapter.finalize();},
  async dispose(){await adapter.dispose();resident.delete(arm);record(arm,'disposed');},
 };
};
