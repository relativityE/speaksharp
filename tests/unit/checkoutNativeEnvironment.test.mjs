import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {nativeCommand,nativeWarmupCommand,nativeDenoPolicy,nativeEnvironment} from '../../scripts/lib/nativeTestExecutionEvidence.mjs';

const checkout='backend/supabase/functions/stripe-checkout/index.test.ts';
const binding=testFile=>({testFile,runtime:{runner:'deno',execPath:'/usr/bin/deno'}});
test('checkout import may inspect only an absent Stripe key; no inherited key or execution capability',()=>{
  const policy=nativeDenoPolicy(checkout);
  assert.deepEqual(policy.environment,{names:['STRIPE_SECRET_KEY'],initial:'absent',inherit:false,syntheticValue:null,reinject:false});
  const command=nativeCommand(binding(checkout));
  assert.deepEqual(command.filter(arg=>arg.startsWith('--allow-env')),['--allow-env=STRIPE_SECRET_KEY']);
  for(const flag of ['--deny-net','--deny-read','--deny-write','--deny-run','--no-prompt','--cached-only','--frozen']) assert.ok(command.includes(flag));
  const warmup=nativeWarmupCommand(binding(checkout));
  assert.ok(warmup.includes('--deny-env'));assert.ok(warmup.includes('--no-run'));
  assert.equal(warmup.some(arg=>arg.startsWith('--allow-env')),false);
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'checkout-env-policy-'));
  try{
    const env=nativeEnvironment(cwd,{STRIPE_SECRET_KEY:'sk_live_DO_NOT_INHERIT',GEMINI_API_KEY:'DO_NOT_INHERIT',SUPABASE_SERVICE_ROLE_KEY:'DO_NOT_INHERIT'});
    for(const key of ['STRIPE_SECRET_KEY','GEMINI_API_KEY','SUPABASE_SERVICE_ROLE_KEY'])assert.equal(Object.hasOwn(env,key),false);
  }finally{fs.rmSync(cwd,{recursive:true,force:true});}
});
test('checkout exception cannot extend to another path and coaching keeps its original narrow policy',()=>{
  for(const file of ['backend/supabase/functions/stripe-checkout/localSandbox.test.ts',checkout+'.other','backend/supabase/functions/stripe-webhook/index.test.ts']){
    assert.deepEqual(nativeDenoPolicy(file).environment.names,[]);
    assert.ok(nativeCommand(binding(file)).includes('--deny-env'));
  }
  const file='backend/supabase/functions/get-ai-suggestions/index.test.ts';
  assert.deepEqual(nativeDenoPolicy(file).environment.names,['GEMINI_API_KEY']);
  assert.equal(nativeDenoPolicy(file).environment.syntheticValue,'test-key');
  assert.ok(nativeCommand(binding(file)).includes('--allow-env=GEMINI_API_KEY'));
  assert.ok(nativeWarmupCommand(binding(file)).includes('--deny-env'));
});
