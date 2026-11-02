'use strict';
// Qualification-only step (loopback fixtures; no production host, no credentials used). It drives the REAL supervisor, case recorder and Chromium through the
// per-case request allowance so the allowance-stop path is exercised before any live case. scenario 'exhaust': record genuine results, spend the allowance,
// record what a disturbed product driver would record afterwards, then wait for the supervisor to stop it. scenario 'control': same genuine results, no exhaustion.
module.exports = async function allowanceCase({ context, capabilities, caseConfig, log }) {
  const scenario = caseConfig.qualificationScenario;
  const rec = capabilities.recordAssertion, ev = capabilities.writeEvidence;
  let n = 0;
  const put = async (id, result) => {
    const ref = await ev('q-' + (++n) + '.json', { contentSafe: true, id, result });
    await rec({ id, result, detail: result === 'PASS' ? 'The named source assertion was observed.' : result === 'FAIL' ? 'Observed behavior contradicts the named source assertion.' : 'The named assertion was not established.', evidenceRefs: [ref] });
  };
  const p = await context.newPage();
  await p.goto('https://a.test/page');
  const post = (u, b) => p.evaluate(async ([url, body]) => { try { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, deny: r.headers.get('x-ss-harness-deny') }; } catch (e) { return { error: true }; } }, [u, b]);
  const ident = { account: 'qual-account', take: 'qual-take', completion: 'qual-op' };
  await put('pre-pass', 'PASS');
  const upstream = await post('/save-error', ident);                 // a genuine upstream failure, forwarded and answered 503 by the fixture
  await put('pre-upstream-failure', upstream.status === 503 && !upstream.deny ? 'FAIL' : 'NOT RUN');
  await put('pre-genuine-fail', 'FAIL');                             // a genuine product-style failure observed before any denial
  if (scenario === 'control') { await put('post-fail', 'FAIL'); return { caseId: caseConfig.caseId, contentSafe: true, assertions: [], blocker: null, executionSignals: {} }; }
  let denied = null, disturbed = false;
  try {
    for (let i = 0; i < 80 && !denied; i++) {
      const r = await p.evaluate(() => fetch('/ok').then(x => ({ status: x.status, deny: x.headers.get('x-ss-harness-deny') })).catch(() => ({ error: true })));
      if (r && r.deny === 'cap:case-allowance') denied = r;
    }
    await post('/save', ident); await post('/coach', {});
  } catch (e) { disturbed = true; /* the supervisor is already stopping the case and the page is going away: exactly what a driver sees */ }
  // What a product driver records next: the disturbed step is caught and recorded as a failed check (as the real drivers do), plus a check that still looks fine.
  await put('post-save-denied', 'FAIL'); await put('post-coach-denied', 'FAIL'); await put('post-pass', 'PASS');
  log('allowance reached; waiting for the supervisor to stop this step');
  await new Promise(() => {});
};
module.exports.preflight = async () => {};
