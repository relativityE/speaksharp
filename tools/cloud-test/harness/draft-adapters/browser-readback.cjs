'use strict';
// Exact-source port, not executed live. Source: main70e, rwt-save-retry-recovery:50-65,
// rwt-feedback-association-boundaries:170-181. RLS-denied reads are NOT RUN; no admin fallback.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function missing(message) { const e = new Error(message); e.code = 'NOT_RUN'; throw e; }
function validateReadback(c) {
  if (!UUID.test(c?.account?.id || '')) missing('readback requires the privately bound own account UUID');
  const b = c.readback;
  if (!b || !/^[a-z0-9-]+$/.test(b.projectRef || '') || typeof b.anonKey !== 'string' || !b.anonKey) missing('readback requires selected public Supabase project binding');
  let u; try { u = new URL(b.origin); } catch { missing('readback origin missing'); }
  if (u.protocol !== 'https:' || u.origin !== b.origin || u.username || u.password) missing('readback requires exact HTTPS API origin');
  if (!/^[0-9a-f]{64}$/.test(b.schemaSha256 || '') || !b.ownerReadApproved || !b.rlsReadQualificationReceipt) missing('readback schema/RLS/owner GET approval unbound');
  return b;
}
async function read(page, c, kind, since) {
  const b = validateReadback(c);
  if (!['sessions', 'feedback'].includes(kind)) missing('unsupported readback');
  const table = kind === 'sessions' ? 'sessions' : 'user_issue_reports';
  const columns = kind === 'sessions' ? 'id,user_id,status,idempotency_key,transcript_state,transcript,created_at' : 'id,user_id,session_id,metadata,created_at';
  const url = new URL('/rest/v1/' + table, b.origin);
  url.searchParams.set('select', columns); url.searchParams.set('user_id', 'eq.' + c.account.id);
  url.searchParams.set('order', 'created_at.asc'); url.searchParams.set('limit', '101');
  if (kind === 'feedback') { if (!Number.isFinite(Date.parse(since))) missing('feedback start boundary missing'); url.searchParams.set('created_at', 'gte.' + since); }
  // Tokens NEVER cross the page boundary. Browser fetch follows the same already-qualified proxy guard.
  const result = await page.evaluate(async (p) => {
    const raw = localStorage.getItem('sb-' + p.projectRef + '-auth-token');
    let auth; try { auth = JSON.parse(raw || 'null'); } catch { return { error: 'auth_unreadable' }; }
    if (!auth || auth.user?.id !== p.uid || typeof auth.access_token !== 'string') return { error: 'owner_session_mismatch' };
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(p.url, { method: 'GET', redirect: 'error', cache: 'no-store', credentials: 'omit',
        headers: { apikey: p.anonKey, Authorization: 'Bearer ' + auth.access_token, Accept: 'application/json' }, signal: controller.signal });
      if (response.status !== 200) return { error: 'readback_http', status: response.status };
      const text = await response.text(); if (text.length > 1048576) return { error: 'readback_oversize' };
      let rows; try { rows = JSON.parse(text); } catch { return { error: 'readback_json' }; }
      if (!Array.isArray(rows) || rows.length > 100 || rows.some(r => !r || r.user_id !== p.uid)) return { error: 'readback_scope_or_shape' };
      if (p.kind === 'sessions') return { rows: await Promise.all(rows.map(async r => ({ id: r.id, status: r.status, hasIdempotencyKey: typeof r.idempotency_key === 'string' && r.idempotency_key.length > 0,
        transcriptState: r.transcript_state, transcriptLength: typeof r.transcript === 'string' ? r.transcript.trim().length : 0,
        transcriptSha256:typeof r.transcript==='string'?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(r.transcript.trim())))).map(x=>x.toString(16).padStart(2,'0')).join(''):null }))) };
      // Metadata is NOT exported. Only a narrow association summary leaves the browser.
      return { rows: rows.map(r => { const v=r.metadata?.coaching_diagnostic_ref;
        const diagnosticKind=v===undefined||v===null?'absent':typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)?'valid':'malformed';
        return { id:r.id,sessionId:r.session_id,diagnosticKind,diagnosticRef:diagnosticKind==='valid'?v:null }; }) };
    } catch { return { error: 'readback_transport' }; } finally { clearTimeout(timer); }
  }, { url: url.href, projectRef: b.projectRef, anonKey: b.anonKey, uid: c.account.id, kind });
  if (!result || result.error) missing('owner readback incomplete: ' + (result?.error || 'missing_result'));
  return result.rows; // IDs stay in memory for owner/take correlation, never public evidence.
}
module.exports = { validateReadback, sessions: (page,c) => read(page,c,'sessions'), feedback: (page,c,since) => read(page,c,'feedback',since) };
