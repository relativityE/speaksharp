'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const { supervisedCommand }=require('../../harness/bundle/harness/admission.cjs');

function run(script,options={},deps={}) {
  return supervisedCommand(process.execPath,['-e',script],
    {timeout:4000,cleanupReserveMs:1000,observeTermination:true,...options},deps);
}
function notAuthority(observation) {
  assert.equal(observation.ownedDescendants,'NOT_RUN');
  assert.equal(observation.browserShutdown,'NOT_RUN');
  assert.equal(observation.transportDrain,'NOT_RUN');
}
test('real supervisor observes zero leader close but gives no descendant/browser/drain proof',async()=>{
  const r=await run('process.exit(0)');
  assert.deepEqual(r.terminationObservation,{
    leader:'EXITED_ZERO',closeObserved:true,exitCode:0,signal:null,supervisorReason:null,
    ownedDescendants:'NOT_RUN',browserShutdown:'NOT_RUN',transportDrain:'NOT_RUN',
  });
});
test('real supervisor separates nonzero and spontaneous signal from zero',async()=>{
  const a=await run('process.exit(4)');
  const b=await run("process.kill(process.pid,'SIGTERM')");
  assert.equal(a.terminationObservation.leader,'EXITED_NONZERO');
  assert.equal(a.terminationObservation.exitCode,4);
  assert.equal(b.terminationObservation.leader,'SIGNALLED');
  assert.equal(b.terminationObservation.signal,'SIGTERM');
  notAuthority(a.terminationObservation);notAuthority(b.terminationObservation);
});
test('deadline-forced close never becomes a natural zero',async()=>{
  const r=await run("process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},200)",{timeout:300});
  assert.equal(r.status,124);
  assert.equal(r.terminationObservation.leader,'FORCED');
  assert.equal(r.terminationObservation.supervisorReason,'command-deadline');
  notAuthority(r.terminationObservation);
});
test('fake watcher close cannot become native observation',async()=>{
  const {EventEmitter}=require('node:events');
  const r=await run('',{}, {spawn:()=>{const c=new EventEmitter();process.nextTick(()=>c.emit('close',0,null));return c;}});
  assert.equal(r.terminationObservation.leader,'UNPROVEN');
  assert.equal(r.terminationObservation.closeObserved,false);
  notAuthority(r.terminationObservation);
});
test('missing child never becomes proved natural close',async()=>{
  const r=await supervisedCommand('/dev/null/not-an-executable',[],
    {timeout:4000,cleanupReserveMs:1000,observeTermination:true});
  assert.equal(r.status,127);
  assert.notEqual(r.terminationObservation.leader,'EXITED_ZERO');
  notAuthority(r.terminationObservation);
});

test('browser shutdown distinguishes completion, failure, and a late reply after timeout', async () => {
  const { observeBrowserClose }=require('../../harness/bundle/harness/launch.cjs');
  assert.equal(await observeBrowserClose({close:async()=>{}},50),'CLOSED');
  assert.equal(await observeBrowserClose({close:async()=>{throw Error('not closed');}},50),'BROWSER_CLOSE_FAILED');
  let complete;
  const pending=new Promise(resolve=>{complete=resolve;});
  const observation=await observeBrowserClose({close:()=>pending},10);
  complete();
  assert.equal(observation,'BROWSER_CLOSE_TIMEOUT');
});
