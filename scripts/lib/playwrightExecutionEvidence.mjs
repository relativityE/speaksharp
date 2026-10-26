import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

export const PLAYWRIGHT_RECEIPT_VERSION=1;
export const PLAYWRIGHT_VERSION='1.57.0';
export const MAX_BLOB_BYTES=32*1024*1024;
export const MAX_REPORT_BYTES=64*1024*1024;
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const requireFrom=root=>createRequire(path.join(root,'node_modules/playwright/package.json'));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export function playwrightRuntimeIdentity(root) {
  const packageFile=path.join(root,'node_modules/playwright/package.json');
  const require=requireFrom(root);
  const corePackage=require.resolve('playwright-core/package.json');
  const files=[['playwright-package',packageFile],['core-package',corePackage],
    ...['blob.js','teleEmitter.js','multiplexer.js'].map(name=>[name,path.join(path.dirname(fs.realpathSync(packageFile)),'lib/reporters',name)]),
    ...['zipBundle.js','zipBundleImpl.js'].map(name=>[name,path.join(path.dirname(corePackage),'lib',name)]),
    ['producer',path.join(root,'scripts/efficacy-playwright-reporter.mjs')],
    ['validator',path.join(root,'scripts/lib/playwrightExecutionEvidence.mjs')]];
  for(const file of [packageFile,corePackage]) {
    if(JSON.parse(fs.readFileSync(file,'utf8')).version!==PLAYWRIGHT_VERSION) throw new Error('Unsupported Playwright runtime');
  }
  return {version:PLAYWRIGHT_VERSION,node:process.version,platform:process.platform,arch:process.arch,
    files:files.map(([name,file])=>({name,sha256:digest(fs.readFileSync(file))}))};
}

// Use the installed, byte-bound SDK ZIP reader. Attachments are never executed or unpacked.
export async function readBlobReport(root,bytes) {
  if(!Buffer.isBuffer(bytes) || !bytes.length || bytes.length>MAX_BLOB_BYTES) throw new Error('Invalid or oversized Playwright blob');
  const {yauzl}=requireFrom(root)('playwright-core/lib/zipBundle');
  return new Promise((resolve,reject)=>{
    yauzl.fromBuffer(bytes,{lazyEntries:true,validateEntrySizes:true},(error,zip)=>{
      if(error)return reject(error);
      let report=null,settled=false,entries=0;
      const finish=(failure)=>{
        if(settled)return;settled=true;
        if(failure){zip.close();reject(failure);}else if(report===null)reject(new Error('Missing report.jsonl'));
        else resolve(report);
      };
      zip.on('error',finish);
      zip.on('end',()=>finish());
      zip.on('entry',entry=>{
        if(++entries>100000)return finish(new Error('Too many blob entries'));
        if(entry.fileName!=='report.jsonl'){zip.readEntry();return;}
        if(report!==null || entry.uncompressedSize>MAX_REPORT_BYTES)return finish(new Error('Duplicate or oversized report.jsonl'));
        zip.openReadStream(entry,(failure,stream)=>{
          if(failure)return finish(failure);
          const chunks=[];let length=0;
          stream.on('error',finish);
          stream.on('data',chunk=>{
            length+=chunk.length;
            if(length>MAX_REPORT_BYTES){stream.destroy();finish(new Error('Oversized expanded report'));}
            else chunks.push(chunk);
          });
          stream.on('end',()=>{
            if(settled)return;
            try {report=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));zip.readEntry();}
            catch(failure){finish(failure);}
          });
        });
      });
      zip.readEntry();
    });
  });
}

function evidenceFile(root,rootDir,file) {
  if(typeof root!=='string' || !path.isAbsolute(root) || typeof rootDir!=='string' || !path.isAbsolute(rootDir)
    || typeof file!=='string' || !file || file.includes('\\'))throw new Error('Malformed Playwright file identity');
  const relative=path.relative(root,path.resolve(rootDir,file)).split(path.sep).join('/');
  if(!/^tests\/e2e\/.+\.spec\.[jt]s$/.test(relative) || relative.split('/').includes('..')) {
    throw new Error('Playwright collection outside ordinary E2E scope');
  }
  return relative;
}

