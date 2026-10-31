#!/usr/bin/env node
'use strict';
// browser-setup.cjs --playwright <version> --revision <chromium-NNNN> --existing-browser <path> --existing-browser-sha256 <sha256> [--out <browser.json>]
// Browser binding for the guarded lane. Requires the same existing browser path and bytes that the
// outer setup stage verified, while separately recording the installed Playwright runtime. Copies it to the
// 65534-traversable root /var/tmp/ss-harness/chrome-linux, installs chrome-wrapper.sh, and writes
// browser.json for Playwright (executablePath) and Lighthouse (CHROME_PATH). Exit 0 only when the
// copy and wrapper are byte-checked and `--version` runs through the wrapper as 65534.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const { assertSecurityApproval } = require('./approval-gate.cjs');
const {childEnvironment,strictPairs}=require('./launch-boundary.cjs');
const ROOT = '/var/tmp/ss-harness';
function fail(msg) { console.error('browser-setup: BLOCKED_SETUP: ' + msg); process.exit(2); }
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

function copyBoundBrowser({sourceExecutable,expectedSha256,root=ROOT,
  copyDirectory=(source,destination)=>execFileSync('cp',['-a','--no-preserve=ownership',source+'/.',destination+'/'],{stdio:'inherit'}),
  preparePrivateDirectory=(target)=>{fs.mkdirSync(target,{recursive:true});fs.chownSync(target,65534,65534);fs.chmodSync(target,0o700);},
  setOwnership=(target)=>execFileSync('chown',['-R','0:0',target]),
  setPermissions=(target)=>execFileSync('chmod',['-R','a+rX,go-w',target]),
  setWrapperOwnership=(target)=>fs.chownSync(target,0,0)}) {
 if (!path.isAbsolute(sourceExecutable) || !fs.existsSync(sourceExecutable)) throw new Error('bound existing browser is missing or not absolute');
 const st=fs.lstatSync(sourceExecutable);
 if (!st.isFile() || st.isSymbolicLink() || fs.realpathSync(sourceExecutable)!==path.resolve(sourceExecutable)) throw new Error('bound existing browser must be a canonical regular file');
 if (!/^[a-f0-9]{64}$/.test(expectedSha256||'') || sha(sourceExecutable)!==expectedSha256) throw new Error('bound existing browser bytes changed after outer setup');
 const srcDir=path.dirname(sourceExecutable);
 fs.mkdirSync(root,{recursive:true,mode:0o755});
 fs.chmodSync(root,0o755);
 for (const d of ['profiles','home','downloads']) {
  const p=path.join(root,d);
  preparePrivateDirectory(p);
 }
 const dst=path.join(root,'chrome-linux');
 fs.rmSync(dst,{recursive:true,force:true});
 copyDirectory(srcDir,dst);
 if(path.basename(sourceExecutable)!=='chrome')fs.copyFileSync(path.join(dst,path.basename(sourceExecutable)),path.join(dst,'chrome'));
 setOwnership(dst);setPermissions(dst);
 if(sha(sourceExecutable)!==expectedSha256)throw new Error('bound existing browser bytes changed during copy');
 if(sha(path.join(dst,'chrome'))!==expectedSha256)throw new Error('copied chrome binary differs from the source');
 const wrapperSrc=path.join(__dirname,'chrome-wrapper.sh');
 const wrapper=path.join(root,'chrome-wrapper.sh');
 fs.copyFileSync(wrapperSrc,wrapper);setWrapperOwnership(wrapper);fs.chmodSync(wrapper,0o755);
 if(sha(wrapper)!==sha(wrapperSrc))throw new Error('installed wrapper differs from the bundle copy');
 return{dst,wrapper,sourceExecutable,copiedExecutable:path.join(dst,'chrome'),profilesRoot:path.join(root,'profiles'),downloadsPath:path.join(root,'downloads')};
}

function main(){
 let args;try{args=strictPairs(process.argv.slice(2),['playwright','revision','existing-browser','existing-browser-sha256','out','security-approval'],['playwright','revision','existing-browser','existing-browser-sha256','security-approval']);}catch(e){console.error('browser-setup: '+e.message);process.exit(2);}
 try{assertSecurityApproval({securityApprovalFile:args['security-approval']},{hosts:{}});}catch(e){fail(e.message);}
 if(!args.playwright||!/^chromium-\d+$/.test(args.revision||'')||!/^[a-f0-9]{64}$/.test(args['existing-browser-sha256']||''))fail('usage: --playwright <version> --revision chromium-NNNN --existing-browser <path> --existing-browser-sha256 <sha256>');
 let pwPkg,chromium;try{pwPkg=require(require.resolve('playwright/package.json',{paths:[process.cwd()]}));chromium=require(require.resolve('playwright',{paths:[process.cwd()]})).chromium;}catch(e){fail('playwright is not resolvable from '+process.cwd());}
 if(pwPkg.version!==args.playwright)fail(`playwright ${pwPkg.version} installed, ${args.playwright} required`);
 const expected=chromium.executablePath();if(!expected.split(path.sep).includes(args.revision))fail(`Playwright metadata expects ${expected}, not revision ${args.revision}`);
 let copied;try{copied=copyBoundBrowser({sourceExecutable:args['existing-browser'],expectedSha256:args['existing-browser-sha256']});}catch(e){fail(e.message);}
 let version;try{version=execFileSync(copied.wrapper,['--version'],{encoding:'utf8',timeout:20000,env:childEnvironment({node:process.execPath,bundleRoot:path.resolve(__dirname,'..'),approvalFile:path.resolve(args['security-approval']),mode:'version-probe'})}).trim();}catch(e){fail('chrome --version through the wrapper failed: '+(e.stderr||e.message));}
 const out={playwrightVersion:pwPkg.version,revision:args.revision,chromeVersion:version,sourceExecutable:copied.sourceExecutable,chromeSha256:sha(copied.sourceExecutable),copiedExecutable:copied.copiedExecutable,wrapperPath:copied.wrapper,wrapperSha256:sha(copied.wrapper),runAsUid:65534,profilesRoot:copied.profilesRoot,downloadsPath:copied.downloadsPath};
 const outPath=args.out||path.join(ROOT,'browser.json');fs.writeFileSync(outPath,JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out,null,2));
}

if(require.main===module)main();
module.exports={copyBoundBrowser};
