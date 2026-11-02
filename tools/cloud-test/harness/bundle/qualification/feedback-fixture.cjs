'use strict';
// SOURCE ONLY until explicitly run inside the approved loopback qualification. No import side effects.
const fs=require('node:fs'),crypto=require('node:crypto');
const PATH='/rest/v1/user_issue_reports';
function createFeedbackFixture(file){
 const fd=fs.openSync(file,'wx',0o600);fs.fsyncSync(fd);
 const read=()=>fs.readFileSync(file,'utf8').split('\n').filter(Boolean).map(JSON.parse);
 const send=(res,status,data)=>{const body=status===204||status===201&&data===null?'':JSON.stringify(data);res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','content-length':Buffer.byteLength(body)});res.end(body);};
 function handle(req,res){const u=new URL(req.url,'https://a.test');if(u.pathname!==PATH)return false;
  if(req.method==='GET'){req.resume();const row=read().filter(r=>['user_id','session_id','idempotency_key'].every(k=>u.searchParams.get(k)==='eq.'+r[k]));if(row.some(r=>r.metadata.fixtureReadbackStatus===403)){send(res,403,{code:'42501',message:'fixture read denied'});return true;}send(res,200,row);return true;}
  if(req.method!=='POST'){req.resume();send(res,405,{error:'fixture method'});return true;}
  const chunks=[];let bytes=0;req.on('data',d=>{bytes+=d.length;if(bytes>1048576)req.destroy();else chunks.push(d);});req.on('end',()=>{try{const row=JSON.parse(Buffer.concat(chunks));if([200,202,204,400,401,403,409,500,503].includes(row.metadata?.fixtureStatus)){send(res,row.metadata.fixtureStatus,{code:'fixture_error',message:'intentional-negative-status'});return;}if(read().some(r=>r.idempotency_key===row.idempotency_key)){if(row.metadata?.fixtureRetryStatus===201){send(res,201,null);return;}send(res,409,{code:'23505',message:'duplicate key value violates unique constraint '+(row.metadata?.fixtureWrongConstraint?'"another_unique_constraint"':'"user_issue_reports_idempotency_key_unique"'),details:row.metadata?.fixtureWrongKey?'(idempotency_key)=(99999999-9999-4999-8999-999999999999)':''});return;}fs.writeSync(fd,JSON.stringify({id:crypto.randomUUID(),...row})+'\n');fs.fsyncSync(fd);if(row.metadata?.fixtureRollbackResponse)res.setHeader('preference-applied','tx=rollback');if(row.metadata?.fixtureIncompleteResponse){res.writeHead(201,{'content-type':'application/json','content-length':'2'});res.end('x');return;}send(res,201,row.metadata?.fixtureCreatedErrorBody?{code:'fixture_error',message:'intentional-201-body-negative'}:null);}catch{send(res,400,{error:'fixture bad JSON'});}});return true;
 }
 return{handle,read,close(){fs.closeSync(fd);}};
}
module.exports={createFeedbackFixture};
