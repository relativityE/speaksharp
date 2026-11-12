import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const SOURCE_CONSUMER='tests/unit/sourceContractEvidence.test.js';
export const SOURCE_ASSERTION='consumes registered source inputs with fault-sensitive contracts and no live credit';
export const CASE07_APPLY='product_release/evidence/retained/case07-apply.proposed.sql';
export const CASE07_ROLLBACK='product_release/evidence/retained/case07-rollback.proposed.sql';
const FIXTURE_GENERATOR='tests/fixtures/rwt/generate-rwt-tts-fixtures.sh';
export const BILLING_SPEC='tests/billing/user-journey/journey.billing.spec.ts';
export const BILLING_TARGET='tests/billing/user-journey/sandbox-target.json';
export const BILLING_README='tests/billing/user-journey/README.md';
export const SOURCE_CONTRACTS=Object.freeze([
  'tests/canary/smoke.canary.spec.ts',
  'tests/live/rwt-open-mic-first-session.live.spec.ts',
  'tests/fixtures/rwt/rwt-fixtures.manifest.json',
  // #1548 route contracts (#1724): the canonical /progress destinations, as wiring only.
  'tests/live/rwt-products-navigation.live.spec.ts',
  'tests/live/private-recording-proof.live.spec.ts',
  'tests/live/report-page-context.live.spec.ts',
  // #1712 (A3-3.a under #1643): the Account page offers Delete account, read-only, as wiring only.
  'tests/live/account-delete-entry-a3-3.live.spec.ts',
  CASE07_APPLY,
  CASE07_ROLLBACK,
  BILLING_SPEC,
  BILLING_TARGET,
  BILLING_README,
  // #1760 model comparison: operator-run harness and evaluator inputs with no unit execution of their own. Wiring, text and
  // data contracts only; the live in-app comparison, the standalone evaluator, browsers and models are NOT RUN.
  'tests/model-dropin/inAppComparison.live.spec.ts',
  'tests/model-dropin/playwright.in-app.config.ts',
  'tests/model-dropin/run-bounded-comparison.mjs',
  'tests/model-dropin/run-bounded-comparison.d.mts',
  'tests/model-dropin/qualification.d.mts',
  'tests/model-dropin/transportBoundary.ts',
  'tests/model-dropin/EXECUTION.md',
  'tests/evidence/fixtures/model-evaluator/baseline-shared-v2.json',
  'tests/evidence/fixtures/model-evaluator/candidate-parakeet-tdt-v3.json',
  'tests/evidence/fixtures/model-evaluator/candidate-granite-turboctc.json',
  'tests/evidence/fixtures/model-evaluator/device-local-registered.json',
  'tests/evidence/fixtures/model-evaluator/corpus-synthetic-degraded.json',
  'tests/evidence/fixtures/model-evaluator/corpus-fixture-001-paired.json',
  'tests/evidence/fixtures/model-evaluator/product-campaign.json',
  'tests/evidence/fixtures/model-evaluator/product-campaign.parakeet-fixture-001.json',
  FIXTURE_GENERATOR,
]);
const MODEL_ADAPTER='./scripts/model-evaluator/adapters/candidate-browser.ts';
const arm=(candidateId,engine,modelId,assetDigest,runtime,backend)=>Object.freeze({kind:'json',pins:[
  [['version'],1],[['adapterModule'],MODEL_ADAPTER],[['adapterOptions','candidateId'],candidateId],
  [['adapterOptions','consentToDownload'],false],[['identity','engine'],engine],[['identity','modelId'],modelId],
  [['identity','assetDigest'],assetDigest],[['identity','runtime'],runtime],[['identity','backend'],backend]]});
