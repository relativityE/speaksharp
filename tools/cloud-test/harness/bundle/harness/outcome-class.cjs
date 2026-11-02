'use strict';
// r15 outcome classes. Pure: no filesystem, network or clock. Separates what a result MEANS so a report can never present a NOT RUN or a harness artifact as a product verdict.
//   pass                  PASS on a product row
//   harness-control       PASS on a row that describes the harness itself (owned pages closed, press budget, no cloud STT)
//   product-failure       FAIL observed with a valid stimulus and no marker of a harness artifact
//   harness-failure       FAIL recorded while the case was interrupted (the observed FAIL is an artifact of the interruption)
//   setup-blocked         the stimulus never occurred (closed setupBlocked/setupReason facts): not a product verdict
//   missing-evidence      an authorized evidence reader was unavailable, or the row was not established
//   omitted-by-design     deliberately omitted by an approved sample (omittedBy)
//   allowance-interrupted stopped by the per-case request allowance
//   not-reached           the case ended before this row
//   gate-blocked / not-selected  are case-level classes assigned by the campaign core
const HARNESS_ROWS=new Set(['owned-pages-closed','start-press-budget','no-cloud-stt']);
const CLASSES=Object.freeze(['pass','harness-control','product-failure','harness-failure','setup-blocked','missing-evidence','omitted-by-design','allowance-interrupted','not-reached']);
function classifyRow(row,facts){
  const f=facts&&typeof facts==='object'?facts:{};
  if(row?.interruptedBy==='request-allowance'||f.interruptedBy==='request-allowance')return 'allowance-interrupted';
  if(row?.result==='PASS')return HARNESS_ROWS.has(row.id)?'harness-control':'pass';
  if(f.setupBlocked===true)return 'setup-blocked';
  if(row?.result==='FAIL')return f.interrupted===true?'harness-failure':'product-failure';
  if(f.omittedBy)return 'omitted-by-design';
  if(f.notReached===true)return 'not-reached';
  return 'missing-evidence';
}
function classifyCase(rows,factsById){
  const classes={},counts=Object.fromEntries(CLASSES.map(c=>[c,0]));
  for(const r of rows||[]){const c=classifyRow(r,(factsById||{})[r.id]);classes[r.id]=c;counts[c]++;}
  return {classes,counts};
}
module.exports={CLASSES,HARNESS_ROWS,classifyRow,classifyCase};
