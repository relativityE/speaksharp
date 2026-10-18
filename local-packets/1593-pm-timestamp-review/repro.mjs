// Mocked GitHub I/O only; characterizes the rejected e1680001 timestamp omission.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { campaignWindowRuns, priorRunsOnRelease, campaignStartPreflight, invocationFor } from '../1593-campaign-helper/collect.mjs';
import { assess } from '../1593-bootstrap/contract.mjs';
process.env.PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'mock') + path.delimiter + process.env.PATH;
const now = 1800000000000;
const S = '1'.repeat(40);
const authority = { verified:true,campaignId:'offline-review',releaseSha:S,configDigest:'a'.repeat(64),budget:30,firstCase:1,lastCase:15,
  validFrom:now,validUntil:now+60000,allowRunOwnedCreation:true,allowPermanentRunOwnedCleanup:true,allowRunOwnedCanaryClaim:true,cleanupScopeDigest:'c'.repeat(64) };
const windowRuns=campaignWindowRuns(now);
const priorRuns=priorRunsOnRelease(S,now);
const bootstrap=campaignStartPreflight({authority,explicitFirstDispatch:true,windowRuns,priorRuns});
const decision=assess({caseNumber:1,now,authority,bootstrap,previousReceipt:null,invocation:invocationFor(1),
 observation:{verified:true,observedAt:now,validUntil:now+60000,mainSha:S,servedSha:S,workflowSha:S,configDigest:authority.configDigest,main:'idle',rcGates:'idle',production:'idle'},
 ledger:{verified:true,campaignId:authority.campaignId,entries:[],inFlight:[],unresolvedCleanup:[]}});
assert.deepEqual(windowRuns,[]);
assert.deepEqual(priorRuns,[]);
assert.equal(decision.eligible,true);
process.stdout.write(JSON.stringify({reviewed:'e1680001',mockedOnly:true,runSummary:'before-window',attemptStart:null,windowRuns,priorRuns,decision},null,2)+'\n');
