// Source-only request preparation/normalization; no provider client or engine.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {providerOutputSchema,buildProviderCoachingPrompt} from '/private/tmp/speaksharp-cli-raw-output-20261021/backend/supabase/functions/_shared/coachingContract.ts';
const root='/private/tmp/speaksharp-cli-raw-output-20261021';
const support='/Users/fibonacci/SW_Dev/delivery-support';
const out=support+'/cli-rubric-protocol-v3-20261022';mkdirSync(out,{recursive:true});
const require=createRequire(root+'/package.json');const ts=require('typescript');const {transformSync}=require('esbuild');
const sha=(data:string)=>createHash('sha256').update(data).digest('hex');
const main='1090476674d1321d08ef7d39a90f3d56dbb890db';
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),'00eceeb82e70f9481bb1e9b08a2e4d14ddf3c930','local source remains frozen');
const git=(path:string)=>execFileSync('git',['show',main+':'+path],{cwd:root,encoding:'utf8'});
const mainSource=git('backend/supabase/functions/get-ai-suggestions/index.ts');
const contractText=git('backend/supabase/functions/get-ai-suggestions/contract.json');
const contract=JSON.parse(contractText);
writeFileSync(out+'/gemini-main109047-index.ts',mainSource);writeFileSync(out+'/gemini-main109047-contract.json',contractText);
const tree=ts.createSourceFile('index.ts',mainSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const fnNames=new Set(['buildDeliverySignals','buildFocusCoachingText','buildCoachingPrompt']);
const variableNames=new Set(['clockText','quoteLabel','MAX_FOCUS_LABEL_CHARS']);
const pieces:string[]=[];
for(const node of tree.statements){
  if(ts.isFunctionDeclaration(node)&&node.name&&fnNames.has(node.name.text))pieces.push(node.getText(tree).replace(/^export\s+/,''));
  if(ts.isVariableStatement(node)&&node.declarationList.declarations.some((decl:any)=>variableNames.has(decl.name.text)))pieces.push(node.getText(tree).replace(/^export\s+/,''));
}
assert.equal(pieces.length,6,'actual main prompt helper inventory');
const helperSource=pieces.join('\n');writeFileSync(out+'/gemini-prompt-helper-extract.ts',helperSource);
const compiled=transformSync(helperSource,{loader:'ts',target:'esnext'}).code;
const actualGemini=new Function('coachingContract',compiled+'\nreturn {buildDeliverySignals,buildFocusCoachingText,buildCoachingPrompt};')(contract);
const providerSource=readFileSync(root+'/frontend/src/services/coaching/llamaProvider.ts','utf8');
const providerTree=ts.createSourceFile('provider.ts',providerSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const systems:string[]=[];
function visit(node:any){
  if(ts.isPropertyAssignment(node)&&node.name?.text==='system'&&ts.isStringLiteral(node.initializer))systems.push(node.initializer.text);
  ts.forEachChild(node,visit);
}visit(providerTree);assert.equal(systems.length,1);
const system=systems[0];
writeFileSync(out+'/llama-provider-00ece.ts',providerSource);
const frozen=JSON.parse(readFileSync(support+'/cli-product-smoke-inputs-00eceeb8-20261021.json','utf8'));
const marker='Return exactly one JSON object and no surrounding prose or markdown:';
const versions=new Set(['gemini_coaching_v1','gemini_coaching_focus_v1','llama_coaching_v1','llama_coaching_focus_v1']);
function normalizePrompt(prompt:string){
  const boundary=prompt.lastIndexOf(marker);assert.ok(boundary>=0);
  const evidence=prompt.slice(0,boundary);let count=0;
  const tail=prompt.slice(boundary).replace(/("version":\s*")([^"]+)(")/g,(_match,a,v,b)=>{
    assert.ok(versions.has(v),'only declared provider version labels may normalize');count++;return a+'COACHING_OUTPUT_VERSION'+b;
  });assert.equal(count,1);return evidence+tail;
}
function normalizeSchema(schema:any){
  const result=structuredClone(schema);
  function walk(value:any){if(!value||typeof value!=='object')return;
    if(typeof value.type==='string')value.type=value.type.toLowerCase();
    for(const child of Object.values(value))walk(child);
  }walk(result);
  assert.ok(result.properties.version.enum.every((v:string)=>versions.has(v)));
  result.properties.version.enum=['COACHING_OUTPUT_VERSION'];return result;
}
const comparable=(kind:'llama'|'gemini',request:any)=>kind==='llama'?{
  system:request.messages.filter((m:any)=>m.role==='system').map((m:any)=>m.content),
  user:normalizePrompt(request.messages.find((m:any)=>m.role==='user').content),
  temperature:{explicit:true,value:request.temperature},maxOutputTokens:{explicit:true,value:request.max_tokens},
  schema:normalizeSchema(JSON.parse(request.response_format.schema)),
}:{system:[],user:normalizePrompt(request.contents[0].parts[0].text),
  temperature:{explicit:false,value:null},maxOutputTokens:{explicit:false,value:null},schema:normalizeSchema(request.generationConfig.responseSchema)};
const cells:any[]=[];const pairs:any[]=[];const seen=new Set<string>();let labelDriftCells=0;
for(const row of frozen.rows){
  const input=row.input;const localPrompt=buildProviderCoachingPrompt(input.session,input.focus,'llama:3.2-1b',input.product);
  assert.equal(localPrompt,row.prompts['llama:3.2-1b'].prompt,'approved local prompt unchanged');
  const metrics=actualGemini.buildDeliverySignals(input.session,input.focus)+actualGemini.buildFocusCoachingText(input.focus);
  const geminiPrompt=actualGemini.buildCoachingPrompt(input.session.transcript,metrics);
  const local={messages:[{role:'system',content:system},{role:'user',content:localPrompt}],temperature:0,max_tokens:256,
    response_format:{type:'json_object',schema:JSON.stringify(providerOutputSchema('llama:3.2-1b',input.product))}};
  const gemini={contents:[{parts:[{text:geminiPrompt}]}],generationConfig:contract.generationConfig};
  assert.equal(normalizePrompt(localPrompt),normalizePrompt(geminiPrompt));
  const localSerialized=JSON.stringify(local),geminiSerialized=JSON.stringify(gemini);
  assert.notEqual(localSerialized,geminiSerialized);
  assert.notDeepEqual(comparable('llama',local),comparable('gemini',gemini));
  const preparedGeminiMatchesActualMain=row.prompts.gemini.prompt===geminiPrompt;
  if(!preparedGeminiMatchesActualMain)labelDriftCells++;
  cells.push({cellId:row.id,evidence:row.evidence,pairRef:input.id,localRequestSha256:sha(localSerialized),
    geminiRequestSha256:sha(geminiSerialized),preparedGeminiMatchesActualMain});
  if(!seen.has(input.id)){
    seen.add(input.id);pairs.push({id:input.id,canonicalInput:input,
      local:{serializedRequest:localSerialized,sha256:sha(localSerialized),api:'WebLLM engine.chat.completions.create',
        model:'Llama-3.2-1B-Instruct-q4f16_1-MLC',source:'00eceeb82',runtime:'0.2.86',observedRequest:'NOT_RUN'},
      gemini:{serializedRequest:geminiSerialized,sha256:sha(geminiSerialized),api:`POST https://generativelanguage.googleapis.com/v1beta/models/${contract.model}:generateContent`,
        authentication:'Runtime-injected key; not accessed, serialized or hashed',source:main,observedRequest:'NOT_RUN'},
      historicalPreparedGemini:{prompt:row.prompts.gemini.prompt,sha256:sha(row.prompts.gemini.prompt),
        differsFromActualMainPrompt:!preparedGeminiMatchesActualMain,
        disposition:preparedGeminiMatchesActualMain?'MATCH':'PREPARED_FOCUS_VERSION_LABEL_MISMATCH_NOT_ACTUAL_MAIN_PROVIDER_REQUEST'},
      normalized:{local:comparable('llama',local),gemini:comparable('gemini',gemini),
        evidenceAndTrustedPromptEqual:true,serializedRequestsEqual:false,semanticControlsEqual:false},
      preparedGeminiMatchesActualMain});
  }
}
// A transcript literal must survive normalization; controls are not erased.
const tail='\n'+marker+'\n{"version":"llama_coaching_v1","what_worked":"x","what_to_try_next":"y"}';
const prefix='Transcript says "gemini_coaching_v1" and "llama_coaching_v1".\n';
assert.ok(normalizePrompt(prefix+tail).startsWith(prefix));
const request=JSON.parse(pairs[0].local.serializedRequest);const changed=structuredClone(request);changed.max_tokens=128;
assert.notDeepEqual(comparable('llama',request),comparable('llama',changed));
const changedSystem=structuredClone(request);changedSystem.messages[0].content+='Different instruction.';
assert.notDeepEqual(comparable('llama',request),comparable('llama',changedSystem));
assert.notEqual(normalizePrompt(prefix+tail),normalizePrompt(prefix+'Changed transcript.'+tail));
assert.equal(cells.length,18);assert.equal(pairs.length,6);assert.equal(labelDriftCells,9);
const result={createdUtc:new Date().toISOString(),state:'SOURCE_PREPARED_MANIFESTS_NOT_OBSERVED_PROVIDER_CALLS',
  source:{local:'00eceeb82e70f9481bb1e9b08a2e4d14ddf3c930',Gemini:main,mainSourceSha256:sha(mainSource),
    contractSha256:sha(contractText),helperExtractSha256:sha(helperSource),localProviderSha256:sha(providerSource)},
  method:'Actual main prompt helper declarations extracted by TypeScript AST; pure local contract builders only. No handler, engine or provider invoked.',
  allowedNormalization:['Only trusted generated output-example version field after final template marker',
    'Provider schema type casing and explicit version enum labels; all other schema constraints retained',
    'API-specific field names mapped to common comparison keys; absent controls remain explicitly absent'],
  remainingDifferences:['Llama safety system instruction','temperature0 versus unspecified','max_tokens256 versus unspecified',
    'additionalProperties false versus unspecified in Gemini schema','API serialization/model template/tokenization differ'],
  newFinding:'Nine Focus prepared Gemini prompt cells use gemini_coaching_focus_v1; main source provider prompt/schema request gemini_coaching_v1 and relabel Focus after parsing. Evidence text agrees after trusted-label-only normalization; original prepared artifact retained unchanged.',
  negativeControls:{transcriptLabelsPreserved:true,changedTranscriptDiffers:true,systemDifferencePreserved:true,tokenLimitDifferencePreserved:true},
  modelCalls:0,providerCalls:0,observedOutputs:0,pairs,cells};
writeFileSync(out+'/paired-source-requests.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({pairs:pairs.length,cells:cells.length,sourceOnly:true,promptLabelsOnlyEqual:true,
  fullRequestEqual:false,preparedGeminiFocusLabelDrift:labelDriftCells,providerCalls:0}));
