'use strict';
// No service credential is available here. The same job's private broker owns authenticated reads.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net');
const {createExistingRunnerReceiver}=require('../../bundle/harness/existing-runner-receiver.cjs');
function transport({request,requestSha256,signal},{socketPath=process.env.SPEAKSHARP_EVIDENCE_SOCKET}={}){
 if(!socketPath||!path.isAbsolute(socketPath))throw new Error('NOT_RUN: SAME_JOB_EVIDENCE_CAPABILITY_UNAVAILABLE');
 const parent=path.dirname(socketPath),st=fs.lstatSync(parent),sock=fs.lstatSync(socketPath);
 if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o777)!==0o700||fs.realpathSync(parent)!==parent||!sock.isSocket()||sock.uid!==process.getuid()||(sock.mode&0o777)!==0o600)throw new Error('NOT_RUN: SAME_JOB_EVIDENCE_CAPABILITY_INVALID');
 if(signal?.aborted)throw new Error('NOT_RUN: SAME_JOB_EVIDENCE_CANCELLED');
 return new Promise((resolve,reject)=>{
  const socket=net.createConnection(socketPath),chunks=[];let size=0,settled=false;
  const abort=()=>done(new Error('NOT_RUN: SAME_JOB_EVIDENCE_CANCELLED'));
  const done=(error,result)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',abort);socket.destroy();error?reject(error):resolve(result);};
  signal?.addEventListener('abort',abort,{once:true});socket.setTimeout(50000,()=>done(new Error('NOT_RUN: SAME_JOB_EVIDENCE_TIMEOUT')));
  socket.on('connect',()=>socket.end(JSON.stringify({request,requestSha256})));
  socket.on('data',b=>{size+=b.length;if(size>3*1024*1024)done(new Error('NOT_RUN: SAME_JOB_EVIDENCE_TOO_LARGE'));else chunks.push(b);});
  socket.on('error',()=>done(new Error('NOT_RUN: SAME_JOB_EVIDENCE_UNAVAILABLE')));
  socket.on('end',()=>{try{const r=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(r.ok!==true||typeof r.artifactBase64!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(r.artifactBase64))throw new Error();done(null,{artifactBytes:Buffer.from(r.artifactBase64,'base64'),provenance:r.provenance});}catch{done(new Error('NOT_RUN: SAME_JOB_EVIDENCE_UNAVAILABLE'));}});
 });
}
const receiveArtifact=createExistingRunnerReceiver({receiveAuthenticatedArtifact:transport});
module.exports={contract:Object.freeze({scope:'existing-authenticated-producer-receiving-capability',runtimeCapability:'SAME_JOB_PRIVATE_SOCKET_REQUIRED',credentials:'Never inherited by receiver or browser'}),receiveArtifact,transport};
