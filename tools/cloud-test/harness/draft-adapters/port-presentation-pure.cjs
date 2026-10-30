'use strict';
// Offline declaration extraction only. Never imports or executes a repository suite.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ts=require('/workspace/scratch/9556fdac6486/speaksharp-case12/node_modules/typescript/lib/typescript.js');
const root='/workspace/shared/fifteen-case-ci-map/source/';
const selected=[
 ['tests/live/helpers/rwtJourney.ts',['countWords','normalisePhraseText']],
 ['tests/live/rwt-open-mic-first-session.live.spec.ts',['COACHING_WORD_TARGET','COACHING_WORD_TARGET_MIN','WELL_HEADINGS','NEXT_HEADINGS','samePhrase']],
 ['tests/live/helpers/rwtFocusPointsJourney.ts',['GUIDE_SECONDS','AVERAGE_TOLERANCE_SECONDS','parseClock']],
 ['tests/live/helpers/rwtPaceGuide.ts',['PACE_GUIDE_DEFAULT_SECONDS','parsePaceGuideSeconds']]
];
let text='';const sources={};
for(const [name,names] of selected){const file=name.endsWith('rwtPaceGuide.ts')?path.join(__dirname,'source/rwtPaceGuide.ts'):path.join(root,name);const s=fs.readFileSync(file,'utf8'),tree=ts.createSourceFile(name,s,ts.ScriptTarget.Latest,true),found=[];
 const nodes=tree.statements.filter(n=>{const namesHere=ts.isFunctionDeclaration(n)?[n.name?.text]:ts.isVariableStatement(n)?n.declarationList.declarations.map(d=>d.name.getText(tree)):[];if(namesHere.some(x=>names.includes(x))){found.push(...namesHere);return true;}return false;});
 if(names.some(n=>!found.includes(n)))throw Error('missing exact source declaration');text+=nodes.map(n=>n.getFullText(tree)).join('\n')+'\n';sources[name]={sha256:crypto.createHash('sha256').update(s).digest('hex'),gitBlobSha1:crypto.createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex'),declarations:names};
}
const reviewed=fs.readFileSync(path.join(__dirname,'source/coachingExternal.ts'),'utf8');sources['tests/live/helpers/coachingExternal.ts']={sha256:crypto.createHash('sha256').update(reviewed).digest('hex'),gitBlobSha1:crypto.createHash('sha1').update('blob '+Buffer.byteLength(reviewed)+'\0').update(reviewed).digest('hex'),reviewedOnly:['successDependentRow: absent success stays unexercised; never invent EXTERNAL authority'],url:'https://github.com/relativityE/speaksharp/blob/70e194a4422dd7b6a13ed542134941d1eaa9ea87/tests/live/helpers/coachingExternal.ts'};
text+='\nexport { COACHING_WORD_TARGET, COACHING_WORD_TARGET_MIN, WELL_HEADINGS, NEXT_HEADINGS, samePhrase, GUIDE_SECONDS, AVERAGE_TOLERANCE_SECONDS, parseClock };';
const out=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;if(/require\(/.test(out))throw Error('unexpected source runtime import');
fs.writeFileSync(path.join(__dirname,'oracles/pure/presentationSelected.cjs'),'// Exact selected declarations; presentationSelected.provenance.json.\n'+out);
fs.writeFileSync(path.join(__dirname,'oracles/pure/presentationSelected.provenance.json'),JSON.stringify({sourceSha:'70e194a4422dd7b6a13ed542134941d1eaa9ea87',method:'TypeScript AST declaration extraction/transpile; no repository execution',retrievedPaceSource:'https://github.com/relativityE/speaksharp/blob/70e194a4422dd7b6a13ed542134941d1eaa9ea87/tests/live/helpers/rwtPaceGuide.ts',sources},null,2)+'\n');
