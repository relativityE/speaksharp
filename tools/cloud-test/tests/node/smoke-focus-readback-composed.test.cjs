'use strict';
// the composed path with mocked dependencies, through the REAL oracles (createOracles): the existing focusEvidence 'begin'
// captures the expected brief (the one objective_brief read, reused) -> the smoke window's rail statuses -> the page saveReopen left on the
// reloaded exact-session detail -> 3 owner-scoped reads -> the window-bound verdict -> the oracle result the smoke-focus-readback row records.
// Only the browser page is mocked: owner REST reads are answered from in-memory tables by URL, exactly as createOwnerDb issues them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const DA = path.join(__dirname, '..', '..', 'harness', 'draft-adapters');
const { createOracles } = require(path.join(DA, 'oracles', 'index.cjs'));
const { execFileSync } = require('node:child_process');

// the reopened page's route is DERIVED from the tested release's own source lines (committed verbatim with their blob ids),
// never invented: AnalyticsDashboard.tsx's open-session-detail link (the one ui.reopen clicks) and App.tsx's canonical /progress route.
const ROUTES = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'tested-release-reopen-route-5a7bf6a1.json'), 'utf8'));
const DASH = ROUTES.files['frontend/src/components/AnalyticsDashboard.tsx'].lines;
const ROUTE_PREFIX = (/to=\{`([^`$]*)\$\{session\.id\}`\}/.exec(DASH['500']) || [])[1];
const TARGET = 'https://speaksharp-public.vercel.app';
const reopened = id => TARGET + ROUTE_PREFIX + id;

const UID = '11111111-1111-4111-8111-111111111111', SESSION = '22222222-2222-4222-8222-222222222222';
const LABELS = ['Open with the goal', 'Name the risk', 'Ask for the decision', 'Close with next steps'];
const caseConfig = () => ({
  caseId: 'AHT-02', campaignId: 'R10-3b040043-smoke15', sampleMode: 'smoke', recordingWindowMs: 22850, oracleBindings: {}, targetUrl: TARGET,
  account: { id: UID },
  readback: { origin: 'https://example-project.supabase.co', projectRef: 'example-project', anonKey: 'anon', schemaSha256: 'a'.repeat(64),
              ownerReadApproved: true, rlsReadQualificationReceipt: 'receipt:rls@1' },
  focus: { points: LABELS, speechWindows: [[2.0, 6.5], [9.0, 14.0], [24.0, 29.0], [31.0, 36.0]], expectsLive: [true, true, true, true],
           expectedFinal: ['covered', 'missing', 'covered', 'covered'] },
});
function tables(over = {}) {
  return {
    objective_brief: [{ id: 'brief-1', user_id: UID }],
    objective_session: [{ id: 'os-1', user_id: UID, brief_id: 'brief-1', source_session_id: SESSION }],
    objective_brief_point: LABELS.map((label, i) => ({ id: 'p' + i, user_id: UID, brief_id: 'brief-1', sort_order: i, label })),
    objective_evidence: [['p0', 'detected'], ['p1', 'not_detected'], ['p2', 'not_detected'], ['p3', 'not_detected']]
      .map(([brief_point_id, verdict], i) => ({ id: 'e' + i, user_id: UID, session_id: 'os-1', brief_point_id, verdict })),
    ...over,
  };
}
function mockPage({ db = tables(), url = reopened(SESSION), review = ['From this session', 'Detected: point 1 at 0:05.', 'Not detected: point 2, point 3, point 4.'], failTable = null } = {}) {
  const reads = [];
  return {
    reads,
    url: () => url,
    getByTestId: id => ({ first: () => ({ count: async () => (id === 'review-evidence' && review ? 1 : 0), innerText: async () => (review || []).join('\n') }) }),
    async evaluate(_fn, args) {
      if (args && typeof args.url === 'string') {
        const u = new URL(args.url), table = u.pathname.replace('/rest/v1/', '');
        reads.push(table);
        if (table === failTable) return { data: null, error: { code: 'OWNER_READ_TRANSPORT' } };
        const filters = [...u.searchParams].filter(([k]) => !['select', 'order', 'limit', 'offset'].includes(k)).map(([k, v]) => [k, v.replace(/^eq\./, '')]);
        let rows = (db[table] || []).filter(r => filters.every(([k, v]) => String(r[k]) === v));
        return { data: args.single ? (rows[0] ?? null) : rows, error: null, count: rows.length };
      }
      if (args && args.railTestId) return { ok: true };
      throw new Error('unexpected evaluate');
    },
  };
}
async function readback(page, railStatuses = ['covered', 'missing', 'pending', 'pending'], c = caseConfig()) {
  const evidence = [];
  const oracles = createOracles({ context: {}, guard: {}, caseConfig: c, writeEvidence: async (name, doc) => { evidence.push(doc); return 'evidence/' + name; } });
  await oracles.focusEvidence({ phase: 'begin', page });                   // the EXISTING brief capture in smoke (source-adapters hook)
  const before = page.reads.length;
  let res;
  try { res = await oracles.smokeFocusReadback({ phase: 'assert', page, sessionId: SESSION, railStatuses }); }
  catch (e) { res = { thrown: e.code || e.message }; }
  return { res, newReads: page.reads.slice(before), briefReads: page.reads.filter(t => t === 'objective_brief').length, facts: evidence.at(-1)?.facts };
}

test('composed PASS: brief captured once by the existing begin, +3 owner reads, out-of-window points reported unexercised', async () => {
  const { res, newReads, briefReads, facts } = await readback(mockPage());
  assert.equal(res.result, 'PASS');
  assert.equal(briefReads, 1);                                             // no duplicate objective_brief read
  assert.deepEqual(newReads, ['objective_session', 'objective_brief_point', 'objective_evidence']);
  assert.deepEqual([facts.exercisedOrdinals, facts.unexercisedOrdinals, facts.scope], [[1, 2], [3, 4], 'smoke-saved-focus-readback']);
});

test('composed FAIL: wrong or missing product data', async () => {
  const cases = {
    'no objective for this session (wrong session)': mockPage({ db: tables({ objective_session: [{ id: 'os-9', user_id: UID, brief_id: 'brief-1', source_session_id: 'other' }] }) }),
    'objective bound to another brief': mockPage({ db: tables({ objective_session: [{ id: 'os-1', user_id: UID, brief_id: 'brief-2', source_session_id: SESSION }] }) }),
    'missing saved evidence for an in-window point': mockPage({ db: tables({ objective_evidence: tables().objective_evidence.slice(1) }) }),
    'review evidence missing on the reopened page': mockPage({ review: null }),
  };
  for (const [name, page] of Object.entries(cases)) assert.equal((await readback(page)).res.result, 'FAIL', name);
});

test('composed rail controls: unknown or pending IN-window rail FAILS; out-of-window pending is unexercised', async () => {
  assert.equal((await readback(mockPage(), ['covered', 'BROKEN', 'pending', 'pending'])).res.result, 'FAIL');
  assert.equal((await readback(mockPage(), ['covered', 'pending', 'pending', 'pending'])).res.result, 'FAIL');
  const ok = await readback(mockPage(), ['covered', 'missing', 'pending', 'pending']);
  assert.deepEqual(ok.facts.unexercisedOrdinals, [3, 4]);
});

test('composed altered window: a longer recording window brings pending points into scope and FAILS', async () => {
  const c = caseConfig(); c.recordingWindowMs = 30000;
  assert.equal((await readback(mockPage(), undefined, c)).res.result, 'FAIL');
});

test('composed NOT RUN: an unavailable read, or a page that is not the exact reopened session, is never PASS or FAIL', async () => {
  const pages = [mockPage({ failTable: 'objective_evidence' }),
                 mockPage({ url: TARGET + '/analytics/' + SESSION }),                       // the legacy alias is not where reopen lands
                 mockPage({ url: reopened('33333333-3333-4333-8333-333333333333') }),        // another session
                 mockPage({ url: 'https://evil.example' + ROUTE_PREFIX + SESSION })];         // another origin
  for (const page of pages) {
    const { res } = await readback(page);
    assert.ok(res.thrown === 'NOT_RUN' || res.result === 'NOT RUN', JSON.stringify(res));
  }
});

test('the smoke driver records smoke-focus-readback through this oracle after saveReopen, and the row is in the AHT-02/03 denominator', () => {
  const src = fs.readFileSync(path.join(DA, 'source-adapters.cjs'), 'utf8');
  const at = src.indexOf('await saveReopen(page,first);');
  assert.ok(at > 0 && src.indexOf("if(focus&&smoke)await oracleAssertion('smoke-focus-readback','smokeFocusReadback',{sessionId:first,railStatuses:smokeRail});", at) > at);
  assert.match(src, /smokeRail=states;const verdict=smokeTiming\.focusWindowVerdict\(/);
  for (const id of ['AHT-02', 'AHT-03']) assert.match(src, new RegExp(`'${id}':\\[[^\\]]*'review-reopen','smoke-focus-readback'\\]`));
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'smoke-assertion-catalog.json'), 'utf8'));
  for (const id of ['AHT-02', 'AHT-03']) {
    assert.ok(catalog.cases[id].requiredAssertions.includes('smoke-focus-readback'));
    assert.ok(!catalog.cases[id].requiredAssertions.includes('focus-live-durable'));   // never relabelled as full acceptance
    assert.equal(catalog.cases[id].minimumTakes, 1);
  }
});

test('the route is the tested release source: the open-session-detail link targets /progress/<id>, the canonical route', () => {
  assert.equal(ROUTES.sourceSha, '5a7bf6a1cbd0fb2f4a1c2b363d891c8fcc462bd2');
  assert.equal(ROUTE_PREFIX, '/progress/');
  assert.match(DASH['501'], /data-testid=\{`open-session-detail-\$\{session\.id\}`\}/);      // the exact link ui.reopen clicks
  const app = ROUTES.files['frontend/src/App.tsx'].lines;
  assert.match(app['480'], /<Route path="\/progress\/:sessionId"/);
  assert.match(app['488'], /<Route path="\/analytics\/:sessionId" element=\{<LegacyProgressRedirect \/>\}/);
  // where the release object is present (local clones, full-depth checkouts), the excerpt must be byte-identical to it
  for (const [file, { blobSha, lines }] of Object.entries(ROUTES.files)) {
    let text = null;
    try { text = execFileSync('git', ['cat-file', 'blob', blobSha], { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { continue; }
    const all = text.split('\n');
    for (const [n, line] of Object.entries(lines)) assert.equal(all[Number(n) - 1], line, file + ':' + n);
  }
});