// Replay actual SDK events, never final totals alone. Retries/skips/errors do not earn credit.
export function replayBlobLifecycle(jsonl,{repositoryRoot,shard,commit}={}) {
  if(typeof jsonl!=='string' || Buffer.byteLength(jsonl)>MAX_REPORT_BYTES)throw new Error('Invalid raw Playwright report');
  let records;
  try {records=jsonl.trim().split('\n').map(line=>JSON.parse(line));}
  catch(cause){throw new Error('Malformed Playwright JSONL',{cause});}
  const unique=method=>{
    const matches=records.filter(item=>item.method===method);
    if(matches.length!==1)throw new Error(`Missing/duplicate Playwright ${method}`);
    return matches[0].params;
  };
  const metadata=unique('onBlobReportMetadata');
  const config=unique('onConfigure')?.config;
  if(metadata?.version!==2 || !metadata.userAgent?.startsWith(`Playwright/${PLAYWRIGHT_VERSION} `)
    || !same(metadata.shard,shard) || config?.version!==PLAYWRIGHT_VERSION)throw new Error('Wrong blob/runtime/shard identity');
  if(!Number.isInteger(shard?.current) || shard.current<1 || shard.total!==4 || shard.current>4)throw new Error('Wrong Playwright shard');
  for(const value of [config?.metadata?.ci?.commitHash,config?.metadata?.gitCommit?.hash]) {
    if(value!==undefined && value!==commit)throw new Error('Wrong blob source commit');
  }
  unique('onBegin');
  const terminal=unique('onEnd');
  // A test may deliberately catch a rejected step as a negative control. The raw
  // ledger retains it; test errors, global errors and the run verdict still refuse.
  if(terminal?.result?.status!=='passed' || records.some(item=>item.method==='onError')) {
    throw new Error('Playwright error or incomplete terminal result');
  }
  const projects=records.filter(item=>item.method==='onProject').map(item=>item.params?.project);
  if(projects.length!==1 || projects[0]?.name!=='full-suite')throw new Error('Wrong Playwright project');
  const collected=new Map();
  const visit=suite=>{
    if(!Array.isArray(suite.entries))throw new Error('Missing raw Playwright collection');
    for(const entry of suite.entries) {
      if(entry.testId) {
        if(typeof entry.testId!=='string' || typeof entry.title!=='string' || entry.repeatEachIndex!==0
          || collected.has(entry.testId))throw new Error('Duplicate/repeated/malformed Playwright test');
        collected.set(entry.testId,{id:entry.testId,file:evidenceFile(repositoryRoot,config.rootDir,entry.location?.file),title:entry.title});
      }else visit(entry);
    }
  };
  if(!Array.isArray(projects[0].suites))throw new Error('Missing project suites');
  projects[0].suites.forEach(visit);
  const begun=new Map(),ended=new Set();let active=false,closed=false;
  for(const event of records) {
    if(event.method==='onBegin'){active=true;continue;}
    if(event.method==='onEnd'){closed=true;continue;}
    if(!['onTestBegin','onTestEnd'].includes(event.method))continue;
    if(!active || closed)throw new Error('Test callback outside run lifecycle');
    const p=event.params;
    const id=event.method==='onTestBegin'?p?.testId:p?.test?.testId;
    if(!collected.has(id))throw new Error('Uncollected Playwright test callback');
    if(event.method==='onTestBegin') {
      if(begun.has(id) || p.result?.retry!==0 || typeof p.result?.id!=='string')throw new Error('Duplicate/retried/missing test begin');
      begun.set(id,p.result.id);
    }else {
      if(!begun.has(id) || ended.has(id) || p.result?.id!==begun.get(id) || p.test?.expectedStatus!=='passed'
        || p.result?.status!=='passed' || !Array.isArray(p.result.errors) || p.result.errors.length)throw new Error('Failed/skipped/incomplete test terminal');
      ended.add(id);
    }
  }
  if(begun.size!==collected.size || ended.size!==collected.size)throw new Error('Incomplete Playwright collection execution');
  return [...collected.values()].sort((a,b)=>a.id.localeCompare(b.id));
}