const WAV={'fixture-001':'500dc7ab81937cab98f6b3ef4da9b29ee1093b583e1a677840ea8458b92ef247'};
// Pinned evaluator inputs: every pin must hold exactly, and a corpus consumes each referenced WAV by digest (as the evaluator does).
const DATA_CONTRACTS=Object.freeze({
  'tests/evidence/fixtures/model-evaluator/baseline-shared-v2.json':arm('v2:base.en','private-v2','Xenova/whisper-base.en',
    'c7eaa6a9f8ccacbdafce2092d8e03752e2540acf0d4d87b01aebb05f6ba1d110','@xenova/transformers@2.17.2','wasm'),
  'tests/evidence/fixtures/model-evaluator/candidate-parakeet-tdt-v3.json':arm('parakeet:tdt-v3:int8','parakeet-tdt','nvidia/parakeet-tdt-0.6b-v3',
    'a4646f1dac9191a8b65634526bda1c6619e148d1e1b58e2c60b1522fba7536fe','parakeet.js@1.4.4','wasm'),
  'tests/evidence/fixtures/model-evaluator/candidate-granite-turboctc.json':arm('granite:turboctc-q4f16','granite-ctc',
    'ibm-granite/granite-speech-5.0-470m-turboctc','3d20c877a2764c504ed79c38598579f47cdb1f57b004af4b76ee0b4af3944d62','onnxruntime-web@1.26.0','webgpu'),
  'tests/evidence/fixtures/model-evaluator/device-local-registered.json':Object.freeze({kind:'json',pins:[[['version'],1],
    [['baseUrl'],'http://127.0.0.1:5173'],[['backend'],'registered'],[['headless'],false],[['expectedGpuVendor'],'apple']]}),
  'tests/evidence/fixtures/model-evaluator/corpus-synthetic-degraded.json':Object.freeze({kind:'json',corpus:true,pins:[[['version'],1],[['trials'],2],
    [['clips','length'],3],[['clips',0,'id'],'fixture-001-mute'],[['clips',0,'control','kind'],'mute'],
    [['clips',1,'id'],'fixture-002-prefix-250ms'],[['clips',1,'control','kind'],'prefix-250ms'],
    [['clips',2,'id'],'fixture-003-mute'],[['clips',2,'control','kind'],'mute']]}),
  'tests/evidence/fixtures/model-evaluator/corpus-fixture-001-paired.json':Object.freeze({kind:'json',corpus:true,pins:[[['version'],1],[['trials'],3],
    [['clips','length'],1],[['clips',0,'id'],'fixture-001'],[['clips',0,'wavSha256'],WAV['fixture-001']]]}),
  'tests/evidence/fixtures/model-evaluator/product-campaign.json':Object.freeze({kind:'json',pins:[[['schemaVersion'],1],[['mode'],'product-lifecycle'],
    [['candidates'],['v2:base.en','parakeet:tdt-v3:int8','granite:turboctc-q4f16']],
    [['corpus'],'tests/evidence/fixtures/model-evaluator/corpus-synthetic-smoke.json'],[['maximumTakes'],18]]}),
  'tests/evidence/fixtures/model-evaluator/product-campaign.parakeet-fixture-001.json':Object.freeze({kind:'json',pins:[[['schemaVersion'],1],
    [['mode'],'product-lifecycle'],[['candidates'],['v2:base.en','parakeet:tdt-v3:int8']],
    [['corpus'],'tests/evidence/fixtures/model-evaluator/corpus-fixture-001-paired.json'],[['maximumTakes'],6]]}),
});
// Operator documentation: each required statement must appear exactly once (a raw-text wiring contract).
const TEXT_CONTRACTS=Object.freeze({
  'tests/model-dropin/EXECUTION.md':Object.freeze([
    'No account/session deletion or cleanup command is implemented.',
    'Evaluator binding: the collector binds take, capture and candidate identity from the',
    "CDP-installed comparison authorization; a public Production page never defines it.",
    'Approve this normal server retention effect explicitly for the 18 synthetic takes.',
  ]),
});
const pinValue=(doc,keys)=>keys.reduce((value,key)=>value==null?undefined:key==='length'&&Array.isArray(value)?value.length:value[key],doc);
function dataProblems(root,file,source) {
  const contract=DATA_CONTRACTS[file];let doc;
  try{doc=JSON.parse(source);}catch{return ['invalid JSON'];}
  const problems=contract.pins.filter(([keys,expected])=>JSON.stringify(pinValue(doc,keys))!==JSON.stringify(expected))
    .map(([keys])=>`pin ${keys.join('.')}`);
  if(contract.corpus) {
    for(const clip of Array.isArray(doc.clips)?doc.clips:[]) {
      const wav=typeof clip?.path==='string'?path.posix.normalize(path.posix.join(path.posix.dirname(file),clip.path)):null;
      if(!wav || wav.startsWith('../') || !/^[a-f0-9]{64}$/.test(clip.wavSha256 || '')) {problems.push(`clip ${clip?.id}`);continue;}
      try{if(createHash('sha256').update(fs.readFileSync(path.join(root,wav))).digest('hex')!==clip.wavSha256)problems.push(`wav digest ${clip.id}`);}
      catch{problems.push(`wav missing ${clip.id}`);}
    }
  }
  return problems;
}
const corpusAudio=(root,file)=>{try{return (JSON.parse(read(root,file)).clips || []).map(clip=>path.posix.normalize(path.posix.join(path.posix.dirname(file),clip.path)));}catch{return [];}};
const CASE07_SQL=Object.freeze({
  [CASE07_APPLY]:Object.freeze({
    operation:'grant',
    sha256:'153c3140f6b5da3f80b315fe00d5f41f566f9552603de586de5df3e6d5358ab7',
    required:Object.freeze([
      "SET LOCAL lock_timeout='3s';",
      "SET LOCAL statement_timeout='10s';",
      'LOCK TABLE public.user_goals IN SHARE ROW EXCLUSIVE MODE;',
      "relkind='r' AND relrowsecurity AND NOT relforcerowsecurity",
      "pg_get_userbyid(relowner)='postgres'",
      "relacl::text='{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}'",
      "IS DISTINCT FROM ARRAY['id','user_id','weekly_goal','clarity_goal','created_at','updated_at']",
      "has_schema_privilege('authenticated','public','USAGE')",
      "rolname='authenticated' AND (rolsuper OR rolbypassrls)",
      "polname='Users can view own goals'",
      "polname='Users can insert own goals'",
      "polname='Users can update own goals'",
      'GRANT SELECT (id,user_id,weekly_goal,clarity_goal,created_at,updated_at) ON public.user_goals TO authenticated;',
      'GRANT INSERT (user_id,weekly_goal,clarity_goal), UPDATE (user_id,weekly_goal,clarity_goal) ON public.user_goals TO authenticated;',
    ]),
  }),
  [CASE07_ROLLBACK]:Object.freeze({
    operation:'revoke',
    sha256:'0e217dcde39415b41eb947595fb2dda3a0c448c87d7f86ca7bd7d43f06344a2a',
    required:Object.freeze([
      "SET LOCAL lock_timeout='3s';",
      "SET LOCAL statement_timeout='10s';",
      'LOCK TABLE public.user_goals IN SHARE ROW EXCLUSIVE MODE;',
      "relacl::text='{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}'",
      "IS DISTINCT FROM ARRAY['id','user_id','weekly_goal','clarity_goal','created_at','updated_at']",
      'IF EXISTS(SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x',
      "x.grantee<>(SELECT oid FROM pg_roles WHERE rolname='authenticated')",
      "x.grantor<>(SELECT oid FROM pg_roles WHERE rolname='postgres') OR x.is_grantable",
      "x.privilege_type NOT IN ('SELECT','INSERT','UPDATE')",
      "a.attname IN ('id','created_at','updated_at') AND x.privilege_type<>'SELECT'",
      'WHERE a.attrelid=\'public.user_goals\'::regclass AND a.attnum>0 AND NOT a.attisdropped)<>12',
      'REVOKE SELECT (id,user_id,weekly_goal,clarity_goal,created_at,updated_at) ON public.user_goals FROM authenticated;',
      'REVOKE INSERT (user_id,weekly_goal,clarity_goal), UPDATE (user_id,weekly_goal,clarity_goal) ON public.user_goals FROM authenticated;',
    ]),
  }),
});
// Real (non-type, unrenamed) imports a wiring contract requires; route contracts require none.
const REQUIRED_IMPORTS=Object.freeze({
  [SOURCE_CONTRACTS[0]]:{module:'./canaryStopSaveOracle',names:['collectCanaryStopSave','isOwnedStopSettledInPage','startOwnerId']},
  [SOURCE_CONTRACTS[1]]:{module:'./helpers/rwtFillerReference',names:['corpusRows','crossCheckCounts','fillerAnnotationsOf','hesitationTotals']},
  [BILLING_SPEC]:{module:'./contract',names:['BILLING_JOURNEYS','receipt','requireFact','assertSandboxConfiguration',
    'assertTestPrice','assertInvoice','isCorrelatedDelivery','safeFailureReason']},
});
const importsMissing=(ts,parsed,file)=>{
  const required=REQUIRED_IMPORTS[file];
  if(!required) return false;
  const imports=parsed.statements.filter(node=>ts.isImportDeclaration(node) && node.moduleSpecifier.text===required.module)
    .flatMap(node=>node.importClause?.namedBindings?.elements || [])
    .filter(node=>!node.isTypeOnly && !node.parent.parent.isTypeOnly && (!node.propertyName || node.propertyName.text===node.name.text))
    .map(node=>node.name.text);
  return required.names.some(name=>imports.filter(value=>value===name).length!==1);
};
export const registeredSourceContract=file=>SOURCE_CONTRACTS.includes(file);

