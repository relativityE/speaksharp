import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import {productCoachingPrompt} from '/private/tmp/speaksharp-cli-persistent-context-20261022/scripts/model-evaluator/product-coaching-inputs.ts';

const root='/private/tmp/speaksharp-cli-persistent-context-20261022';
const require=createRequire(`${root}/package.json`);
const sha=x=>createHash('sha256').update(x).digest('hex');
const raw=JSON.parse(readFileSync('/private/tmp/cli-llama-minimum-smoke-20261022T1925.json','utf8'));
const original=execFileSync('git',['show','7216e35c:frontend/src/services/coaching/llamaProvider.ts'],{cwd:root,encoding:'utf8'});
const sdk=readFileSync(`${root}/node_modules/@mlc-ai/web-llm/lib/index.js`,'utf8');
const config=JSON.parse(readFileSync('/private/tmp/speaksharp-model-assets-1304/llama/mlc-chat-config.json','utf8'));

test('rebuilding the consumed source with the pre-correction provider reproduces the exact retained browser bundle',async()=>{
  assert.equal(sha(original),'ad31227100e6a2642e3670a75d953ae1b77e47e58e00ff8826a5120a16223ad7');
  assert.equal(sha(sdk),'ae2642e73a4a9896c21efb3a067c4666446f8b49cbe2012f4b576f5d83d5f206');
  const {build}=require('esbuild');
  const built=await build({absWorkingDir:root,entryPoints:[`${root}/frontend/src/benchmark/model-investigation-local.ts`],
    outfile:'/private/tmp/cli-causal-bundle-memory-only/bundle.mjs',write:false,bundle:true,format:'esm',platform:'browser',target:'esnext',
    define:{'import.meta.env.VITE_INTERNAL_BUILD':'"true"'},loader:{'.wasm':'file'},logLevel:'warning',
    plugins:[{name:'retained-provider-before-fix',setup(build){build.onLoad({filter:/\/services\/coaching\/llamaProvider\.ts$/},()=>({contents:original,loader:'ts'}));}}]});
  const bundle=built.outputFiles.find(x=>x.path.endsWith('/bundle.mjs'));
  assert.ok(bundle);assert.equal(sha(bundle.contents),raw.bundleSha256);
  console.log(JSON.stringify({bundleSha256:sha(bundle.contents),originalProviderSha256:sha(original),sdkSha256:sha(sdk),modelCalls:0}));
});

test('exact SDK accounting method submits BOS but reports only separately encoded message tokens for all six retained inputs',async()=>{
  const {PreTrainedTokenizer}=require('@huggingface/transformers');
  const tokenizer=new PreTrainedTokenizer(
    JSON.parse(readFileSync('/private/tmp/speaksharp-model-assets-1304/llama/tokenizer.json','utf8')),
    JSON.parse(readFileSync('/private/tmp/speaksharp-model-assets-1304/llama/tokenizer_config.json','utf8')));
  const helper=sdk.slice(sdk.indexOf('function __awaiter('),sdk.indexOf('\nfunction __values('));
  const start=sdk.indexOf('    getInputData() {');
  const method=sdk.slice(start,sdk.indexOf('    forwardTokensAndSample(',start));
  const Probe=vm.runInNewContext(`(()=>{${helper};class Probe{${method}};return Probe;})()`);
  const system=original.match(/system:'([^']+)'/)[1];
  assert.deepEqual(config.conv_template.system_prefix_token_ids,[128000]);
  const rows=[];
  for(const cell of raw.protocol.cells.filter(x=>x.trial===1)){
    const user=productCoachingPrompt(cell.productInput,'llama:3.2-1b'),c=config.conv_template;
    const parts=[c.system_template.replace('{system_message}',system),
      c.roles.user+c.role_content_sep+user+c.seps[0],c.roles.assistant+c.role_empty_sep];
    const probe=new Probe();Object.assign(probe,{filledKVCacheLength:0,slidingWindowSize:-1,contextWindowSize:4096,
      config:{model_config:{}},imageDataCache:new Map(),
      conversation:{isTextCompletion:false,config:c,getPromptArray:()=>parts},
      tokenizer:{encode:text=>tokenizer.encode(text,{add_special_tokens:false})}});
    const [inputData,sdkUsage]=await probe.getInputData();
    const actualContextTokens=inputData.flat().length;
    const retained=raw.cells.find(x=>x.id===cell.id).result;
    assert.equal(actualContextTokens,retained.predictedPromptTokens);
    assert.equal(sdkUsage,retained.usage.prompt_tokens);
    assert.equal(actualContextTokens,sdkUsage+c.system_prefix_token_ids.length);
    rows.push({id:cell.id,submittedContextTokens:actualContextTokens,sdkUsageTokens:sdkUsage,prefixTokens:c.system_prefix_token_ids});
  }
  assert.equal(rows.length,6);console.log(JSON.stringify({rows,modelCalls:0,tokenizer:'cached HF4.3.0; exact SDK method extracted without GPU construction'}));
});
