import {expect,it} from 'vitest';
import type {Response} from 'playwright';
import {observeCompletedSave} from './completionObservation';
const api='https://api.example.invalid';
const payload={p_status:'completed',p_session_id:'11111111-1111-4111-8111-111111111111',p_final_transcript:'synthetic actual final'};
const retained={success:true,session_saved:true,final_status:'completed',transcript_outcome:'retained'};
function response(body:Record<string,unknown>=payload,result:Record<string,unknown>=retained){return {
  ok:()=>true,url:()=>api+'/rest/v1/rpc/complete_session_v2',request:()=>({method:()=> 'POST',postDataJSON:()=>body}),json:async()=>result,
} as unknown as Response;}
it('uses actual RPC content without requiring the non-shipping selectedForSave diagnostic',async()=>{
  const lengthOnlyDiagnostics={selectedForSaveLength:payload.p_final_transcript.length};
  expect('selectedForSave' in lengthOnlyDiagnostics).toBe(false);
  expect(await observeCompletedSave(response(),api)).toEqual({sessionId:payload.p_session_id,transcript:payload.p_final_transcript});
});
it.each([{...payload,p_final_transcript:undefined},{...payload,p_status:'failed'},{...payload,p_session_id:'other'}])('rejects invalid completion content without exposing it',async body=>{
  await expect(observeCompletedSave(response(body),api)).rejects.toThrow('completion_not_durably_retained');
});
it.each(['expired','not_captured','not_provided'])('rejects a successful HTTP response with %s outcome',async transcript_outcome=>{
  await expect(observeCompletedSave(response(payload,{...retained,transcript_outcome}),api)).rejects.toThrow('completion_not_durably_retained');
});
