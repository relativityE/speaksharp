'use strict';
// Passive browser observers ported from rwtJourney:526 and rwtAdverse:89 at main70e.
// No microphone acquisition, request, route mutation, transcript capture, or provider access is initiated here.
async function install(page) {
  await page.addInitScript(() => {
    const log=[],streams=[],marks=[]; const documentToken=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
    const media=navigator.mediaDevices;
    const observation={log,streams,documentToken,installed:!!media?.getUserMedia};
    window.__rwtGuardedMicObservation__=observation;
    window.__rwtMicStreams__=streams; window.__rwtMicAcquisitionLog__=log; window.__rwtMicAcquisitions__=marks;
    if(!observation.installed)return;
    const original=media.getUserMedia.bind(media);
    // r14 passive timing probe (no acquisition, no request, no transcript): when the first audio stream resolves and when the product reports RECORDING,
    // plus a coarse RMS envelope tapped from the SAME stream (never connected to an output). It lets the harness place the fixture position at the
    // moment recording began, to tell a clipped opening from a product recognition gap.
    const timing={gumCalledMs:null,gumResolvedMs:null,tapStartMs:null,tapState:'none',energy:[],states:[],perfAtDateNow:[performance.now(),Date.now()]};
    observation.timing=timing;
    const closed=v=>typeof v==='string'&&/^[A-Za-z][A-Za-z_-]{0,31}$/.test(v)?v:'other';
    const noteState=(kind,value)=>{if(timing.states.length<60&&!timing.states.some(s=>s[1]===kind&&s[2]===value))timing.states.push([Math.round(performance.now()),kind,closed(value)]);};
    try{
      const read=()=>{const r=document.documentElement;if(r){const a=r.getAttribute('data-runtime-state'),b=r.getAttribute('data-model-status');if(a)noteState('r',a);if(b)noteState('m',b);}};
      new MutationObserver(read).observe(document,{subtree:true,attributes:true,attributeFilter:['data-runtime-state','data-model-status']});read();
    }catch{/* passive only */}
    const startTap=stream=>{
      if(timing.tapStartMs!==null)return;
      try{
        const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
        const ac=new AC(),src=ac.createMediaStreamSource(stream),an=ac.createAnalyser();an.fftSize=2048;src.connect(an);
        timing.tapStartMs=Math.round(performance.now()*10)/10;timing.tapState=ac.state;if(ac.state==='suspended')ac.resume().then(()=>{timing.tapState=ac.state;},()=>{});
        const buf=new Float32Array(an.fftSize);
        const timer=setInterval(()=>{
          if(timing.energy.length>=1200){clearInterval(timer);return;}
          an.getFloatTimeDomainData(buf);let s=0;for(let i=0;i<buf.length;i++)s+=buf[i]*buf[i];
          timing.energy.push([Math.round(performance.now()*10)/10,Math.round(Math.sqrt(s/buf.length)*10000)/10000]);
        },100);
      }catch{timing.tapState='failed';}
    };
    media.getUserMedia=(constraints)=>{
      const entry=constraints?.audio?{id:log.length,outcome:'pending',at:performance.now()}:null;
      if(entry){log.push(entry);marks.push(Date.now());if(timing.gumCalledMs===null)timing.gumCalledMs=Math.round(performance.now()*10)/10;}
      return original(constraints).then(stream=>{if(entry){streams.push(stream);entry.outcome='granted';if(timing.gumResolvedMs===null){timing.gumResolvedMs=Math.round(performance.now()*10)/10;startTap(stream);}}return stream;},error=>{
        if(entry)entry.outcome=['NotAllowedError','NotFoundError','NotReadableError','AbortError','SecurityError','OverconstrainedError','TypeError'].includes(error?.name)?error.name:'other';
        throw error;
      });
    };
  });
}
async function mic(page) {
  return page.evaluate(()=>{
    const o=window.__rwtGuardedMicObservation__;
    if(!o?.installed)return null;
    return {documentToken:o.documentToken,acquisitions:o.log.length,log:o.log.map(x=>({id:x.id,outcome:x.outcome})),liveTracks:o.streams.flatMap(s=>s.getAudioTracks()).filter(t=>t.readyState==='live').length,
      recording:document.documentElement.getAttribute('data-runtime-state')==='RECORDING',recorderVisible:!!document.querySelector('[data-testid="recorder-bar"]')};
  });
}
async function armStates(page,token) {
  return page.evaluate(token=>{
    const root=document.documentElement,states=[root.getAttribute('data-model-status')];
    const record=records=>records.forEach((r,i)=>states.push(i+1<records.length?records[i+1].oldValue:root.getAttribute('data-model-status')));
    const observer=new MutationObserver(record);observer.observe(root,{attributes:true,attributeFilter:['data-model-status'],attributeOldValue:true});
    window.__rwtGuardedModelObservation__={token,states,record,observer};return true;
  },token);
}
async function states(page,token) {
  return page.evaluate(token=>{const o=window.__rwtGuardedModelObservation__;if(!o||o.token!==token)return null;o.record(o.observer.takeRecords());return o.states.slice();},token);
}
async function audioTiming(page) {
  return page.evaluate(()=>{
    const o=window.__rwtGuardedMicObservation__;const t=o?.timing;if(!t)return null;
    return {gumCalledMs:t.gumCalledMs,gumResolvedMs:t.gumResolvedMs,tapStartMs:t.tapStartMs,tapState:t.tapState,energy:t.energy.slice(),states:t.states.slice(),nowMs:Math.round(performance.now()*10)/10,
      acquisitions:o.log.map(x=>({id:x.id,outcome:x.outcome,atMs:Math.round(x.at*10)/10}))};
  });
}
module.exports={install,mic,armStates,states,audioTiming};
