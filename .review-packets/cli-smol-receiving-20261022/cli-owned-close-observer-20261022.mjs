const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function bounded(work,ms,label){
  let timer;
  try{return await Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(Error(`TIMEOUT_${label}`)),Math.max(1,ms));
  })]);}finally{clearTimeout(timer);}
}

/** Observe real close without replacing its existing deadline or cleanup policy. */
export async function observeOwnedClose({target,close,evidence,scanOwned,verifyBorrowed,
  monotonic=()=>performance.now(),retain=(_receipt)=>{},observerMs=5000,pollMs=100,checkMs=1000}){
  if(!Number.isFinite(observerMs)||observerMs<=0||!Number.isFinite(pollMs)||pollMs<=0||
    !Number.isFinite(checkMs)||checkMs<=0)throw Error('Invalid bounded observer policy');
  const receipt={startedMonoMs:monotonic(),existingCloseDeadlineMs:2000,observerBudgetMs:observerMs,
    deadline:{status:'PENDING'},actualClose:{status:'NOT_STARTED'},ownedExit:{status:'UNKNOWN'},
    borrowedOwner:{status:'NOT_CHECKED'},observer:{status:'PENDING'},events:[],samplingErrors:[],retentionErrors:[]};
  let observing=true,instrumented=false;
  const descriptor=Object.getOwnPropertyDescriptor(target,'close');
  const original=target.close;
  const save=()=>{
    try{retain(structuredClone(receipt));}
    catch(error){receipt.retentionErrors.push({monoMs:monotonic(),error:String(error)});}
  };
  const event=(type,extra={})=>{if(!observing)return;receipt.events.push({type,monoMs:monotonic(),...extra});save();};
  try{
    if(typeof original!=='function')throw Error('Actual context.close missing');
    target.close=function(...args){
      if(observing){receipt.actualClose={status:'PENDING',startedMonoMs:monotonic()};
        event('ACTUAL_CLOSE_STARTED');}
      let result;
      try{result=Reflect.apply(original,this,args);}
      catch(error){if(observing){receipt.actualClose={...receipt.actualClose,status:'REJECTED',rejectedMonoMs:monotonic(),error:String(error)};event('ACTUAL_CLOSE_REJECTED');}throw error;}
      return Promise.resolve(result).then(value=>{
        if(observing){receipt.actualClose={...receipt.actualClose,status:'RESOLVED',resolvedMonoMs:monotonic()};event('ACTUAL_CLOSE_RESOLVED');}
        return value;
      },error=>{
        if(observing){receipt.actualClose={...receipt.actualClose,status:'REJECTED',rejectedMonoMs:monotonic(),error:String(error)};event('ACTUAL_CLOSE_REJECTED');}
        throw error;
      });
    };
    instrumented=true;
    receipt.closeRequestedMonoMs=monotonic();
    receipt.deadline.expectedMonoMs=receipt.closeRequestedMonoMs+2000;
    try{await close();receipt.deadline={...receipt.deadline,status:'PASS',observedMonoMs:monotonic()};}
    catch(error){receipt.deadline={...receipt.deadline,status:'FAIL',observedMonoMs:monotonic(),error:String(error)};}
    event('EXISTING_CLOSE_DEADLINE_OUTCOME',{status:receipt.deadline.status});
    const observerStarted=monotonic(),until=observerStarted+observerMs;
    receipt.observer={status:'OBSERVING',startedMonoMs:observerStarted,limitMonoMs:until};
    while(monotonic()<until){
      const budget=Math.min(checkMs,until-monotonic());
      try{
        const sample=await bounded(scanOwned,budget,'OWNED_PROCESS_SCAN');
        if(sample?.complete!==true||!Array.isArray(sample.pids)||!Array.isArray(sample.profileMatches))throw Error('Incomplete owned-process scan');
        receipt.ownedExit={...sample,status:sample.pids.length===0&&sample.profileMatches.length===0?'ABSENT':'PRESENT',observedMonoMs:monotonic()};
        event('OWNED_PROCESS_OBSERVATION',{status:receipt.ownedExit.status});
      }catch(error){
        receipt.ownedExit={status:'UNKNOWN',observedMonoMs:monotonic(),error:String(error)};
        receipt.samplingErrors.push({monoMs:monotonic(),error:String(error)});save();
      }
      try{receipt.stateAtObservation=evidence();}catch(error){receipt.evidenceError=String(error);}
      if(receipt.actualClose.status==='RESOLVED'&&receipt.ownedExit.status==='ABSENT'){
        receipt.observer={...receipt.observer,status:'COMPLETE',finishedMonoMs:monotonic()};break;
      }
      if(monotonic()<until)await sleep(Math.min(pollMs,until-monotonic()));
    }
    if(receipt.observer.status!=='COMPLETE')receipt.observer={...receipt.observer,status:'LIMIT_REACHED',finishedMonoMs:monotonic()};
  }catch(error){receipt.observer={...receipt.observer,status:'FAILED',error:String(error),finishedMonoMs:monotonic()};}
  finally{
    observing=false;
    if(instrumented){if(descriptor)Object.defineProperty(target,'close',descriptor);else delete target.close;}
    try{receipt.borrowedOwner=await bounded(verifyBorrowed,checkMs,'BORROWED_OWNER_CHECK');}
    catch(error){receipt.borrowedOwner={status:'UNKNOWN',error:String(error)};}
    receipt.finishedMonoMs=monotonic();save();
  }
  return receipt;
}
