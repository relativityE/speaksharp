import { describe, expect, it } from 'vitest';
import { ComparisonBudget, LIMITS, MODELS, validateApproval, requireCompatibleBackend, elapsedMs, privateTimingMetrics, canonicalCaseReceipts, type ExecutionApproval } from './comparisonBounds';
const user = '11111111-1111-4111-8111-111111111111';
const session = '22222222-2222-4222-8222-222222222222';
const recording = '33333333-3333-4333-8333-333333333333';
const lease = '44444444-4444-4444-8444-444444444444';
const api = 'https://api.example.invalid';
const now = Date.parse('2026-10-30T23:00:00Z');
export function approval(): ExecutionApproval {
  return { schemaVersion: 1, decision: 'APPROVED', runId: 'synthetic-control', sourceHead: 'a'.repeat(40),
    sourceDeltaSha256: 'b'.repeat(64), sourceUntrackedSha256: 'c'.repeat(64), driverSha256: 'd'.repeat(64), assetReceiptSha256: 'e'.repeat(64), backendContractSha256:'f'.repeat(64),
    campaignSha256:'1'.repeat(64), appOrigin: 'http://127.0.0.1:5174', apiOrigin: api, expectedUserId: user, accountReference: 'synthetic-fixture',
    expiresAt: new Date(now + LIMITS.wholeRunMs).toISOString(), takes: 18,
    retention: 'EMPTY_EXISTING_TEST_ACCOUNT_NORMAL_NEWEST_ONE', maxApiRequests: 3240, maxMutations: 2160, wholeRunMs: 7680000 };
}
function create() { const budget = new ComparisonBudget(approval(), () => now); budget.beginTake(); return budget; }
function post(b: ComparisonBudget, endpoint: string, body: unknown = {}) {
  b.admit({ url: api + endpoint, method: 'POST', body });
}
function register(b: ComparisonBudget) {
  post(b, '/rest/v1/rpc/acquire_recording_lease', { p_lease_id: lease, p_force: false });
  post(b, '/functions/v1/attest-session-engine', { op: 'register', recordingKey: recording });
}
describe('bounded one-time product transport', () => {
  it('requires campaign identity and an exact approved smaller population without relaxing absolute caps',()=>{
    expect(()=>validateApproval({...approval(),campaignSha256:''},now)).toThrow();
    expect(()=>validateApproval({...approval(),takes:19},now)).toThrow();
    const bounded=new ComparisonBudget({...approval(),takes:1},()=>now);bounded.beginTake();
    bounded.bindSession(session);bounded.finishTake();bounded.finishRun();
    expect(()=>bounded.beginTake()).toThrow('bounded_take_count_exceeded');
  });
  it('counts one canonical case plus its reporter copy once, eighteen unique cases eighteen, and rejects conflicting canonical duplicates',()=>{
    const one={candidate:MODELS[0],trial:1,clip:'fixture-001',measured:true};
    const canonical={path:'/case-one/attachments/independent-app-comparison.json',row:one};
    const reporter={path:'/case-one/attachments/independent-app-comparison-json-hash.json',row:one};
    expect(canonicalCaseReceipts([canonical,reporter])).toEqual([one]);
    const eighteen=MODELS.flatMap(candidate=>[1,2].flatMap(trial=>[1,2,3].map(n=>({path:`/${candidate}-${trial}-${n}/attachments/independent-app-comparison.json`,row:{candidate,trial,clip:`fixture-00${n}`}}))));
    expect(canonicalCaseReceipts(eighteen)).toHaveLength(18);
    expect(()=>canonicalCaseReceipts([canonical,{path:'/conflict/attachments/independent-app-comparison.json',row:{...one,measured:false}}])).toThrow('bounded_duplicate_canonical_case_receipt');
  });
  it('counts a failed pre-recording case without fabricating a session or restoring the consumed case key',()=>{
    const resume={priorSessionIds:[session],priorCaseKeys:['v2:base.en:1:fixture-001','parakeet:tdt-v3:int8:1:fixture-001'],receiptSha256:'a'.repeat(64)};
    const b=new ComparisonBudget({...approval(),resume},()=>now);
    expect(b.snapshot()).toMatchObject({takesStarted:1,caseAttempts:2,completedSessionCount:0,priorOwnedSessionCount:1});
    for(let n=1;n<=17;n++){b.beginTake();b.bindSession(`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`);b.finishTake();}
    b.finishRun();expect(b.snapshot()).toMatchObject({completedSessionCount:17,actualRecordingStarts:18,caseAttempts:19});expect(()=>b.beginTake()).toThrow('bounded_take_count_exceeded');
  });
  it('admits only the exact prior run-owned attempt, without calling it completed or permitting a nineteenth take',()=>{
    const resume={priorSessionIds:[session],priorCaseKeys:['v2:base.en:1:fixture-001'],receiptSha256:'a'.repeat(64)};
    const b=new ComparisonBudget({...approval(),resume},()=>now);b.assertExistingSessions([session]);
    expect(b.snapshot()).toMatchObject({takesStarted:1,completedSessionCount:0,priorOwnedAttemptCount:1});
    b.beginTake();expect(()=>b.bindSession(session)).toThrow('bounded_session_identity_changed');
    const clean=new ComparisonBudget({...approval(),resume},()=>now);
    for(let n=1;n<18;n++){clean.beginTake();clean.bindSession(`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`);clean.finishTake();}
    clean.finishRun();expect(clean.snapshot().completedSessionCount).toBe(17);
    expect(()=>clean.beginTake()).toThrow('bounded_take_count_exceeded');
    const foreign=new ComparisonBudget({...approval(),resume},()=>now);
    expect(()=>foreign.assertExistingSessions([recording])).toThrow('bounded_account_not_empty_or_run_owned');
    expect(()=>validateApproval({...approval(),resume:{...resume,priorSessionIds:[session,session],priorCaseKeys:['one','two']}},now)).toThrow('bounded_resume_binding_invalid');
  });
  it('reserves prior preflight headroom without increasing any absolute bound',()=>{
    const reservedBeforeRun={apiRequests:LIMITS.apiRequests-1,mutations:0,localRequests:0,assetRequests:0};
    const b=new ComparisonBudget({...approval(),reservedBeforeRun},()=>now);b.beginTake();
    post(b,'/functions/v1/check-usage-limit');
    expect(()=>post(b,'/functions/v1/check-usage-limit')).toThrow('bounded_request_count_exceeded');
    expect(()=>validateApproval({...approval(),reservedBeforeRun:{...reservedBeforeRun,localRequests:-1}},now)).toThrow('bounded_prior_reservation_invalid');
    expect(()=>validateApproval({...approval(),reservedBeforeRun:{...reservedBeforeRun,assetRequests:LIMITS.assetRequests+1}},now)).toThrow('bounded_prior_reservation_invalid');
    const sockets=new ComparisonBudget({...approval(),reservedBeforeRun:{apiRequests:0,mutations:0,localRequests:0,assetRequests:0,loopbackWebSockets:72}},()=>now);sockets.beginTake();
    expect(()=>sockets.admitWebSocket('ws://127.0.0.1:5174/')).toThrow('bounded_socket_count_exceeded');
  });
  it('refuses an approved template when the independently reviewed backend contract is blocked or mismatched',()=>{
    const compatible={status:'COMPATIBLE',sourceHead:approval().sourceHead,apiOrigin:api,
      canonicalAuthorityExactSessionRead:true,selectedModelDeclarationMatches:true,models:[...MODELS]};
    expect(()=>requireCompatibleBackend(compatible,approval())).not.toThrow();
    for(const delta of [{status:'BLOCKED'},{canonicalAuthorityExactSessionRead:false},{canonicalAuthorityExactSessionRead:undefined,sessionRowVerifiedFromAuthority:true},{selectedModelDeclarationMatches:false},
      {sourceHead:'b'.repeat(40)},{apiOrigin:'https://other.example.invalid'},{models:['v2:base.en']}]){
      expect(()=>requireCompatibleBackend({...compatible,...delta},approval())).toThrow('bounded_backend_contract_unresolved');
    }
  });
  it('admits canonical authority only for the bound exact session within the existing read cap', () => {
    const b = create(); b.bindSession(session);
    b.admit({url:api+'/rest/v1/session_attribution_authority?session_id=eq.'+session,method:'GET'});
    for (const query of ['', '?session_id=eq.'+user, '?session_id=eq.'+session+'&or=(engine.eq.private)']) {
      const invalid = create(); invalid.bindSession(session);
      expect(()=>invalid.admit({url:api+'/rest/v1/session_attribution_authority'+query,method:'GET'})).toThrow('bounded_authority_subject');
    }
    for(let i=1;i<40;i++)b.admit({url:api+'/rest/v1/session_attribution_authority?session_id=eq.'+session,method:'GET'});
    expect(()=>b.admit({url:api+'/rest/v1/session_attribution_authority?session_id=eq.'+session,method:'GET'})).toThrow('bounded_endpoint_count_exceeded');
  });
  it('uses event/network clocks even when completion precedes delayed click helper return', () => {
    const nativeClick = 100; const networkCompletion = 150; const helperReturn = 200;
    expect(elapsedMs(nativeClick, networkCompletion)).toBe(50);
    expect(elapsedMs(helperReturn, networkCompletion)).toBeNull();
    for (const [start,end] of [[null,5],[5,undefined],[NaN,5],[5,Infinity],[-1,5],[10,1]]) expect(elapsedMs(start,end)).toBeNull();
  });
  it('rejects stale globals, changed captures and navigation clock resets rather than assigning decode timings', () => {
    const snapshot = {updatedAtMs:200,finalizeDecodeMs:1000,decodedUtteranceSeconds:2,utteranceSeconds:99,
      finalizeWaitMs:20,finalizePrepMs:5,peakBufferedSeconds:3,anchor:'speech'};
    expect(privateTimingMetrics(snapshot,100,150,250,true)).toMatchObject({rtf:0.5,decodedUtteranceSeconds:2,peakBufferedSeconds:3});
    expect(privateTimingMetrics({...snapshot,updatedAtMs:90},100,150,250,true)).toBeNull();
    expect(privateTimingMetrics(snapshot,100,150,250,false)).toBeNull();
    expect(privateTimingMetrics(snapshot,100,150,10,true)).toBeNull();
    expect(privateTimingMetrics({...snapshot,decodedUtteranceSeconds:0},100,150,250,true)?.rtf).toBeNull();
    expect(privateTimingMetrics({...snapshot,finalizeDecodeMs:NaN},100,150,250,true)?.rtf).toBeNull();
  });
  it('permits only the same-origin register/create/bind/terminal sequence and retains content-free counters', () => {
    const b = create(); b.assertExistingSessions([]); register(b);
    post(b, '/rest/v1/rpc/create_session_and_update_usage', { p_idempotency_key: recording,
      p_engine_type: 'private', p_session_data: { user_id: user, lease_id: lease } });
    b.bindSession(session);
    post(b, '/functions/v1/attest-session-engine', { op: 'bind', recordingKey: recording, sessionId: session });
    post(b, '/rest/v1/rpc/complete_session_v2', { p_session_id: session });
    post(b, '/functions/v1/attest-session-engine', { sessionId: session, runtimeEvidence: { engine: 'private' } });
    b.finishTake();
    expect(b.snapshot()).toMatchObject({ completedSessionCount: 1, mutationRequests: 6, failures: [] });
    const serialized = JSON.stringify(b.snapshot());
    for (const id of [session,user,recording,lease]) expect(serialized).not.toContain(id);
  });
  it.each([
    ['https://provider.invalid/inference', 'POST'],
    ['https://other.example.invalid/functions/v1/attest-session-engine', 'POST'],
    [api + '/functions/v1/get-ai-suggestions', 'POST'],
    [api + '/auth/v1/signup', 'POST'],
    [api + '/auth/v1/user', 'DELETE'],
    [api + '/rest/v1/sessions', 'DELETE'],
    [api + '/rest/v1/profiles', 'PATCH'],
    [api + '/rest/v1/rpc/set_user_timezone', 'POST'],
    ['https://huggingface.co/model.onnx', 'GET'],
  ])('refuses unapproved operation %s %s and cannot later pass', (url, method) => {
    const b = create(); expect(() => b.admit({ url, method })).toThrow();
    expect(() => b.assertHealthy()).toThrow('bounded_run_previously_failed');
  });
  it('refuses unattributed resolution and another session or recording', () => {
    for (const body of [{ op: 'resolve_unattributed', sessionId: session },
      { op: 'bind', recordingKey: recording, sessionId: session },
      { sessionId: 'other', runtimeEvidence: { engine: 'private' } }]) {
      const b = create(); register(b); b.bindSession(session);
      if (body.op === 'bind') body.recordingKey = 'other';
      expect(() => post(b, '/functions/v1/attest-session-engine', body)).toThrow();
      expect(() => b.finishTake()).toThrow();
    }
  });
  it('refuses force-taking an existing lease and foreign account/session writes', () => {
    expect(() => post(create(), '/rest/v1/rpc/acquire_recording_lease', { p_lease_id: lease, p_force: true })).toThrow();
    const b = create(); register(b);
    expect(() => post(b, '/rest/v1/rpc/create_session_and_update_usage', { p_idempotency_key: recording,
      p_engine_type: 'private', p_session_data: { user_id: 'other', lease_id: lease } })).toThrow();
    expect(() => post(create(), '/rest/v1/rpc/complete_session_v2', { p_session_id: session })).toThrow();
  });
  it('allows only the bound loopback root Vite socket and blocks provider WebSockets', () => {
    create().admitWebSocket('ws://127.0.0.1:5174/?token=synthetic');
    for (const url of ['wss://provider.invalid/', 'ws://127.0.0.1:5174/cloud', 'ws://127.0.0.1:5173/']) {
      const b = create(); expect(() => b.admitWebSocket(url)).toThrow('bounded_external_websocket');
      expect(() => b.assertHealthy()).toThrow();
    }
    const limited=create();for(let n=0;n<4;n++)limited.admitWebSocket('ws://127.0.0.1:5174/');
    expect(()=>limited.admitWebSocket('ws://127.0.0.1:5174/')).toThrow('bounded_socket_count_exceeded');
  });
  it('permits bounded CORS preflights only for otherwise allowed methods and endpoints', () => {
    const b = create();
    b.admit({url:api+'/functions/v1/attest-session-engine',method:'OPTIONS',preflightMethod:'POST'});
    expect(b.snapshot().mutationRequests).toBe(0);
    for(const [path,preflightMethod] of [['/rest/v1/sessions','DELETE'],['/functions/v1/get-ai-suggestions','POST'],['/auth/v1/signup','POST']]) {
      const invalid=create();
      expect(()=>invalid.admit({url:api+path,method:'OPTIONS',preflightMethod})).toThrow('bounded_preflight_not_allowed');
    }
  });
  it('rejects nonempty preexisting accounts and duplicate/substituted sessions', () => {
    expect(() => create().assertExistingSessions([session])).toThrow('bounded_account_not_empty_or_run_owned');
    const b = create(); b.bindSession(session); b.finishTake(); b.beginTake();
    b.assertExistingSessions([session]);
    expect(() => b.bindSession(session)).toThrow('bounded_session_identity_changed');
  });
  it('blocks endpoint excess before forwarding and fails incomplete populations', () => {
    const b = create();
    for (let n=0; n<8; n++) post(b, '/functions/v1/check-usage-limit');
    expect(() => post(b, '/functions/v1/check-usage-limit')).toThrow('bounded_endpoint_count_exceeded');
    expect(() => b.finishRun()).toThrow();
    expect(() => create().finishRun()).toThrow('bounded_population_incomplete');
  });
  it('bounds local source reads and cached asset/redirect requests independently of API caps', () => {
    const local=create();for(let i=0;i<LIMITS.localRequestsPerTake;i++)local.admit({url:approval().appOrigin+'/src/file?raw',method:'GET'});
    expect(()=>local.admit({url:approval().appOrigin+'/src/file?raw',method:'GET'})).toThrow('bounded_local_request_count_exceeded');
    const assets=create();for(let i=0;i<LIMITS.assetRequestsPerTake;i++)assets.admitCachedAsset();
    expect(()=>assets.admitCachedAsset()).toThrow('bounded_asset_request_count_exceeded');
    expect(()=>assets.assertHealthy()).toThrow();
  });
  it('allows exactly 18 unique completed takes and refuses a nineteenth', () => {
    const b = new ComparisonBudget(approval(), () => now);
    for (let n=0; n<18; n++) { b.beginTake(); b.bindSession(`${String(n).padStart(8,'0')}-2222-4222-8222-222222222222`); b.finishTake(); }
    b.finishRun(); expect(b.snapshot().completedSessionCount).toBe(18);
    expect(() => b.beginTake()).toThrow('bounded_take_count_exceeded');
  });
  it('enforces both the existing 420-second case cap and absolute whole-run/approval expiry', () => {
    let clock = now; const b = new ComparisonBudget(approval(), () => clock); b.beginTake();
    clock += LIMITS.caseMs;
    expect(() => b.admit({url: api + '/auth/v1/user', method:'GET'})).toThrow('bounded_deadline_exceeded');
    const a = approval(); a.expiresAt = new Date(now+10).toISOString();
    clock = now; const c = new ComparisonBudget(a, () => clock); c.beginTake(); clock += 10;
    expect(() => c.assertHealthy()).toThrow('bounded_deadline_exceeded');
  });
  it('does not accept fabricated approval bounds, retention, origin or expiry', () => {
    for (const patch of [{decision:'PENDING'}, {takes:19}, {maxApiRequests:3241}, {maxMutations:2161},
      {wholeRunMs:7680001}, {retention:'DELETE_OLD_ACCOUNTS'}, {apiOrigin:api+'/path'},
      {appOrigin:'http://127.0.0.1:5190'}, {expiresAt:new Date(now).toISOString()}]) {
      expect(() => validateApproval({...approval(), ...patch} as ExecutionApproval, now)).toThrow();
    }
  });
});
