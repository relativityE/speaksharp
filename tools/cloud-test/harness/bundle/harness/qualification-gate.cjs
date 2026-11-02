'use strict';
const {validatePolicy}=require('./guard-proxy.cjs');
const {assertSecurityApproval}=require('./approval-gate.cjs');
function validateLocalFixturePolicy(policy) {
  validatePolicy(policy);
  if(policy.testOnly!==true || policy.upstream?.mode!=='override') throw new Error('BLOCKED_SETUP: qualification supervisor accepts loopback fixture override only');
  const hosts=Object.keys(policy.hosts);
  if(!hosts.length || hosts.some(h=>!['a.test','c.test','d.test'].includes(h))) throw new Error('BLOCKED_SETUP: qualification host outside fixed fixture set');
  const overrides=policy.upstream.override;
  if(!overrides || Object.keys(overrides).some(h=>!['a.test','b.test','c.test','d.test'].includes(h))) throw new Error('BLOCKED_SETUP: qualification override host invalid');
  for(const h of hosts) {
    const m=/^127\.0\.0\.1:([0-9]+)$/.exec(overrides[h]||'');
    if(!m || +m[1]<1024 || +m[1]>65535) throw new Error('BLOCKED_SETUP: fixture destination is not high-port IPv4 loopback');
  }
  for(const dst of Object.values(overrides)) if(!/^127\.0\.0\.1:[0-9]+$/.test(dst)) throw new Error('BLOCKED_SETUP: nonloopback override');
  return {result:'LOCAL_FIXTURE_POLICY_VALID',productionTrafficAllowed:false};
}
function admitQualificationSupervisor(args,policy) {
  if(args['qualification-local-only']!=='true') throw new Error('qualification mode not explicitly selected');
  validateLocalFixturePolicy(policy);
  assertSecurityApproval({securityApprovalFile:args['security-approval']},policy);
  return {result:'APPROVED_LOCAL_FIXTURE_ONLY',runtimeQualificationAlreadyClaimed:false};
}
module.exports={validateLocalFixturePolicy,admitQualificationSupervisor};
