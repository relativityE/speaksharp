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

describe('J1.f/J7.d step 6: owner- and request-bound execution readiness decision', () => {
  const ready = { outcome: 'pending', requestId, reason: 'ready', canRetry: false, expiresAt: 900_000 };
  const names = (f: ReturnType<typeof fixture>) => f.rpc.mock.calls.map(([name]) => name);
  it('the valid case: live owner, held acknowledged capability, pending/ready twice -> a short decision, no token', async () => {
    const f = fixture(); f.setRow(ready);
    const result = await f.adapter.readiness(request(), { requestId, token });
    expect(result).toEqual({ outcome: 'execution_ready', requestId, expiresAt: 1000 + 60_000 });
    expect(JSON.stringify(result)).not.toContain(token);
    // Read first, owner binding second, read again: never issue, never anything else.
    expect(names(f)).toEqual(['read_account_completion_status_v1', 'acknowledge_account_completion_status_v1',
      'read_account_completion_status_v1']);
    expect(f.rpc).toHaveBeenCalledWith('acknowledge_account_completion_status_v1', {
      p_user_id: userId, p_request_id: requestId, p_scope_digest: binding.scopeDigest, p_token_hash: await digest(token) });
    expect(JSON.stringify(f.rpc.mock.calls)).not.toContain(token);
  });
  it('never outlives the capability it was decided on', async () => {
    const f = fixture(); f.setRow({ ...ready, expiresAt: 5000 });
    expect(await f.adapter.readiness(request(), { requestId, token })).toEqual({ outcome: 'execution_ready', requestId, expiresAt: 5000 });
  });
  it.each(['coverage_unverified', 'checkout_unsettled', 'save_unsettled', 'coaching_unsettled'])('pending/%s is not ready', async (reason) => {
    const f = fixture(); f.setRow({ ...ready, reason });
    expect(await f.adapter.readiness(request(), { requestId, token })).toEqual(held);
    expect(names(f)).toEqual(['read_account_completion_status_v1']); // decided before any owner-binding call
  });
  it('off or unbound (SQL answers NULL) is unavailable', async () => {
    const f = fixture(); f.setRow(null);
    expect(await f.adapter.readiness(request(), { requestId, token })).toEqual(held);
  });
  it('an unacknowledged or expired capability (read answers NULL) is never acknowledged as a side effect', async () => {
    const f = fixture(); f.setRow(null);
    await f.adapter.readiness(request(), { requestId, token });
    expect(names(f)).not.toContain('acknowledge_account_completion_status_v1');
    expect(names(f)).not.toContain('issue_account_completion_status_v1');
  });
  it('wrong owner: the owner binding is refused for this token', async () => {
    const f = fixture(); f.setRow(ready);
    f.rpc.mockImplementation(async (name) => ({ data: name === 'acknowledge_account_completion_status_v1' ? false : structuredClone(ready), error: null }));
    expect(await f.adapter.readiness(request(), { requestId, token })).toEqual(held);
  });
  it('wrong request: a reply for another request is unavailable', async () => {
    const f = fixture(); f.setRow({ ...ready, requestId: '33333333-3333-4333-8333-333333333333' });
    expect(await f.adapter.readiness(request(), { requestId, token })).toEqual(held);
  });
  it.each([
    ['revoked (NULL)', null],
    ['no longer ready (a valid, unexpired pending/save_unsettled reply)', { ...ready, reason: 'save_unsettled' }],
    ['now processing (valid reply)', { outcome: 'processing', requestId, canRetry: false, expiresAt: 900_000 }],
  ])('a change between the two reads is unavailable: %s', async (_label, second) => {
    const f = fixture(); f.setRow(ready); let reads = 0;
    f.rpc.mockImplementation(async (name) => ({ data: name === 'acknowledge_account_completion_status_v1' ? true
      : (++reads === 1 ? structuredClone(ready) : structuredClone(second)), error: null }));
    expect(await f.adapter.readiness(request(), { requestId, token })).toEqual(held);
  });
  it('an expired deadline in the reply is unavailable', async () => {
    const f = fixture(); f.setRow({ ...ready, expiresAt: 900 });
    expect(await f.adapter.readiness(request(), { requestId, token })).toEqual(held);
  });
  it('scope drift during the decision is unavailable', async () => {
    const f = fixture(); f.setRow(ready); let reads = 0;
    f.rpc.mockImplementation(async (name) => {
      if (name === 'read_account_completion_status_v1' && ++reads === 2) f.setBinding({ ...binding, scopeDigest: 'd'.repeat(64) });
      return { data: name === 'acknowledge_account_completion_status_v1' ? true : structuredClone(ready), error: null };
    });
    expect(await f.adapter.readiness(request(), { requestId, token })).toEqual(held);
  });
  it.each([null, {}, { requestId }, { requestId, token: 'short' }, { requestId, token, userId }])('rejects malformed input %j without Auth or SQL', async (input) => {
    const f = fixture();
    expect(await f.adapter.readiness(request(), input)).toEqual(held);
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it('requires a live owner: missing authorization or a failed getUser calls no SQL', async () => {
    const f = fixture(); f.setRow(ready);
    expect(await f.adapter.readiness(new Request('https://app.example.test'), { requestId, token })).toEqual(held);
    f.authenticate.mockResolvedValue({ data: { user: null }, error: null });
    expect(await f.adapter.readiness(request(), { requestId, token })).toEqual(held);
    expect(f.rpc).not.toHaveBeenCalled();
  });
});