const FILLER_REFERENCE='tests/live/helpers/rwtFillerReference.ts';
// #1720 keeps annotations in reviewed executable code, not the manifest. Parse literals only;
// never import/execute a live helper, and bind its exact bytes into the source witness.
function fixtureReference(root,entry) {
  const source=read(root,FILLER_REFERENCE);
  const ts=createRequire(path.join(root,'package.json'))('typescript');
  const parsed=ts.createSourceFile(FILLER_REFERENCE,source,ts.ScriptTarget.Latest,true);
  if(parsed.parseDiagnostics.length) throw new Error('Invalid fixture reference source');
  const declarations=parsed.statements.filter(ts.isVariableStatement).flatMap(s=>[...s.declarationList.declarations]);
  const initializer=name=>{
    const matches=declarations.filter(d=>ts.isIdentifier(d.name)&&d.name.text===name);
    if(matches.length!==1) throw new Error('Missing/duplicate fixture reference declaration');
    return matches[0].initializer;
  };
  const frozen=n=>{
    if(!n||!ts.isCallExpression(n)||n.expression.getText(parsed)!=='Object.freeze'||n.arguments.length!==1) throw new Error('Unreviewed fixture reference expression');
    return n.arguments[0];
  };
  const object=(n,keys)=>{
    if(!ts.isObjectLiteralExpression(n)||n.properties.length!==keys.length) throw new Error('Invalid fixture reference literal');
    const result={};
    for(const p of n.properties) {
      if(!ts.isPropertyAssignment(p)||!ts.isIdentifier(p.name)||!keys.includes(p.name.text)||Object.hasOwn(result,p.name.text)||!ts.isStringLiteral(p.initializer)) throw new Error('Invalid fixture reference property');
      result[p.name.text]=p.initializer.text;
    }
    return result;
  };
  const identity=object(frozen(initializer('OPEN_MIC_TTS_IDENTITY')),['file','sha256','kind']);
  if(!entry||Object.hasOwn(entry,'fillerAnnotations')||identity.kind!=='synthetic'||identity.file!=='open_mic_tts.wav'
    || !/^[a-f0-9]{64}$/.test(identity.sha256)||Object.entries(identity).some(([k,v])=>entry[k]!==v)) throw new Error('Fixture reference identity mismatch');
  const mapped=frozen(initializer('OPEN_MIC_TTS_ANNOTATIONS'));
  if(!ts.isCallExpression(mapped)||!ts.isPropertyAccessExpression(mapped.expression)||mapped.expression.name.text!=='map'
    ||!ts.isArrayLiteralExpression(mapped.expression.expression)||mapped.arguments.length!==1
    ||tokens(root,mapped.arguments[0].getText(parsed))!==tokens(root,'(a) => Object.freeze(a)')) throw new Error('Invalid fixture annotation table');
  const resolver=initializer('fillerAnnotationsOf');
  const expected=`(entry: unknown): FillerAnnotation[] => {
    const e = entry as { file?: unknown; sha256?: unknown; kind?: unknown } | null;
    if (!e || e.file !== OPEN_MIC_TTS_IDENTITY.file || e.sha256 !== OPEN_MIC_TTS_IDENTITY.sha256 || e.kind !== OPEN_MIC_TTS_IDENTITY.kind) return [];
    return OPEN_MIC_TTS_ANNOTATIONS.map((a) => ({ ...a }));
  }`;
  if(tokens(root,resolver.getText(parsed))!==tokens(root,expected)) throw new Error('Fixture reference resolver wiring changed');
  return {items:mapped.expression.expression.elements.map(n=>object(n,['word','anchor'])),sourceSha256:hash(source)};
}