// The wrapper retains the original immutable ZIP so later synchronous quality
// consumers can independently reopen it, rather than trusting a collector's totals.
function replayEmbeddedBlob(root,bytes) {
  if(!Buffer.isBuffer(bytes) || !bytes.length || bytes.length>MAX_BLOB_BYTES)throw new Error('Invalid embedded blob');
  const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--decode-blob',root],{
    input:bytes,encoding:'utf8',timeout:15000,maxBuffer:MAX_REPORT_BYTES+1024,
    env:{PATH:`${path.dirname(process.execPath)}${path.delimiter}/usr/bin${path.delimiter}/bin`,LANG:'C.UTF-8',NODE_ENV:'test'},
  });
  if(child.error || child.signal || child.status!==0)throw new Error('Cannot independently read original Playwright blob');
  return child.stdout;
}

export function validatePlaywrightExecution(wrapper,{root,expected,requiredFiles}={}) {
  if(!wrapper || wrapper.schemaVersion!==1 || wrapper.role!=='playwright-report-wrapper'
    || !same(wrapper.provenance,expected) || !Array.isArray(wrapper.shards) || wrapper.shards.length!==4) {
    throw new Error('Missing or stale Playwright report wrapper');
  }
  const runtime=playwrightRuntimeIdentity(root);
  const lockSha256=digest(fs.readFileSync(path.join(root,'pnpm-lock.yaml')));
  const shards=new Set(),producers=new Set(),testIds=new Set(),files=new Set();
  for(const entry of wrapper.shards) {
    const producer=entry.producer;
    if(producer?.schemaVersion!==1 || producer.role!=='playwright-shard-producer'
      || !/^[a-f0-9-]{36}$/.test(producer.producerId || '') || producers.has(producer.producerId)
      || Object.hasOwn(producer,'invocation') || Object.hasOwn(producer.source || {},'invocation')
      || producer.lineage?.source!==expected.source || producer.lineage.runId!==expected.runId
      || producer.lineage.runAttempt!==expected.runAttempt || producer.lineage.job!=='e2e'
      || !same(producer.source,{commit:expected.commit,tree:expected.tree,snapshotSha256:expected.snapshotSha256})
      || !same(producer.runtime,runtime) || producer.lockSha256!==lockSha256) {
      throw new Error('Wrong producer identity/source/lock/runtime or cross-job lineage');
    }
    const current=producer.shard?.current;
    if(!Number.isInteger(current) || current<1 || current>4 || producer.shard.total!==4 || shards.has(current))throw new Error('Missing/duplicate producer shard');
    shards.add(current);producers.add(producer.producerId);
    const prefix=`artifacts/shard-report-${current}/`;
    if(entry.receiptPath!==`${prefix}test-results/playwright/${entry.receiptName}`
      || !/^playwright-execution-\d+-\d+-[1-4]-[a-f0-9-]{36}\.json$/.test(entry.receiptName || '')
      || entry.receiptName!==`playwright-execution-${expected.runId}-${expected.runAttempt}-${current}-${producer.producerId}.json`
      || typeof producer.blob?.name!=='string' || path.basename(producer.blob.name)!==producer.blob.name
      || !producer.blob.name.endsWith('.zip') || entry.blobPath!==`${prefix}blob-report/${producer.blob.name}`) {
      throw new Error('Receipt/blob not paired in original producing-shard artifact');
    }
    if(typeof entry.blobBase64!=='string' || entry.blobBase64.length>Math.ceil(MAX_BLOB_BYTES/3)*4
      || !/^[A-Za-z0-9+/]*={0,2}$/.test(entry.blobBase64))throw new Error('Malformed embedded original ZIP');
    const bytes=Buffer.from(entry.blobBase64,'base64');
    if(bytes.toString('base64')!==entry.blobBase64 || bytes.length!==producer.blob.bytes
      || digest(bytes)!==producer.blob.sha256 || digest(JSON.stringify(producer))!==entry.receiptSha256) {
      throw new Error('Original Playwright artifact bytes changed');
    }
    const jsonl=replayEmbeddedBlob(root,bytes);
    if(digest(jsonl)!==producer.blob.reportSha256)throw new Error('Raw SDK report bytes changed');
    const tests=replayBlobLifecycle(jsonl,{repositoryRoot:producer.repositoryRoot,shard:producer.shard,commit:expected.commit});
    if(!same(tests,producer.collection) || producer.beginCalls!==1 || producer.endCalls!==1 || producer.errorCalls!==0
      || producer.terminalStatus!=='passed' || producer.rawReplayError!==null
      || !Array.isArray(producer.begins) || !Array.isArray(producer.ends)
      || producer.begins.length!==tests.length || producer.ends.length!==tests.length)throw new Error('Producer lifecycle differs from raw shard evidence');
    for(const test of tests) {
      if(testIds.has(test.id))throw new Error('Test duplicated across producer shards');
      testIds.add(test.id);
      const begins=producer.begins.filter(item=>item.id===test.id),ends=producer.ends.filter(item=>item.id===test.id);
      if(begins.length!==1 || ends.length!==1 || begins[0].retry!==0 || ends[0].retry!==0
        || ends[0].status!=='passed' || ends[0].expectedStatus!=='passed' || ends[0].errors!==0) {
        throw new Error('Producer callbacks missing, duplicated, retried, skipped or failed');
      }
      files.add(test.file);
    }
  }
  if(!testIds.size || !Array.isArray(requiredFiles) || !requiredFiles.length
    || requiredFiles.some(file=>!/^tests\/e2e\/.+\.spec\.[jt]s$/.test(file) || !files.has(file))) {
    throw new Error('Required ordinary Playwright file was not executed');
  }
  return new Set(requiredFiles);
}

