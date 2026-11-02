'use strict';
// No service credential is available here. The same job's private broker owns authenticated reads.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net');
const {createExistingRunnerReceiver}=require('../../bundle/harness/existing-runner-receiver.cjs');
function exchange(input,{socketPath=process.env.SPEAKSHARP_EVIDENCE_SOCKET,signal,timeoutMs=50000}={}){
 if(!socketPath||!path.isAbsolute(socketPath))throw new Error('NOT_RUN: SAME_JOB_EVIDENCE_CAPABILITY_UNAVAILABLE');
 const parent=path.dirname(socketPath),st=fs.lstatSync(parent),sock=fs.lstatSync(socketPath);
 if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o777)!==0o700||fs.realpathSync(parent)!==parent||!sock.isSocket()||sock.uid!==process.getuid()||(sock.mode&0o777)!==0o600)throw new Error('NOT_RUN: SAME_JOB_EVIDENCE_CAPABILITY_INVALID');
 if(signal?.aborted)throw new Error('NOT_RUN: SAME_JOB_EVIDENCE_CANCELLED');
 return new Promise((resolve,reject)=>{
  const socket=net.createConnection(socketPath),chunks=[];let size=0,settled=false;
  const timer=setTimeout(()=>done(new Error('NOT_RUN: SAME_JOB_EVIDENCE_TIMEOUT')),timeoutMs);timer.unref();
  const abort=()=>done(new Error('NOT_RUN: SAME_JOB_EVIDENCE_CANCELLED'));
  const done=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);socket.destroy();error?reject(error):resolve(result);};
  signal?.addEventListener('abort',abort,{once:true});socket.setTimeout(timeoutMs,()=>done(new Error('NOT_RUN: SAME_JOB_EVIDENCE_TIMEOUT')));
  socket.on('connect',()=>socket.end(JSON.stringify(input)));
  socket.on('data',b=>{size+=b.length;if(size>3*1024*1024)done(new Error('NOT_RUN: SAME_JOB_EVIDENCE_TOO_LARGE'));else chunks.push(b);});
  socket.on('error',()=>done(new Error('NOT_RUN: SAME_JOB_EVIDENCE_UNAVAILABLE')));
  socket.on('close',()=>done(new Error('NOT_RUN: SAME_JOB_EVIDENCE_UNAVAILABLE')));
  socket.on('end',()=>{try{const r=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(r.ok!==true)throw new Error();done(null,r);}catch{done(new Error('NOT_RUN: SAME_JOB_EVIDENCE_UNAVAILABLE'));}});
 });
}
function transport({request,requestSha256,signal},options={}){
 return exchange({request,requestSha256},{...options,signal}).then(r=>{
  if(typeof r.artifactBase64!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(r.artifactBase64))throw new Error('NOT_RUN: SAME_JOB_EVIDENCE_UNAVAILABLE');
  return {artifactBytes:Buffer.from(r.artifactBase64,'base64'),provenance:r.provenance};
 });
}
function probeTransport(request,{signal,...options}={}){
 return exchange(request,{...options,signal,timeoutMs:2000}).then(r=>r.probe);
}
const receiveArtifact=createExistingRunnerReceiver({receiveAuthenticatedArtifact:transport});
module.exports={contract:Object.freeze({scope:'existing-authenticated-producer-receiving-capability',runtimeCapability:'SAME_JOB_PRIVATE_SOCKET_REQUIRED',credentials:'Never inherited by receiver or browser'}),receiveArtifact,transport,probeTransport};
