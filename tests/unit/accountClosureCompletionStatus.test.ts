// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createAccountCompletionStatus } from '../../backend/supabase/functions/_shared/accountClosureCompletionStatus';
import type { CompletionBinding } from '../../backend/supabase/functions/_shared/accountClosureCompletionAdapter';

const binding:CompletionBinding={projectId:'status-test',environment:'production',url:'https://status-test.supabase.co',scopeDigest:'a'.repeat(64)};
const userId='11111111-1111-4111-8111-111111111111',requestId='22222222-2222-4222-8222-222222222222';
const token='f'.repeat(64),held={outcome:'unavailable',canRetry:false};
const request=()=>new Request('https://app.example.test/account',{method:'POST',headers:{Authorization:'Bearer synthetic-verified-by-port'}});
const digest=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');
function fixture(){
  let now=1000;let current:unknown=structuredClone(binding);
  let row:unknown={outcome:'pending',requestId,reason:'save_unsettled',canRetry:false,expiresAt:2000};
  const rpc=vi.fn<(name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:unknown}>>(async(name)=>({data:
    name==='issue_account_completion_status_v1'?{requestId,expiresAt:2000}:
      name==='acknowledge_account_completion_status_v1'?true:structuredClone(row),error:null}));
  const authenticate=vi.fn<(req:Request,url:string)=>Promise<unknown>>(async()=>({data:{user:{id:userId,user_metadata:{id:'untrusted'}}},error:null}));
  const currentBinding=vi.fn(async()=>structuredClone(current));
  const adapter=createAccountCompletionStatus(binding,{createAdminClient:()=>({rpc}),currentBinding,authenticate,now:()=>now});
  return {adapter,rpc,authenticate,currentBinding,setNow:(v:number)=>{now=v;},setBinding:(v:unknown)=>{current=v;},setRow:(v:unknown)=>{row=v;}};
}
beforeEach(()=>{vi.stubGlobal('crypto',webcrypto);});
afterEach(()=>{vi.unstubAllGlobals();});

