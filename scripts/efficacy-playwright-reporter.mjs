import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {sourceIdentity} from './lib/testExecutionEvidence.mjs';
import {digest,playwrightRuntimeIdentity,readBlobReport,replayBlobLifecycle} from './lib/playwrightExecutionEvidence.mjs';

// This identity belongs to the producing shard. The later report-job invocation
// is deliberately absent; only its independently validated wrapper may name it.
export default class EfficacyPlaywrightReporter {
  producerId=randomUUID();
  beginCalls=0;
  endCalls=0;
  errorCalls=0;
  collection=[];
  begins=[];
  ends=[];
  initialize(config) {
    if(!config.configFile)throw new Error('Missing Playwright config identity');
    this.root=fs.realpathSync(path.dirname(config.configFile));
    this.shard=config.shard;
    const source=sourceIdentity(this.root);
    if(process.env.GITHUB_ACTIONS!=='true' || process.env.GITHUB_JOB!=='e2e'
      || !/^\d+$/.test(process.env.GITHUB_RUN_ID || '') || !/^\d+$/.test(process.env.GITHUB_RUN_ATTEMPT || '')
      || process.env.GITHUB_SHA!==source.commit)throw new Error('Missing exact Playwright shard CI lineage');
    if(!Number.isInteger(this.shard?.current) || this.shard.total!==4 || this.shard.current<1 || this.shard.current>4) {
      throw new Error('Playwright producer requires one declared shard of four');
    }
    this.source=source;
    this.runtime=playwrightRuntimeIdentity(this.root);
    this.lockSha256=digest(fs.readFileSync(path.join(this.root,'pnpm-lock.yaml')));
    this.lineage={source:'github-actions',runId:process.env.GITHUB_RUN_ID,runAttempt:process.env.GITHUB_RUN_ATTEMPT,job:process.env.GITHUB_JOB};
  }
  onBegin(config,suite) {
    this.initialize(config);
    this.beginCalls++;
    this.collection=suite.allTests().map(test=>{
      const file=path.relative(this.root,fs.realpathSync(test.location.file)).split(path.sep).join('/');
      if(!/^tests\/e2e\/.+\.spec\.[jt]s$/.test(file))throw new Error('Non-ordinary test in Playwright producer');
      return {id:test.id,file,title:test.title};
    }).sort((a,b)=>a.id.localeCompare(b.id));
  }
  onTestBegin(test,result){this.begins.push({id:test.id,retry:result.retry});}
  onTestEnd(test,result){this.ends.push({id:test.id,retry:result.retry,status:result.status,expectedStatus:test.expectedStatus,errors:result.errors.length});}
  onError(){this.errorCalls++;}
  onEnd(result){this.endCalls++;this.terminalStatus=result.status;}
  async onExit() {
    const names=fs.readdirSync(path.join(this.root,'blob-report')).filter(name=>name.endsWith('.zip'));
    if(names.length!==1)throw new Error('Missing or ambiguous producing-shard blob');
    const bytes=fs.readFileSync(path.join(this.root,'blob-report',names[0]));
    const jsonl=await readBlobReport(this.root,bytes);
    let rawReplayError=null;
    try {
      const replay=replayBlobLifecycle(jsonl,{repositoryRoot:this.root,shard:this.shard,commit:this.source.commit});
      if(JSON.stringify(replay)!==JSON.stringify(this.collection))throw new Error('Producer collection differs from raw SDK collection');
    }catch(error){rawReplayError=error.message;}
    if(JSON.stringify(sourceIdentity(this.root))!==JSON.stringify(this.source)
      || JSON.stringify(playwrightRuntimeIdentity(this.root))!==JSON.stringify(this.runtime)
      || digest(fs.readFileSync(path.join(this.root,'pnpm-lock.yaml')))!==this.lockSha256) {
      throw new Error('Playwright producer source/lock/runtime changed');
    }
    const receipt={schemaVersion:1,role:'playwright-shard-producer',producerId:this.producerId,
      repositoryRoot:this.root,source:this.source,lineage:this.lineage,shard:this.shard,runtime:this.runtime,lockSha256:this.lockSha256,
      collection:this.collection,beginCalls:this.beginCalls,endCalls:this.endCalls,errorCalls:this.errorCalls,
      begins:this.begins,ends:this.ends,terminalStatus:this.terminalStatus,rawReplayError,
      blob:{name:names[0],bytes:bytes.length,sha256:digest(bytes),reportSha256:digest(jsonl)}};
    const output=path.join(this.root,'test-results/playwright');
    fs.mkdirSync(output,{recursive:true});
    const name=`playwright-execution-${this.lineage.runId}-${this.lineage.runAttempt}-${this.shard.current}-${this.producerId}.json`;
    fs.writeFileSync(path.join(output,name),JSON.stringify(receipt),{encoding:'utf8',flag:'wx'});
    if(rawReplayError)throw new Error(`Unqualified raw Playwright shard: ${rawReplayError}`);
  }
}
