'use strict';const test=require('node:test'),assert=require('node:assert/strict');const{validateOperatorPaths}=require('../harness/operator-paths.cjs');
const base={checkoutDir:'/unit/checkout',packetRoot:'/unit/packet',output:'/unit/private/run',privateInputs:['/unit/private/config.json']};
test('run output/config external to checkout and immutable packet accepted',()=>assert.equal(validateOperatorPaths(base).privatePathsExternal,true));
for(const output of ['/unit/checkout/run','/unit/packet/run','/unit/checkout','relative','/unit/private/../packet/run'])test('unsafe output refused '+output,()=>assert.throws(()=>validateOperatorPaths({...base,output})));
for(const input of ['/unit/checkout/config.json','/unit/packet/bundle/config/a.json','relative'])test('private config must not edit reviewed/checkout bytes '+input,()=>assert.throws(()=>validateOperatorPaths({...base,privateInputs:[input]})));