describe('inactive owner-safe account completion status wrapper',()=>{
  it('issues a server-generated 256-bit secret but sends only its hash and authoritative owner to SQL',async()=>{
    const f=fixture(),req=request();
    const result=await f.adapter.issue(req,{requestId});
    expect(result.outcome).toBe('status_capability');
    if(result.outcome!=='status_capability')throw Error('missing fixture capability');
    expect(result.token).toMatch(/^[a-f0-9]{64}$/);
    expect(f.authenticate).toHaveBeenCalledExactlyOnceWith(req,binding.url);
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith('issue_account_completion_status_v1',{
      p_user_id:userId,p_request_id:requestId,p_scope_digest:binding.scopeDigest,p_token_hash:await digest(result.token),
    });
    expect(JSON.stringify(f.rpc.mock.calls)).not.toContain(result.token);
    expect(result.expiresAt).toBe(2000);
  });
  it.each([null,{},[],{requestId:'bad'},{requestId,userId},{requestId,scopeDigest:binding.scopeDigest}])('rejects invalid or caller-added issue authority %j',async input=>{
    const f=fixture();expect(await f.adapter.issue(request(),input)).toEqual(held);
    expect(f.authenticate).not.toHaveBeenCalled();expect(f.rpc).not.toHaveBeenCalled();
  });
  it('missing authorization does not call Auth or SQL',async()=>{
    const f=fixture();expect(await f.adapter.issue(new Request('https://app.example.test'),{requestId})).toEqual(held);
    expect(f.authenticate).not.toHaveBeenCalled();expect(f.rpc).not.toHaveBeenCalled();
  });
  it.each([null,{data:{user:{id:userId}},error:{message:'private'}},{data:{user:null},error:null},
    {data:{session:{user:{id:userId}},user_metadata:{id:userId}},error:null}])('requires an authoritative getUser result %j',async value=>{
    const f=fixture();f.authenticate.mockResolvedValue(value);
    expect(await f.adapter.issue(request(),{requestId})).toEqual(held);expect(f.rpc).not.toHaveBeenCalled();
  });
  it('rejects ownership/binding drift before capability creation',async()=>{
    const f=fixture();f.authenticate.mockImplementation(async()=>{
      f.setBinding({...binding,scopeDigest:'d'.repeat(64)});return {data:{user:{id:userId}},error:null};
    });
    expect(await f.adapter.issue(request(),{requestId})).toEqual(held);expect(f.rpc).not.toHaveBeenCalled();
  });
  it('discarded issuance receipt never returns the new raw secret after scope drift',async()=>{
    const f=fixture();f.rpc.mockImplementation(async()=>{
      f.setBinding({...binding,url:'https://different.supabase.co'});return {data:{requestId,expiresAt:2000},error:null};
    });
    expect(await f.adapter.issue(request(),{requestId})).toEqual(held);expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([null,{requestId,expiresAt:1000},{requestId,expiresAt:NaN},{requestId,expiresAt:901001},
    {requestId,expiresAt:2000,extra:true}])('rejects unbound or expired issuance receipts %j',async value=>{
    const f=fixture();f.rpc.mockResolvedValue({data:value,error:null});expect(await f.adapter.issue(request(),{requestId})).toEqual(held);
  });
  it('acknowledgment requires live Auth and an exact deadline-bearing status readback',async()=>{
    const f=fixture();expect(await f.adapter.acknowledge(request(),{requestId,token})).toEqual({outcome:'status_acknowledged',requestId});
    expect(f.rpc.mock.calls.map(([name])=>name)).toEqual(['acknowledge_account_completion_status_v1','read_account_completion_status_v1']);
    expect(f.rpc.mock.calls[0][1]).toEqual({p_user_id:userId,p_request_id:requestId,p_scope_digest:binding.scopeDigest,p_token_hash:await digest(token)});
    expect(JSON.stringify(f.rpc.mock.calls)).not.toContain(token);
  });
  it('an acknowledgment delayed past expiry is unavailable and never retries or renews it',async()=>{
    const f=fixture();f.rpc.mockImplementation(async(name)=>{
      if(name==='acknowledge_account_completion_status_v1'){f.setNow(2000);return {data:true,error:null};}
      return {data:{outcome:'pending',requestId,reason:'ready',canRetry:false,expiresAt:2000},error:null};
    });
    expect(await f.adapter.acknowledge(request(),{requestId,token})).toEqual(held);
    expect(f.rpc.mock.calls.map(([name])=>name)).toEqual(['acknowledge_account_completion_status_v1','read_account_completion_status_v1']);
  });
  it.each([
    {outcome:'pending',requestId,reason:'coverage_unverified',canRetry:false},
    {outcome:'pending',requestId,reason:'checkout_unsettled',canRetry:false},
    {outcome:'pending',requestId,reason:'save_unsettled',canRetry:false},
    {outcome:'pending',requestId,reason:'coaching_unsettled',canRetry:false},
    {outcome:'pending',requestId,reason:'ready',canRetry:false},
    {outcome:'processing',requestId,canRetry:false},
    ...['auth_unknown','operation_unknown','execution_expired','identity_unverified','completion_unverified'].map(reason=>({outcome:'verification_pending',requestId,reason,canRetry:false})),
    {outcome:'completed',requestId,accountDeleted:true,canRetry:false},
  ])('reads the closed status %j without requiring a JWT after Auth deletion',async row=>{
    const f=fixture();f.setRow({...row,expiresAt:2000});expect(await f.adapter.read({requestId,token})).toEqual(row);
    expect(f.authenticate).not.toHaveBeenCalled();expect(f.rpc).toHaveBeenCalledTimes(1);
    expect(f.rpc.mock.calls[0][0]).toBe('read_account_completion_status_v1');
  });
  it.each([null,{outcome:'completed',requestId,accountDeleted:false,canRetry:false,expiresAt:2000},
    {outcome:'pending',requestId,reason:'invented',canRetry:false,expiresAt:2000},
    {outcome:'completed',requestId,accountDeleted:true,canRetry:true,expiresAt:2000},
    {outcome:'processing',requestId:userId,canRetry:false,expiresAt:2000},
    {outcome:'processing',requestId,canRetry:false,expiresAt:2000,userId},
    {outcome:'processing',requestId,canRetry:false,expiresAt:NaN},
    {outcome:'processing',requestId,canRetry:false,expiresAt:1000}])('ambiguous or extra-field status %j remains unavailable',async row=>{
    const f=fixture();f.setRow(row);expect(await f.adapter.read({requestId,token})).toEqual(held);
  });
  it('a read response that expires during an RPC wait cannot authorize the returned status',async()=>{
    const f=fixture();f.rpc.mockImplementation(async()=>{f.setNow(2000);return {data:{outcome:'processing',requestId,canRetry:false,expiresAt:2000},error:null};});
    expect(await f.adapter.read({requestId,token})).toEqual(held);expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([{}, {requestId}, {requestId,token:'bad'}, {requestId,token,userId}, {requestId,token,scopeDigest:binding.scopeDigest}])('a request ID alone or caller-added authority %j never reads SQL',async input=>{
    const f=fixture();expect(await f.adapter.read(input)).toEqual(held);expect(f.rpc).not.toHaveBeenCalled();
  });
  it('transport rejection is sanitized without a retry or an effect RPC',async()=>{
    const f=fixture();f.rpc.mockRejectedValue(new Error('private provider detail owner@example.test'));
    expect(await f.adapter.read({requestId,token})).toEqual(held);expect(f.rpc).toHaveBeenCalledTimes(1);
  });
});