export function collectPlaywrightExecution({root,expected,requiredFiles}={}) {
  if(!Array.isArray(requiredFiles))throw new Error('Missing changed Playwright selection');
  if(!requiredFiles.length)return null;
  if(expected.source!=='github-actions')throw new Error('Playwright artifact collection requires exact CI lineage');
  const wrapper={schemaVersion:1,role:'playwright-report-wrapper',provenance:expected,shards:[]};
  for(let current=1;current<=4;current++) {
    const prefix=`artifacts/shard-report-${current}/`;
    const directory=path.join(root,prefix,'test-results/playwright');
    const names=fs.readdirSync(directory).filter(name=>name.startsWith('playwright-execution-') && name.endsWith('.json'));
    if(names.length!==1)throw new Error('Missing/ambiguous original shard producer receipt');
    const receiptPath=`${prefix}test-results/playwright/${names[0]}`;
    const raw=readArtifact(root,receiptPath,MAX_REPORT_BYTES);
    const producer=JSON.parse(raw.toString('utf8'));
    if(typeof producer.blob?.name!=='string' || path.basename(producer.blob.name)!==producer.blob.name)throw new Error('Invalid original blob name');
    const blobPath=`${prefix}blob-report/${producer.blob.name}`;
    const bytes=readArtifact(root,blobPath,MAX_BLOB_BYTES);
    // Canonical JSON equality prevents unobserved duplicate keys or misleading whitespace identity.
    if(raw.toString('utf8')!==JSON.stringify(producer))throw new Error('Noncanonical producer receipt bytes');
    wrapper.shards.push({producer,receiptName:names[0],receiptPath,receiptSha256:digest(raw),blobPath,blobBase64:bytes.toString('base64')});
  }
  validatePlaywrightExecution(wrapper,{root,expected,requiredFiles});
  return wrapper;
}

function readArtifact(root,file,limit) {
  const target=path.join(root,file);
  const stat=fs.lstatSync(target);
  if(!stat.isFile() || fs.realpathSync(target)!==target || stat.size>limit)throw new Error('Aliased or oversized original shard artifact');
  return fs.readFileSync(target);
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href && process.argv[2]==='--decode-blob') {
  try {process.stdout.write(await readBlobReport(process.argv[3],fs.readFileSync(0)));}
  catch {process.stderr.write('Invalid Playwright blob\n');process.exitCode=1;}
}
