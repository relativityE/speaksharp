import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

// Mirror only the ordinary Vitest collection envelope, not actual execution.
const relevantPath=/(?:\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)(?:test_[^/]+\.py|[^/]+_test\.[jt]s)$)/;
const vitestCandidatePath=/^(?:frontend\/(?:src|tests)\/|tests\/).*\.test\.[jt]sx?$/;
const excludedPath=/(?:^|\/)(?:node_modules|dist|build|test-support)(?:\/|$)/;
const fullSha=/^[a-f0-9]{40}$/;

function parseSource(file,contents) {
  const source=ts.createSourceFile(file,contents,ts.ScriptTarget.Latest,true);
  const options={noResolve:true,noLib:true,allowJs:true,checkJs:true,jsx:ts.JsxEmit.Preserve};
  const host=ts.createCompilerHost(options);
  host.getSourceFile=name=>name===file?source:undefined;
  const program=ts.createProgram([file],options,host);
  return {source,checker:program.getTypeChecker()};
}

function bindingOf(checker,id) {
  if(!ts.isIdentifier(id))return null;
  const declarations=checker.getSymbolAtLocation(id)?.declarations??[];
  if(declarations.length!==1)return null;
  const decl=declarations[0];
  if(ts.isImportSpecifier(decl)) {
    const statement=decl.parent.parent.parent;
    if(ts.isImportDeclaration(statement)&&ts.isStringLiteral(statement.moduleSpecifier))
      return {module:statement.moduleSpecifier.text,name:(decl.propertyName??decl.name).text};
  }
  if(ts.isImportClause(decl) && decl.name && ts.isImportDeclaration(decl.parent)
    && ts.isStringLiteral(decl.parent.moduleSpecifier))return {module:decl.parent.moduleSpecifier.text,name:'default'};
  return null;
}

const isCallback=node=>node && (ts.isArrowFunction(node)||ts.isFunctionExpression(node));
const emptyBody=callback=>ts.isBlock(callback.body)&&callback.body.statements.every(node=>
  ts.isEmptyStatement(node)||(ts.isReturnStatement(node)&&!node.expression));

const nodeAssertMethods=new Set(['ok','equal','notEqual','strictEqual','notStrictEqual','deepEqual','notDeepEqual',
  'deepStrictEqual','notDeepStrictEqual','fail','ifError','match','doesNotMatch','throws','doesNotThrow','rejects','doesNotReject']);
function matcherRoot(node) {
  let current=node;
  while(ts.isPropertyAccessExpression(current))current=current.expression;
  return ts.isCallExpression(current)?current.expression:null;
}

// Recognize the trailing timeout overload only with a safe integer literal.
const literalTimeout=node=>ts.isNumericLiteral(node) && Number.isSafeInteger(Number(node.text)) && Number(node.text)>=0;

function assertionForm(callback,checker) {
  let sawForm=false;
  const visit=node=>{
    // An assertion inside another function might never run. Don't infer it.
    if(node!==callback.body && ts.isFunctionLike(node))return;
    // Ignore provably unreachable literal branches without speculating on control flow.
    if(ts.isIfStatement(node)) {
      if(node.expression.kind===ts.SyntaxKind.FalseKeyword) {if(node.elseStatement)visit(node.elseStatement);return;}
      if(node.expression.kind===ts.SyntaxKind.TrueKeyword) {visit(node.thenStatement);return;}
    }
    if(ts.isCallExpression(node)) {
      const property=ts.isPropertyAccessExpression(node.expression)?node.expression:null;
      const binding=bindingOf(checker,property?.expression??node.expression);
      const name=property?.name.text;
      const matcher=property?bindingOf(checker,matcherRoot(property)??node):null;
      if(matcher?.module==='vitest'&&matcher.name==='expect'
        || binding?.module==='vitest'&&binding.name==='assert'&&(!name||nodeAssertMethods.has(name))
        || ['node:assert','node:assert/strict'].includes(binding?.module)
          && (binding.name==='default'?(!name||nodeAssertMethods.has(name)):!name&&nodeAssertMethods.has(binding.name)))
        sawForm=true;
    }
    if(!sawForm)ts.forEachChild(node,visit);
  };
  visit(callback.body);
  return sawForm;
}