export function sourceContractApplicability(root,file) {
  if(!registeredSourceContract(file)) return {supported:false,reason:'unregistered source contract'};
  try {read(root,SOURCE_CONSUMER);} catch {return {supported:false,reason:'source contract consumer unavailable or aliased'};}
  try {
    const source=read(root,file);
    if(file===BILLING_TARGET || file===BILLING_README) {
      inspectBillingInput(file,source);
    } else if(CASE07_SQL[file]) {
      inspectCase07Sql(file,source);
    } else if(DATA_CONTRACTS[file]) {
      if(dataProblems(root,file,source).length) return {supported:false,reason:'receiving evaluator input pins unavailable'};
    } else if(TEXT_CONTRACTS[file]) {
      if(TEXT_CONTRACTS[file].some(fragment=>source.split(fragment).length!==2)) return {supported:false,reason:'receiving operator statements unavailable'};
    } else if(file===FIXTURE_GENERATOR) {
      inspectFixtureGenerator(root,source);
    } else if(file===SOURCE_CONTRACTS[2]) {
      const entry=JSON.parse(source).fixtures?.open_mic_tts;
      fixtureReference(root,entry);
      read(root,'tests/fixtures/rwt/generate-rwt-tts-fixtures.sh');
    } else {
      const ts=createRequire(path.join(root,'package.json'))('typescript');
      const parsed=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
      if(parsed.parseDiagnostics.length || importsMissing(ts,parsed,file)) {
        return {supported:false,reason:'receiving source imports/schema unavailable'};
      }
      // A route contract has no import shape; its known shape is every required route wire being present at all.
      if(!REQUIRED_IMPORTS[file]) {
        const code=tokens(root,source);
        if(wiring[file].some(fragment=>!code.includes(tokens(root,fragment)))) return {supported:false,reason:'receiving route wiring unavailable'};
      }
    }
    return {supported:true};
  } catch {return {supported:false,reason:'source contract inputs unavailable, aliased or unknown'};}
}

