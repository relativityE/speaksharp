'use strict';
// Closed-vocabulary evidence sink. Every evidence file passes through here, so a code path that mistakenly forwards page text, error text,
// transcript text or any prose cannot reach disk: only booleans, finite numbers, null, structural identifiers (digests, timestamps, json refs),
// UPPER_SNAKE tokens, compound lowercase identifiers (kebab/snake/dot/colon) and a CLOSED list of single-word enum values survive.
// Anything else is replaced by BLOCKED and counted. Pure: no filesystem, network or environment access.
const BLOCKED='<blocked-text>';
const ENUM_WORDS=Object.freeze(new Set(['ready','idle','loading','error','pending','partial','covered','missed','missing','none','other','completed','recording','observed','handled','timeout','unknown','true','false','yes','no','page','context','browser','owner','canary','private','native','cloud','free','pro','trial','active','released','refused','denied','allowed','granted','blocked','failed','passed','skipped','stored','created','closed','open','offline','online','mobile','desktop','focus','open_mic','review','analytics','progress','session','practice','first','second','succeeded','aborted','uncorrelated','absent','malformed','valid','inconclusive']));
const EXACT=Object.freeze(new Set(['NOT RUN','Error','TimeoutError','TypeError','<blocked-text>','<url>','<email>','<id>','<n>','<redacted>']));
const RULES=[
  /^AHT-\d{2}$/,                                                // case ids
  /^[0-9a-f]{8,64}$/,                                           // digests / short hashes
  /^sha256:[0-9a-f]{8,64}$/,
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/,        // ISO timestamps
  /^[a-z0-9][a-z0-9._-]{0,60}\.json$/,                            // evidence refs
  /^[A-Z][A-Z0-9_]{1,40}$/,                                       // UPPER_SNAKE tokens (PASS, READY, TERMINATED …)
  /^[a-z][a-z0-9]*(?:[-_.:/][a-z0-9]+){1,10}$/,                   // compound lowercase identifiers (needs a separator)
];
function safeString(s){if(typeof s!=='string'||s.length===0||s.length>96)return false;if(ENUM_WORDS.has(s)||EXACT.has(s))return true;return RULES.some(r=>r.test(s));}
function sanitizeEvidence(value){
  const stats={blockedStrings:0,droppedKeys:0,truncated:0};
  const walk=(v,depth)=>{
    if(v===null||typeof v==='boolean')return v;
    if(typeof v==='number')return Number.isFinite(v)?v:null;
    if(typeof v==='string'){if(safeString(v))return v;stats.blockedStrings++;return BLOCKED;}
    if(depth>=6){stats.truncated++;return null;}
    if(Array.isArray(v)){if(v.length>200)stats.truncated++;return v.slice(0,200).map(x=>walk(x,depth+1));}
    if(typeof v==='object'){const out={};for(const [k,x] of Object.entries(v)){if(!/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(k)){stats.droppedKeys++;continue;}out[k]=walk(x,depth+1);}return out;}
    stats.droppedKeys++;return null;
  };
  const out=walk(value,0);
  return {value:out,stats};
}
module.exports={BLOCKED,ENUM_WORDS,safeString,sanitizeEvidence};
