'use strict';
// Runs the REAL vendored runner's own start-up validation against a generated plan, in the order the runner uses (campaign-core runCampaign):
// plan structure (selection, run identity, identity cap, request budget, 15 cases), budget binding to the guard cap, run identity, stimulus receipt, and
// every selected case's preflight (case config, driver, capture device, oracles, producers). Offline: no product traffic, no credentials.
// Optional 3rd argument: the assertion catalog; then every selected case must also carry exactly the catalog's required assertions and at least the
// catalog's minimum take and Start caps (the failure controls that bound a case).
// Usage: node plan-acceptance.cjs <harness dir> <plan.json> [assertion-catalog.json]
// Prints JSON {check: ACCEPTED|REFUSED: reason}; exit 0 only when all checks are ACCEPTED.
const fs = require('fs'), path = require('path');
const harness = path.resolve(process.argv[2]), planFile = path.resolve(process.argv[3]);
const catalog = process.argv[4] ? JSON.parse(fs.readFileSync(path.resolve(process.argv[4]), 'utf8')) : null;
const selectedFull = process.argv[5] === '--selected-full';
if(process.argv.length>6 || (process.argv[5] && !selectedFull) || (selectedFull && !catalog))throw new Error('exact catalog scope required');
const bundle = path.join(harness, 'bundle');
const runner = require(path.join(bundle, 'harness/campaign-runner.cjs'));
const core = require(path.join(bundle, 'harness/campaign-core.cjs'));
const planBytes = fs.readFileSync(planFile);
const plan = JSON.parse(planBytes);
// The real runner binds the bytes it consumed before it performs any runtime
// identity check. This offline validator must exercise the same boundary.
plan.consumedPlanSha256 = require('crypto').createHash('sha256').update(planBytes).digest('hex');
const out = {};
(async () => {
  const io = runner.createAdapter(plan, bundle, { executeR0: false });
  const attempt = async (label, fn) => { try { await fn(); out[label] = 'ACCEPTED'; } catch (e) { out[label] = 'REFUSED: ' + String(e.message).slice(0, 300); } };
  await attempt('campaign plan structure', () => core.validateCampaignPlan(plan));
  await attempt('request budget binding', async () => { if (plan.requestBudget) await io.verifyBudgetBinding(plan); });
  await attempt('run identity', () => io.verifyRunIdentity(plan));
  await attempt('stimulus preflight receipt', () => io.verifyStimulusPreflight(plan));
  await attempt('every selected case preflight', async () => { for (const id of core.selectedOrder(plan)) await io.preflightCase(plan.cases.find(c => c.id === id), plan); });
  if (catalog) {
    await attempt('assertion catalog and failure caps', async () => {
      const problems = [];
      if(selectedFull && (plan.coverageMode!=='partial'||plan.assertionDepth!=='full'||!plan.selection?.ids?.length||core.selectedOrder(plan).length>6))problems.push('explicit partial-selection/full-assertion binding missing');
      for (const id of core.selectedOrder(plan)) {
        const row = plan.cases.find(c => c.id === id), cfg = JSON.parse(fs.readFileSync(row.configFile, 'utf8')), spec = catalog.cases[id];
        const want = JSON.stringify([...spec.requiredAssertions].sort()), got = JSON.stringify([...(cfg.requiredAssertions || [])].sort());
        if (want !== got) problems.push(id + ': requiredAssertions differ from the catalog');
        if (!(cfg.takeCap >= spec.minimumTakes)) problems.push(id + ': takeCap ' + cfg.takeCap + ' below the minimum ' + spec.minimumTakes);
        if (!(cfg.startPressCap >= spec.minimumStarts)) problems.push(id + ': startPressCap ' + cfg.startPressCap + ' below the minimum ' + spec.minimumStarts);
        if (cfg.sampleMode) problems.push(id + ': sampleMode ' + cfg.sampleMode + ' is not full coverage');
        if (!(row.maxMs > 0)) problems.push(id + ': no time limit');
      }
      if (!selectedFull && core.selectedOrder(plan).length !== Object.keys(catalog.cases).length) problems.push('the plan does not select every catalog journey');
      if (!plan.requestBudget) problems.push('no request budget');
      if (problems.length) throw new Error(problems.join('; '));
    });
  }
  console.log(JSON.stringify(out, null, 1));
  process.exitCode = Object.values(out).every(v => v === 'ACCEPTED') ? 0 : 1;
})();
