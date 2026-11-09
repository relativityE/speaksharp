'use strict';
// Offline source-node extraction only. Does not execute repository code or access a network.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ts=require('/workspace/scratch/9556fdac6486/speaksharp-case12/node_modules/typescript/lib/typescript.js');
const root='/workspace/shared/fifteen-case-ci-map/source/tests/live/helpers';
const definitions=[['rwtOracles.ts',['newSetSourcePoints','newSetEditVerdicts','setupIsBlank','labelHeardIn','switchIsolationVerdict','focusBackReloadVerdict']],['rwtJourney.ts',['REPEAT_START_CEILING_MS','repeatStartVerdict','sameOrderedPendingSet']]];
let out='';const sources={};
for(const [file,names]of definitions){const s=fs.readFileSync(path.join(root,file),'utf8'),tree=ts.createSourceFile(file,s,ts.ScriptTarget.Latest,true),allow=new Set(names);sources[file]={sha256:crypto.createHash('sha256').update(s).digest('hex'),selectedDeclarations:names};out+=tree.statements.filter(n=>ts.isFunctionDeclaration(n)?allow.has(n.name?.text):ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>allow.has(d.name.getText(tree)))).map(n=>n.getFullText(tree)).join('\n');}
const c=ts.transpileModule(out,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
if(/require\(/.test(c))throw Error('unexpected runtime import');
fs.writeFileSync(path.join(__dirname,'oracles/pure/extendedJourney.cjs'),'// Exact-source declarations from main70e; see extendedJourney.provenance.json.\n'+c);
fs.writeFileSync(path.join(__dirname,'oracles/pure/extendedJourney.provenance.json'),JSON.stringify({sourceSha:'70e194a4422dd7b6a13ed542134941d1eaa9ea87',method:'TypeScript AST declaration selection and transpile; no source execution',sources},null,2));
