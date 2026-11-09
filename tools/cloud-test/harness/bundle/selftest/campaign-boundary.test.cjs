'use strict';
// Pure exported case-boundary evaluation only. No process, browser, auth or network.
const test=require('node:test'),assert=require('node:assert/strict');
const {capDenialReasons,evaluateCaseBoundary}=require('../harness/campaign-runner.cjs');
const result=()=>({assertions:[{id:'completion-attempts',result:'PASS',detail:'Earlier observation',evidenceRefs:['a.json']}]});
const summary=()=>({ownedProcessesRemaining:[],guard:{counters:{denied:{}},completionAttempts:{problem:null,attemptCount:0,retryMarked:false,exactExpectedAttempts:false,attempts:[]}}});
test('incomplete attempt is NOT RUN and not an invented unsafe stop',()=>{const x=evaluateCaseBoundary(result(),summary(),{status:0});assert.equal(x.safetyStop,false);assert.equal(x.assertions[0].result,'NOT RUN');});
for(const cap of ['total','coaching','backend','account-closure','public','identity','take'])test('any actual cap:'+cap+' denial stops campaign',()=>{const s=summary();s.guard.counters.denied['cap:'+cap]=1;const x=evaluateCaseBoundary(result(),s,{status:0});assert.equal(x.safetyStop,true);assert.deepEqual(x.capDenials,['cap:'+cap]);});
test('zero-valued cap entry and unrelated denial are not actual cap exhaustion',()=>{assert.deepEqual(capDenialReasons({counters:{denied:{'cap:total':0,'cap:coaching':0,'method-not-allowed':1}}}),[]);});
test('all multiple exhausted cap categories retained in reason',()=>{const s=summary();s.guard.counters.denied={'cap:coaching':1,'cap:public':2};const x=evaluateCaseBoundary(result(),s,{status:0});assert.deepEqual(x.capDenials,['cap:coaching','cap:public']);});
test('first typed auth rejection stops campaign even with safe exit and cleanup',()=>{const s=summary();s.authenticationRejected=true;const x=evaluateCaseBoundary({assertions:[]},s,{status:0});assert.equal(x.authenticationRejected,true);assert.equal(x.safetyStop,true);assert.match(x.reason,/Authentication rejected/);});
test('typed case auth signal is preserved if supplied by reviewed recorder',()=>{const x=evaluateCaseBoundary({assertions:[],executionSignals:{authenticationRejected:true}},summary(),{status:0});assert.equal(x.authenticationRejected,true);assert.equal(x.safetyStop,true);});
test('arbitrary auth-like text is not a fabricated rejection',()=>{const x=evaluateCaseBoundary({assertions:[],reason:'auth failed'},summary(),{status:0});assert.equal(x.authenticationRejected,false);});
test('missing supervisor summary remains safety stop independently of attempt completeness',()=>{assert.equal(evaluateCaseBoundary({assertions:[]},null,{status:0}).safetyStop,true);});
test('observed duplicate makes FAIL and safety stop',()=>{const s=summary();s.guard.completionAttempts.problem='extra-or-changed-completion-attempt';const x=evaluateCaseBoundary(result(),s,{status:0});assert.equal(x.assertions[0].result,'FAIL');assert.equal(x.safetyStop,true);});

test('pending launch cleanup failure is an unsafe case boundary even without exposed error payload',()=>{const {evaluateCaseBoundary}=require('../harness/campaign-runner.cjs');const r=evaluateCaseBoundary({assertions:[]},{launchCleanupFailure:true,guard:{completionAttempts:null,feedbackFaults:[],counters:{denied:{}}},ownedProcessesRemaining:[]},{status:0});assert.equal(r.safetyStop,true);});

test('transferred media cleanup failure remains unsafe independent of process exit',()=>{const r=evaluateCaseBoundary({assertions:[]},{mediaCleanupFailure:true,guard:{completionAttempts:null,feedbackFaults:[],counters:{denied:{}}},ownedProcessesRemaining:[]},{status:0});assert.equal(r.safetyStop,true);});
