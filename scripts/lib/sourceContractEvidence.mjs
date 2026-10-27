import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const SOURCE_CONSUMER='tests/unit/sourceContractEvidence.test.js';
export const SOURCE_ASSERTION='consumes registered source inputs with fault-sensitive contracts and no live credit';
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
]);
// Real (non-type, unrenamed) imports a wiring contract requires; route contracts require none.
const REQUIRED_IMPORTS=Object.freeze({
  [SOURCE_CONTRACTS[0]]:{module:'./canaryStopSaveOracle',names:['collectCanaryStopSave','isOwnedStopSettledInPage','startOwnerId']},
  [SOURCE_CONTRACTS[1]]:{module:'./helpers/rwtFillerReference',names:['corpusRows','crossCheckCounts','fillerAnnotationsOf','hesitationTotals']},
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

export function sourceContractApplicability(root,file) {
  if(!registeredSourceContract(file)) return {supported:false,reason:'unregistered source contract'};
  try {read(root,SOURCE_CONSUMER);} catch {return {supported:false,reason:'source contract consumer unavailable or aliased'};}
  try {
    const source=read(root,file);
    if(file===SOURCE_CONTRACTS[2]) {
      const entry=JSON.parse(source).fixtures?.open_mic_tts;
      if(!entry?.fillerAnnotations || !Array.isArray(entry.fillerAnnotations.items)
        || typeof entry.fillerAnnotations.source!=='string') return {supported:false,reason:'receiving fixture annotations unavailable'};
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

const wiring={
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
  const manifest=JSON.parse(source);
  const entry=manifest.fixtures?.open_mic_tts;
  const script=read(root,'tests/fixtures/rwt/generate-rwt-tts-fixtures.sh').match(/^OPEN_MIC="([^"\n]+)"$/m)?.[1];
  if(!script || entry?.kind!=='synthetic' || !/^[a-f0-9]{64}$/.test(entry.sha256 || '')
    || !entry.fillerAnnotations?.source?.includes('not audio-bound')
    || !entry.knownFixtureLimits?.some(value=>/human recording/i.test(value))) throw new Error('Missing fixture scope/identity');
  const items=entry.fillerAnnotations.items;
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
  return {file,sha256:hash(source),generatorSha256:hash(read(root,'tests/fixtures/rwt/generate-rwt-tts-fixtures.sh')),
    kind:'fixture-consumption',annotationCount:items.length,counts,liveExecution:'NOT RUN',audioExecution:'NOT RUN'};
}

export function sourceContractBinding(root,files) {
  if(!Array.isArray(files) || !files.length || new Set(files).size!==files.length || files.some(file=>!registeredSourceContract(file))) throw new Error('Unknown/duplicate source contract input');
  if(files.some(file=>!sourceContractApplicability(root,file).supported)) throw new Error('Unsupported source contract input or consumer');
  const dependencies=[...files,SOURCE_CONSUMER,'scripts/lib/sourceContractEvidence.mjs'];
  if(files.includes(SOURCE_CONTRACTS[2])) dependencies.push('tests/fixtures/rwt/generate-rwt-tts-fixtures.sh');
  return dependencies.map(file=>({file,sha256:hash(read(root,file))}));
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
