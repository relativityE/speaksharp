'use strict';
// Source-bound retention boundary: main70e complete-session retention purge may legitimately clear
// A coaching after B replaces it. Never demand expired prose survive, and never waive contradiction.
const crypto=require('node:crypto');const hash=pair=>crypto.createHash('sha256').update(JSON.stringify(['repeat_cached_instruction_v1',pair.version,pair.what_to_try_next])).digest('hex');
const valid=p=>p&&typeof p.version==='string'&&p.version&&typeof p.what_to_try_next==='string'&&p.what_to_try_next.trim();
function targetRetentionVerdict({before,after,authority,observedTargetMatches,ownerId}){
 if(!before||!after||before.id!==after.id||before.user_id!==ownerId||after.user_id!==ownerId||before.product!==after.product)return{status:'FAIL',reason:'owner_take_product_changed'};
 if(!valid(before.ai_suggestions)||observedTargetMatches!==true)return{status:'HOLD',reason:'positive_original_and_displayed_target_witness_missing'};
 if(!Object.hasOwn(after,'ai_suggestions'))return{status:'HOLD',reason:'current_row_projection_incomplete'};
 if(after.ai_suggestions!==null&&after.ai_suggestions!==undefined)return valid(after.ai_suggestions)&&hash(after.ai_suggestions)===hash(before.ai_suggestions)?{status:'PASS',reason:'retained_target_unchanged'}:{status:'FAIL',reason:'retained_target_changed'};
 if(after.transcript_state!=='expired'||after.status!=='completed')return{status:'FAIL',reason:'missing_target_without_explicit_completed_expiry'};
 if(!authority)return{status:'HOLD',reason:'pre_expiry_independent_authority_missing'};
 if(authority.session_id!==before.id||authority.user_id!==ownerId||!valid(authority.ai_suggestions)||hash(authority.ai_suggestions)!==hash(before.ai_suggestions))return{status:'FAIL',reason:'pre_expiry_independent_authority_contradiction'};
 return{status:'PASS',reason:'explicit_expiry_after_positive_independent_and_displayed_target_witness'};
}
module.exports={targetRetentionVerdict};