function inspectCase07Sql(file,source) {
  const contract=CASE07_SQL[file];
  if(!contract) throw new Error('Unregistered Case 07 SQL review candidate');
  const sourceSha256=hash(source);
  if(sourceSha256!==contract.sha256) throw new Error(`Case 07 reviewed SQL bytes changed: ${file}`);
  const code=source.replace(/--[^\n]*/g,'').replace(/\/\*[\s\S]*?\*\//g,'');
  if(code.split('BEGIN;').length!==2 || code.split('COMMIT;').length!==2
    || !/^\s*BEGIN;/.test(code) || !/COMMIT;\s*$/.test(code)
    || contract.required.some(fragment=>code.split(fragment).length!==2)) {
    throw new Error(`Case 07 SQL contract failed: ${file}`);
  }
  const grants=code.match(/\bGRANT\b[^;]*;/g) || [],revokes=code.match(/\bREVOKE\b[^;]*;/g) || [];
  if(contract.operation==='grant') {
    if(grants.length!==2 || revokes.length || /\bWITH\s+GRANT\s+OPTION\b/i.test(code)
      || /\bTO\s+(?:anon|service_role)\b/i.test(code)) throw new Error(`Case 07 grant scope widened: ${file}`);
  } else if(revokes.length!==2 || grants.length) throw new Error(`Case 07 rollback scope widened: ${file}`);
  if(/\b(?:ALTER|CREATE|DROP|TRUNCATE)\b/i.test(code)
    || /\b(?:INSERT\s+INTO|DELETE\s+FROM|UPDATE\s+(?:public\.)?[A-Za-z_][A-Za-z0-9_]*\s+SET)\b/i.test(code)) {
    throw new Error(`Case 07 SQL contains an unreviewed operation: ${file}`);
  }
  return {file,sha256:sourceSha256,kind:'sql-review-candidate',operation:contract.operation,
    checks:contract.required.length,
    databaseExecution:'NOT RUN',productionExecution:'NOT AUTHORIZED'};
}

function read(root,file) {
  const target=path.join(root,file);
  if(!fs.lstatSync(target).isFile() || fs.realpathSync(target)!==target) throw new Error('Aliased source contract input');
  return fs.readFileSync(target,'utf8');
}

// Narrow wiring contracts, not an interpreter or a claim that a live spec ran.
// Read parsed code tokens, including nested template/regexp contexts. A raw
// scanner without the parser's rescans loses those boundaries. Comments are
// trivia and cannot masquerade as the required wiring.
function tokens(root,source) {
  const ts=createRequire(path.join(root,'package.json'))('typescript');
  const parsed=ts.createSourceFile('wiring.ts',source,ts.ScriptTarget.Latest,true);
  const result=[];
  const visit=node=>{
    const children=node.getChildren(parsed);
    if(children.length) children.forEach(visit);
    else if(node.kind!==ts.SyntaxKind.EndOfFileToken && node.getText(parsed)) result.push(node.getText(parsed));
  };
  visit(parsed);
  return result.join('\u0000');
}

const MODEL_WIRING=Object.freeze({
  'tests/model-dropin/inAppComparison.live.spec.ts':[
    'test.setTimeout(caseMs(candidate));',
    'budget.beginTake(candidate);',
    "expect(switched.ok, 'shared product candidate switch succeeds without fallback').toBe(true);",
    "expect(product.productProof.verdict, 'existing collector must PASS with persisted verified identity').toBe('PASS');",
    'receipt.sessionSha256 = budget.sessionSha256();',
    "if (driverDigest() !== approval.driverSha256) throw Error('bounded_driver_changed_during_run');",
  ],
  'tests/model-dropin/playwright.in-app.config.ts':[
    "throw Error('bounded_loopback_app_required');",
    "if (process.env.PLAYWRIGHT_NO_COPY_PROMPT !== '1') throw Error('bounded_error_context_privacy_required');",
    'workers: 1, fullyParallel: false, retries: 0, maxFailures: 1,',
    "trace: 'off', screenshot: 'off', video: 'off',",
  ],
  'tests/model-dropin/run-bounded-comparison.mjs':[
    "if (process.version !== 'v22.12.0') throw Error('bounded_requires_frozen_node_22_12_0');",
    'validateApproval(approval, Date.now());',
    'const resumed=canonicalPopulation(priorRows,canonicalCaseReceipts(canonical),approval.resume?.retryCaseKeys??[]);',
    'browserServer=await launchOwned(ownership,()=>chromium.launchServer(',
    'await awaitOwnedCleanup(workloads,cleanupBarrier,{ownershipComplete:()=>ownership.complete});',
  ],
  'tests/model-dropin/run-bounded-comparison.d.mts':['export {};'],
  'tests/model-dropin/qualification.d.mts':[
    'export declare function validatePromotionPolicy(policy: unknown): PromotionPolicy;',
    'export declare function qualifyComparison(input: {',
  ],
  'tests/model-dropin/transportBoundary.ts':[
    "let options: Parameters<Route['fetch']>[0] = {maxRedirects:0,maxRetries:0,timeout:30_000};",
    "if(!cache?.permits(cached))return budget.rejectTransport('bounded_transport_error');",
    "if(response.status()>=300&&response.status()<400){await response.dispose();return budget.rejectTransport('bounded_redirect_refused');}",
  ],
});
const wiring={
  [BILLING_SPEC]:[
    'readonly targets = assertSandboxConfiguration(env, committedTarget);',
    "const useLocalStack = env.BILLING_SANDBOX_TARGET === 'local-disposable-stack';",
    "requireFact(balance.livemode === false, 'stripe_account_not_test');",
    "const event = await this.stripe(`events/${encodeURIComponent(candidate.id)}`) as unknown as BillingEvent;",
    ".select('event_id,event_type,processed_at').eq('event_id', event.id).maybeSingle();",
    'isCorrelatedDelivery(event, { type, objectId, customer: this.customer }, data) && extra(event)',
    "await this.delivery('checkout.session.completed', this.session);",
    "await this.delivery('invoice.payment_succeeded', renewal.id);",
    "await this.delivery('invoice.payment_failed', failedInvoice);",
    "await this.delivery('invoice.payment_succeeded', failedInvoice);",
    "await this.delivery('customer.subscription.updated', this.subscription, e => e.data.object.cancel_at_period_end === true);",
    "await this.delivery('customer.subscription.deleted', this.subscription);",
    "for (const table of ['account_billing_fences', 'account_checkout_operations', 'account_save_obligations'])",
    'if (readback.error || readback.count !== 0) accountFailed = true;',
    "requireFact(!stripeFailed && !accountFailed && stripeClean && !this.uncertainStripeCreate, 'cleanup_unproven');",
    'for (const journey of BILLING_JOURNEYS)',
    "requireFact(!failed && !cleanupFailed && result.result === 'PASSED', 'journey_incomplete_see_sanitized_receipt');",
  ],
  ...MODEL_WIRING,
  [SOURCE_CONTRACTS[0]]:[
    'const savedId = startOutcome.sessionId;',
    'const outcome = await collectCanaryStopSave(page, {',
    'sessionId: savedId,',
    'waitForSettledTake: () => page.waitForFunction(isOwnedStopSettledInPage, savedId, { timeout: remainingMs() })',
    'reloadSavedTake: () => page.reload({ timeout: remainingMs() })',
  ],
  [SOURCE_CONTRACTS[1]]:[
    'hesitationTotals(transcript, corpus)',
    'corpusRows(corpus, transcript, fillerAnnotationsOf(fixture.entry), fixture.entry.kind)',
    'row.verdict, row.detail,',
    'Object.entries(crossCheckCounts(transcript, productFillerCount))',
    'c.verdict,',
    "humanObservation(receipt, 'open_mic_uh_detected'",
    // #1548: "Back to Dashboard" lands on exactly the canonical /progress list.
    "page.waitForURL((url) => url.pathname === '/progress', { timeout: 30_000 })",
  ],
  [SOURCE_CONTRACTS[3]]:[
    "page.waitForURL((url) => url.pathname === '/progress', { timeout: 30_000 })",
  ],
  [SOURCE_CONTRACTS[4]]:[
    'await page.goto(`/analytics/${persistedId}`);',
    'await expect(page).toHaveURL((url) => url.pathname === `/progress/${persistedId}`, { timeout: 45_000 });',
  ],
  [SOURCE_CONTRACTS[5]]:[
    "expect(analytics.metadata.canonicalRoute).toBe('/progress');",
    "expect(owned.metadata.canonicalRoute).toBe('/progress/:sessionId');",
    "expect(owned.page_url).toBe('/progress/:sessionId');",
  ],
  [SOURCE_CONTRACTS[6]]:[
    "if (request.url().includes('account-closure')) closureCalls.push(request.method());",
    "await page.waitForURL((url) => url.pathname === '/practice', { timeout: 30_000 });",
    "await page.goto('/account');",
    "const link = page.getByTestId('account-delete-link');",
    "await expect(link, 'the Delete account link is on the Account page').toBeVisible({ timeout: 20_000 });",
    "await expect(link).toHaveText('Delete account');",
    "await expect(link).toHaveAttribute('href', '/account/delete');",
    "expect(closureCalls, 'opening Account issues no account-closure request').toEqual([]);",
  ],
};

// Explicit data/document contracts for the dormant sandbox draft, not exclusions from execution.
// They consume the exact selected bytes; their witness can never grant browser/payment credit.
const BILLING_SCOPE_STATEMENTS=Object.freeze([
  'This family is separate from, and does not renumber, the 15 practice journeys.',
  'The committed `sandbox-target.json` is deliberately UNCONFIGURED.',
  'This draft does not implement that privileged cleanup path.',
  'This sandbox family is not full `PAID-01` or `PAID-04` acceptance.',
  'Test-mode Stripe is not Production paid proof.',
  'Both broader requirements remain NOT PROVEN by this draft, regardless of any future sandbox-family PASSED receipts.',
  'No webhook signing secret is accepted.',
]);
function inspectBillingInput(file,source) {
  if(file===BILLING_TARGET) {
    const target=JSON.parse(source);
    const expected={status:'UNCONFIGURED',appOrigin:null,apiOrigin:null,productionApiOrigin:null};
    const valid=value=>value && Object.keys(value).sort().join(',')===Object.keys(expected).sort().join(',')
      && Object.entries(expected).every(([key,want])=>value[key]===want);
    if(!valid(target)) throw new Error('Billing target must remain explicitly unconfigured until separately reviewed');
    const faults=Object.keys(expected).map(key=>({...target,[key]:key==='status'?'REVIEWED_ISOLATED_SANDBOX':'https://unreviewed.example.invalid'}));
    if(faults.some(valid)) throw new Error('Billing target fault escaped');
    return {file,sha256:hash(source),kind:'dormant-sandbox-target',checks:4,detectedFaults:faults.length,
      liveExecution:'NOT RUN',scope:'closed unconfigured target only; no admission or credential use'};
  }
  if(file===BILLING_README) {
    const prose=source.replace(/<!--[\s\S]*?-->/g,'').replace(/\s+/g,' ').trim();
    if(BILLING_SCOPE_STATEMENTS.some(statement=>prose.split(statement).length!==2)) throw new Error('Billing documentation scope contract failed');
    const faults=BILLING_SCOPE_STATEMENTS.map(statement=>prose.replace(statement,'SCOPE_REMOVED'));
    if(faults.some(text=>BILLING_SCOPE_STATEMENTS.every(statement=>text.split(statement).length===2))) throw new Error('Billing documentation fault escaped');
    return {file,sha256:hash(source),kind:'document-scope-contract',checks:BILLING_SCOPE_STATEMENTS.length,
      detectedFaults:faults.length,liveExecution:'NOT RUN',scope:'documented limits only; not billing acceptance'};
  }
  throw new Error('Unregistered billing input');
}

function savedMatchers(ts,parsed) {
  const matches=[];
  const visit=node=>{
    if(ts.isCallExpression(node) && !node.questionDotToken && node.arguments.length===1
      && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text==='saved'
      && ts.isPropertyAccessExpression(node.expression) && !node.expression.questionDotToken
      && node.expression.name.text==='toBe') {
      const assertion=node.expression.expression;
      if(ts.isCallExpression(assertion) && !assertion.questionDotToken
        && ts.isIdentifier(assertion.expression) && assertion.expression.text==='expect'
        && [1,2].includes(assertion.arguments.length)) {
        const actual=assertion.arguments[0];
        if(ts.isPropertyAccessExpression(actual) && !actual.questionDotToken && actual.name.text==='kind'
          && ts.isIdentifier(actual.expression) && actual.expression.text==='outcome'
          && ts.isExpressionStatement(node.parent)) {
          const statements=node.parent.parent?.statements;
          const assertionIndex=statements?.indexOf(node.parent) ?? -1;
          const owners=statements?.filter((statement,index)=>index<assertionIndex && ts.isVariableStatement(statement)
            && (statement.declarationList.flags & ts.NodeFlags.Const)
            && statement.declarationList.declarations.some(item=>ts.isIdentifier(item.name) && item.name.text==='outcome'
              && item.initializer && ts.isAwaitExpression(item.initializer) && ts.isCallExpression(item.initializer.expression)
              && ts.isIdentifier(item.initializer.expression.expression) && item.initializer.expression.expression.text==='collectCanaryStopSave')) || [];
          if(owners.length===1) matches.push(node);
        }
      }
    }
    ts.forEachChild(node,visit);
  };
  visit(parsed);return matches;
}

export function inspectSourceContract(root,file,source=read(root,file)) {
  if(!registeredSourceContract(file)) throw new Error('Unregistered source contract');
  if(file===FIXTURE_GENERATOR) return inspectFixtureGenerator(root,source);
  if(file===BILLING_TARGET || file===BILLING_README) return inspectBillingInput(file,source);
  if(CASE07_SQL[file]) return inspectCase07Sql(file,source);
  if(DATA_CONTRACTS[file]) {
    const problems=dataProblems(root,file,source);
    if(problems.length) throw new Error(`Data contract failed: ${file}; ${problems.join(', ')}`);
    // Negative control per pin, against the consumed bytes: each pinned value, changed, must be refused.
    const doc=JSON.parse(source);
    const escaped=DATA_CONTRACTS[file].pins.filter(([keys])=>{
      const mutant=structuredClone(doc);const parent=keys.slice(0,-1).reduce((value,key)=>value[key],mutant);const last=keys.at(-1);
      if(last==='length'&&Array.isArray(parent)) parent.push(null); else parent[last]=null;
      return !dataProblems(root,file,JSON.stringify(mutant)).length;
    });
    if(escaped.length) throw new Error('Data contract fault escaped');
    return {file,sha256:hash(source),kind:'data-contract',checks:DATA_CONTRACTS[file].pins.length,
      detectedFaults:DATA_CONTRACTS[file].pins.length,...(DATA_CONTRACTS[file].corpus?{audioDigestsChecked:doc.clips.length}:{}),
      evaluatorExecution:'NOT RUN',liveExecution:'NOT RUN'};
  }
  if(TEXT_CONTRACTS[file]) {
    const required=TEXT_CONTRACTS[file];
    if(required.some(fragment=>source.split(fragment).length!==2)) throw new Error(`Text contract failed: ${file}`);
    const controls=required.map(fragment=>source.replace(fragment,'BROKEN_STATEMENT'));
    if(controls.some(mutant=>required.every(fragment=>mutant.split(fragment).length===2))) throw new Error('Text contract fault escaped');
    return {file,sha256:hash(source),kind:'text-contract',checks:required.length,detectedFaults:controls.length,liveExecution:'NOT RUN'};
  }
  if(wiring[file]) {
    const ts=createRequire(path.join(root,'package.json'))('typescript');
    const parsed=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
    if(parsed.parseDiagnostics.length || importsMissing(ts,parsed,file)) throw new Error(`Source wiring contract failed: ${file}; missing real imports or invalid syntax`);
    let savedMatcher=null;
    if(file===SOURCE_CONTRACTS[0]) {
      const matches=savedMatchers(ts,parsed);
      if(matches.length!==1) throw new Error(`Source wiring contract failed: ${file}; missing unique direct positive saved matcher`);
      const match=matches[0];
      const receiver=match.expression.expression.getText(parsed);
      const variants=[`${receiver}.not.toBe('saved')`,`${receiver}; expect(unrelated).toBe('saved')`];
      for(const replacement of variants) {
        const mutant=source.slice(0,match.getStart(parsed))+replacement+source.slice(match.end);
        if(savedMatchers(ts,ts.createSourceFile(file,mutant,ts.ScriptTarget.Latest,true)).length!==0) throw new Error('Saved matcher fault escaped');
      }
      savedMatcher={receiver:'outcome.kind',matcher:'toBe',expected:'saved',
        start:match.getStart(parsed),end:match.end,detectedFaults:variants.length};
    }
    const code=tokens(root,source);
    const required=wiring[file].map(fragment=>tokens(root,fragment));
    if(required.some(fragment=>code.split(fragment).length!==2)) throw new Error(`Source wiring contract failed: ${file}; wire counts ${required.map(fragment=>code.split(fragment).length-1).join(',')}`);
    // Each required wire has a corresponding negative control evaluated against
    // the exact consumed bytes. Never mutate or execute the live spec itself.
    const controls=required.map(fragment=>code.replace(fragment,'BROKEN_WIRE'));
    if(controls.some(mutant=>required.every(fragment=>mutant.split(fragment).length===2))) throw new Error('Source wiring fault escaped');
    return {file,sha256:hash(source),kind:'wiring-contract',checks:required.length+(savedMatcher?1:0),
      detectedFaults:controls.length+(savedMatcher?.detectedFaults || 0),...(savedMatcher?{savedMatcher}:{}),
      liveExecution:'NOT RUN',scope:'registered wiring only; live test body not executed'};
  }
  return inspectFixture(root,source,read(root,FIXTURE_GENERATOR));
}

function inspectFixture(root,source,generatorSource) {
  const file=SOURCE_CONTRACTS[2];
  const manifest=JSON.parse(source);
  const entry=manifest.fixtures?.open_mic_tts;
  const script=generatorSource.match(/^OPEN_MIC="([^"\n]+)"$/m)?.[1];
  if(!script || entry?.kind!=='synthetic' || !/^[a-f0-9]{64}$/.test(entry.sha256 || '')
    || !entry.knownFixtureLimits?.some(value=>/human recording/i.test(value))) throw new Error('Missing fixture scope/identity');
  const {items,sourceSha256:referenceSha256}=fixtureReference(root,entry);
  if(!Array.isArray(items) || items.length!==8) throw new Error('Missing fixture annotations');
  const counts={};let cursor=0;
  for(const {word,anchor} of items) {
    if(!['um','uh','you know'].includes(word) || typeof anchor!=='string' || !anchor) throw new Error('Invalid fixture annotation');
    const needle=`${word}, ${anchor}`.toLowerCase();
    const at=script.toLowerCase().indexOf(needle,cursor);
    if(at<0) throw new Error('Fixture annotation not consumed from generator script');
    cursor=at+needle.length;counts[word]=(counts[word] || 0)+1;
  }
  if(JSON.stringify(Object.entries(counts).sort())!==JSON.stringify(Object.entries(entry.groundTruthFillers || {}).sort())) throw new Error('Fixture count/reference disagreement');
  return {file,sha256:hash(source),generatorSha256:hash(generatorSource),
    referenceSha256,kind:'fixture-consumption',annotationSource:'reviewed code; script-derived, not audio-bound',annotationCount:items.length,counts,liveExecution:'NOT RUN',audioExecution:'NOT RUN'};
}

