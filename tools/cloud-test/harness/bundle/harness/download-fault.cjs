'use strict';
function validateDownloadFault(f,policy) {
 if(!f || typeof f.id!=='string'||!f.id.trim()||!['download-fails','offline-mid-download'].includes(f.mode))throw new Error('download fault id/mode required');
 let u;try{u=new URL(f.url);}catch{throw new Error('exact download URL required');}
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||u.search||!policy.hosts[u.hostname])throw new Error('download URL outside bound guard');
 if(!policy.testOnly && (u.hostname!=='speaksharp-public.vercel.app'||!/^\/(?:models\/whisper-base\.en|assets\/transformers-v2-ort)\/[A-Za-z0-9._~/-]+$/.test(u.pathname)))throw new Error('only selected local-model asset downloads may be faulted');
 if(f.mode==='offline-mid-download'&&(!Number.isSafeInteger(f.afterBytes)||f.afterBytes<=0||f.afterBytes>16*1024*1024))throw new Error('finite positive download prefix bound required');
 return {...f,url:u.href,host:u.hostname,pathname:u.pathname,selected:false,fired:false,bytesForwarded:0};
}
function selectDownloadFault(faults,{url,method}) {if(method!=='GET')return null;const f=faults.find(x=>!x.selected&&x.url===url);if(f)f.selected=true;return f||null;}
function canInterruptDownload(status,length,afterBytes) {return Number.isInteger(status)&&status>=200&&status<300&&/^[0-9]+$/.test(String(length))&&Number.isSafeInteger(+length)&&+length>afterBytes;}
module.exports={validateDownloadFault,selectDownloadFault,canInterruptDownload};