export function inspectChangedTest(pathname,contents) {
  if(!vitestCandidatePath.test(pathname)||excludedPath.test(pathname))
    return {path:pathname,runner:'UNKNOWN',cases:[],note:'Outside ordinary Vitest candidate paths'};
  const {source,checker}=parseSource(pathname,contents);
  if(source.parseDiagnostics.length)
    return {path:pathname,runner:'UNKNOWN',cases:[],note:'Source parser reported a syntax error'};
  const cases=[];
  function visit(node) {
    if(ts.isCallExpression(node)) {
      const target=ts.isPropertyAccessExpression(node.expression)?node.expression.expression:node.expression;
      const modifier=target===node.expression?null:node.expression.name.text;
      const binding=bindingOf(checker,target);
      if(binding?.module==='vitest'&&['it','test'].includes(binding.name)) {
        const [title,callback,...extra]=node.arguments;
        const line=source.getLineAndCharacterOfPosition(node.getStart(source)).line+1;
        const label=title&&ts.isStringLiteralLike(title)?title.text:null;
        let code='UNKNOWN';
        if(['skip','todo','only'].includes(modifier))code='EXPLICIT_RUNNER_MODIFIER';
        else if(modifier===null&&label!==null&&isCallback(callback)
          &&(extra.length===0||(extra.length===1&&literalTimeout(extra[0]))))
          code=emptyBody(callback)?'EMPTY_CALLBACK':assertionForm(callback,checker)?'ASSERTION_FORM_OBSERVED':'UNKNOWN';
        cases.push({line,title:label,code});
      }
    }
    ts.forEachChild(node,visit);
  }
  visit(source);
  return cases.length
    ?{path:pathname,runner:'VITEST_SOURCE_CANDIDATE',cases}
    :{path:pathname,runner:'UNKNOWN',cases,note:'No supported case registration recognized'};
}

const git=(root,...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024});
export function changedTestIntegrityReport(root,{base,head}) {
  if(!fullSha.test(base??'')||!fullSha.test(head??''))throw new Error('Report requires exact --base and --head commit SHAs');
  const top=git(root,'rev-parse','--show-toplevel').trim();
  if(path.resolve(root)!==top)throw new Error('Run from the repository root');
  for(const revision of [base,head])if(git(root,'cat-file','-t',revision).trim()!=='commit')throw new Error('Report requires commits');
  const paths=git(root,'diff','--no-renames','--diff-filter=ADMT','--name-only','-z',base,head,'--')
    .split('\0').filter(file=>relevantPath.test(file)).sort();
  const files=paths.map(file=>{
    const entry=git(root,'ls-tree','-z',head,'--',`:(literal)${file}`);
    if(!/^100(?:644|755) blob /.test(entry))
      return {path:file,runner:'UNKNOWN',cases:[],note:'Not a regular test source in the target commit'};
    return inspectChangedTest(file,git(root,'show',`${head}:${file}`));
  });
  return {schemaVersion:1,mode:'REPORT_ONLY',base,head,execution:'NOT_VERIFIED',
    scope:'Exact changed commits; explicit Vitest imports and literal callbacks only. No runtime or behavioral proof.',
    files};
}

/** Hosted report takes its pair from the same-run canonical origin, never a fallback branch. */
export function changedCiIntegrityReport(root, env) {
  const base=env.TEST_EFFICACY_BASE, head=env.TEST_EFFICACY_HEAD;
  if (![base,head].every((sha)=>fullSha.test(sha??'')) || env.GITHUB_SHA!==head
    || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID??'') || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT??'')
    || git(root,'rev-parse','HEAD').trim()!==head) throw new Error('Unbound advisory comparison');
  const origin=JSON.parse(readFileSync(path.join(root,'artifacts/software-quality-input-origin.json'),'utf8'));
  const expected={runId:env.GITHUB_RUN_ID,runAttempt:env.GITHUB_RUN_ATTEMPT,commit:head};
  if(origin.schemaVersion!==1 || origin.comparisonBase!==base
    || Object.entries(expected).some(([k,v])=>origin.originatingCi?.[k]!==v || origin.qualityProvenance?.[k]!==v))
    throw new Error('Unbound advisory quality origin');

  const report=changedTestIntegrityReport(root,{base,head});
  // Source names and verdict codes only. No test titles, code, assertion text or parser messages.
  return {...report,originatingCi:expected,files:report.files.map(({path:filename,runner,cases})=>{
    const before=git(root,'ls-tree','-z',base,'--',`:(literal)${filename}`);
    const count=(values)=>Object.fromEntries([...new Set(values)].sort().map(code=>[code,values.filter(v=>v===code).length]));
    const previous=/^100(?:644|755) blob /.test(before)?inspectChangedTest(filename,git(root,'show',`${base}:${filename}`)).cases:[];
    const old=count(previous.map(c=>c.code)), current=count(cases.map(c=>c.code));
    const changes=Object.fromEntries([...new Set([...Object.keys(old),...Object.keys(current)])].sort()
      .map(code=>[code,(current[code]??0)-(old[code]??0)]).filter(([,delta])=>delta!==0));
    return {path:filename,runner,change:before?'existing-path-changed':'new-path',counts:current,delta:changes};
  })};
}