// Explicit source consumption, not shell execution. Reject additional commands and altered
// generation settings rather than treating arbitrary .sh files as qualified.
const GENERATOR_COMMANDS=[
  "set -euo pipefail",
  "cd \"$(dirname \"$0\")\"",
  "VOICE=Samantha",
  "RATE=150",
  "TRAILING_SILENCE_S=15",
  "OPEN_MIC=\"<script>\"",
  "FOCUS_POINTS=\"<script>\"",
  "FOCUS_POINTS_PARTIAL=\"<script>\"",
  "make() { # name text",
  "say -v \"$VOICE\" -r \"$RATE\" -o \"$1.aiff\" \"$2\"",
  "ffmpeg -loglevel error -y -i \"$1.aiff\" -af \"apad=pad_dur=${TRAILING_SILENCE_S}\" -ar 16000 -ac 1 -sample_fmt s16 -bitexact -map_metadata -1 \"$1.wav\"",
  "rm -f \"$1.aiff\"",
  "printf '%s  %s  speech+silence=%ss\\n' \"$(shasum -a 256 \"$1.wav\" | cut -c1-64)\" \"$1.wav\" \"$(ffprobe -v error -show_entries format=duration -of csv=p=0 \"$1.wav\")\"",
  "}",
  "make open_mic_tts \"$OPEN_MIC\"",
  "make focus_points_tts \"$FOCUS_POINTS\"",
  "make focus_points_partial_tts \"$FOCUS_POINTS_PARTIAL\""
];
// Reviewed public TTS input texts, not audio digests. A script change requires explicit re-review.
const GENERATOR_SCRIPT_SHA256={
  "OPEN_MIC": "8e08aa6cdb6d45d2af3b282c318a6fb9872effd8eac2da77e6e24b27d55d4462",
  "FOCUS_POINTS": "9e7f3f609b8d1a31d3c52b101ce85e5324dd4198e34d5db785e3ee2c2508f316",
  "FOCUS_POINTS_PARTIAL": "f0bf65deccea4609fff070cf1e597406db55ac58a2109ce6924a1c03bd89f869"
};
function inspectFixtureGenerator(root,source) {
  const names=['OPEN_MIC','FOCUS_POINTS','FOCUS_POINTS_PARTIAL'];
  const declarations={};
  const lines=source.split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!line.startsWith('#')).map(line=>{
    const name=names.find(n=>line.startsWith(`${n}=`));
    if(!name) return line;
    const match=new RegExp(`^${name}="([^"\\n]+)"$`).exec(line);
    if(!match||/[\x24`\\]/.test(match[1])||Object.hasOwn(declarations,name)) throw new Error('Unsafe/duplicate generator declaration');
    declarations[name]=match[1];return `${name}="<script>"`;
  });
  if(JSON.stringify(lines)!==JSON.stringify(GENERATOR_COMMANDS)||names.some(n=>!declarations[n])) throw new Error('Generator command/settings contract failed');
  if(names.some(name=>hash(declarations[name])!==GENERATOR_SCRIPT_SHA256[name])) throw new Error('Generator script text differs from reviewed input');
  const manifestSource=read(root,SOURCE_CONTRACTS[2]);
  const manifest=JSON.parse(manifestSource);
  for(const key of ['open_mic_tts','focus_points_tts','focus_points_partial_tts']) {
    const entry=manifest.fixtures?.[key];
    if(entry?.file!==`${key}.wav`||entry.kind!=='synthetic'||!/^[a-f0-9]{64}$/.test(entry.sha256||'')) throw new Error('Generator manifest target mismatch');
  }
  const proof=inspectFixture(root,manifestSource,source);
  return {...proof,file:FIXTURE_GENERATOR,sha256:hash(source),manifestSha256:hash(manifestSource),
    kind:'generator-source-consumption',scriptSha256:{...GENERATOR_SCRIPT_SHA256},scriptExecution:'NOT RUN',
    scope:'declared synthesis commands/settings and script-to-reference wiring only; macOS TTS/ffmpeg and audio not executed'};
}

export function sourceContractBinding(root,files) {
  if(!Array.isArray(files) || !files.length || new Set(files).size!==files.length || files.some(file=>!registeredSourceContract(file))) throw new Error('Unknown/duplicate source contract input');
  if(files.some(file=>!sourceContractApplicability(root,file).supported)) throw new Error('Unsupported source contract input or consumer');
  const dependencies=[...files,SOURCE_CONSUMER,'scripts/lib/sourceContractEvidence.mjs'];
  if(files.includes(SOURCE_CONTRACTS[2])||files.includes(FIXTURE_GENERATOR)) dependencies.push(SOURCE_CONTRACTS[2],FIXTURE_GENERATOR,FILLER_REFERENCE);
  for(const file of files) if(DATA_CONTRACTS[file]?.corpus) dependencies.push(...corpusAudio(root,file));
  return [...new Set(dependencies)].map(file=>({file,sha256:hash(read(root,file))}));
}

export function consumeSourceContracts(root,binding) {
  const selected=binding?.sourceContract;
  if(!selected || binding.testFile!==path.join(binding.cwd,SOURCE_CONSUMER)
    || JSON.stringify(selected.sourceBinding)!==JSON.stringify(sourceContractBinding(root,selected.files))) throw new Error('Stale or missing source contract consumer');
  return {schemaVersion:1,phaseId:binding.phaseId,bindingSha256:hash(JSON.stringify(binding)),
    assertion:SOURCE_ASSERTION,liveExecution:'NOT RUN',proofs:selected.files.map(file=>inspectSourceContract(root,file))};
}

export function validateSourceContractWitness(raw,binding,root,report,envelope) {
  if(binding?.sourceContract?.witnessFile!==path.join(binding.cwd,`.source-contract-${binding.phaseId}.json`)
    || JSON.stringify(raw)!==JSON.stringify(consumeSourceContracts(root,binding))) throw new Error('Wrong source contract witness/identity or fake live credit');
  const assertions=report?.testResults?.flatMap(file=>file.assertionResults || []) || [];
  const tasks=envelope?.finished?.files?.flatMap(file=>file.tasks || []) || [];
  if(assertions.filter(item=>item.fullName===SOURCE_ASSERTION && item.status==='passed').length!==1
    || tasks.filter(item=>item.type==='test' && item.name===SOURCE_ASSERTION && item.result?.state==='pass').length!==1) throw new Error('Source contract consumer did not execute');
  return binding.sourceContract.files;
}
