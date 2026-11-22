'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sourceSha='d1003559242570023e0d9a8c335d05fe67c3d788';
const entries=[
 ['frontend/src/components/progress/ProgressPanel.tsx','62460ac6f094ad58b7fa6075451d00301763cd92'],
 ['frontend/src/services/progress/loadSessionProgress.ts','e42c772dc88958649e6b7d99c5b60d6c590c2049'],
 ['frontend/src/services/progress/buildProgressEvaluation.ts','4e972ff375ac63881286a568a60ef662b558d4be'],
 ['frontend/src/services/progress/recordProgress.ts','491acfca8352aabba4c912f6f1867b85f9380e49'],
 ['backend/supabase/migrations/20260731120000_session_progress_evaluations.sql','14f9df76d05482c1dbd85f8626509d7bee5cd4e2'],
 ['backend/supabase/migrations/20260731130000_progress_recommendations.sql','ec0d0ea71aa493ac70455a1c635275025a4a791a']
].map(([file,expectedGitBlob])=>{const b=fs.readFileSync(path.join(__dirname,path.basename(file))),gitBlobSha1=crypto.createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');if(gitBlobSha1!==expectedGitBlob)throw Error('source hash differs '+file);return {path:file,sourceSha,expectedGitBlob,gitBlobSha1,sha256:crypto.createHash('sha256').update(b).digest('hex'),sourceEvidence:'Authorized exact-ref GitHub connector read; ProgressPanel/loadSessionProgress hashes checked against current-source-delta; other paths unchanged in exact70e-to-d100 compare and match preserved main70e tree.'};});
fs.writeFileSync(path.join(__dirname,'source-receipt.json'),JSON.stringify({sourceSha,scope:'Source only; no production schema application, RLS qualification, browser run or release equivalence asserted',entries},null,2)+'\n');
