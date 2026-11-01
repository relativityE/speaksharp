import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  verifyLiveJourneyAccounts, LIVE_JOURNEY_ROLES, liveJourneyMaskValues, maskCommands, parseLiveAccountsBundle, isProjectOrigin,
} from '../../scripts/verify-test-users.mjs';

/**
 * Sam 1793541050.190059 / 1793544453.003099: the Cloud test live run's two REQUIRED accounts, verified by role only from the private
 * CLOUD_TEST_LIVE_ACCOUNTS bundle. Reconciles historical aa2ff01a (verifyThrowaway): the same stubbed auth listing and no-identifier
 * output checks, without its in-job id file, widened to both roles with the profile tier and the bundle's own account ids.
 */
// SHARED with tools/cloud-test/tests/test_init_run_inputs.py: the identical vector text, pinned by the same sha256 in both suites, so
// the two consumers of the bundle agree on every accepted and refused shape and its code.
const VECTORS_TEXT = String.raw`{"bundles": [
["valid", "ok", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["missing", "bundle-missing", ""],
["whitespace only", "bundle-missing", "   \n"],
["not JSON", "bundle-not-json", "{not json"],
["too large", "bundle-too-large", "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"],
["version 2", "bundle-shape", "{\"version\": 2, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["version true", "bundle-shape", "{\"version\": true, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["top-level password", "bundle-shape", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}, \"password\": \"p\"}"],
["top-level array", "bundle-shape", "[]"],
["account password", "bundle-shape", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\", \"password\": \"p\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["account id missing", "bundle-shape", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\"}}}"],
["role missing", "bundle-shape", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}}}"],
["extra role", "bundle-shape", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}, \"pro\": {\"email\": \"p@x.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}}}"],
["project uppercase", "bundle-project", "{\"version\": 1, \"projectRef\": \"ABCDEFGHIJKLMNOPQRST\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["project short", "bundle-project", "{\"version\": 1, \"projectRef\": \"abc\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email LF", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"a@x.invalid\\nX: y\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email CR", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"a@x.invalid\\r\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email tab", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"a\\t@x.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email DEL", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"a@x.invalid\\u007f\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email no at", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email two at", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"a@b@x.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email leading space", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \" a@x.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email not string", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": 7, \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["account id uppercase", "bundle-account-id", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"AAAAAAAA-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["account id v1", "bundle-account-id", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-1111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["account id not string", "bundle-account-id", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": 1}}}"],
["same email any case", "bundle-duplicate", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"THROWAWAY.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["same account id", "bundle-duplicate", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}}}"],
["email U+0085", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"a\\u0085@x.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email supplementary character", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"a\\ud83d\\ude00@x.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email non-ASCII letter", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"caf\\u00e9@x.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email NBSP", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"a\\u00a0b@x.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email 255 characters", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@x.invalid12\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email 254 characters", "ok", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@x.invalid12\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"]
],
"urls": [
["origin", "ok", "https://abcdefghijklmnopqrst.supabase.co"],
["origin with slash", "ok", "https://abcdefghijklmnopqrst.supabase.co/"],
["default port", "ok", "https://abcdefghijklmnopqrst.supabase.co:443"],
["upper-case host", "ok", "https://ABCDEFGHIJKLMNOPQRST.supabase.co"],
["http", "bundle-project-mismatch", "http://abcdefghijklmnopqrst.supabase.co"],
["other project", "bundle-project-mismatch", "https://zzzzzzzzzzzzzzzzzzzz.supabase.co"],
["suffixed domain", "bundle-project-mismatch", "https://abcdefghijklmnopqrst.supabase.co.evil.example"],
["wrong domain", "bundle-project-mismatch", "https://abcdefghijklmnopqrst.evil.example"],
["userinfo", "bundle-project-mismatch", "https://user:pw@abcdefghijklmnopqrst.supabase.co"],
["empty userinfo", "bundle-project-mismatch", "https://@abcdefghijklmnopqrst.supabase.co"],
["unexpected port", "bundle-project-mismatch", "https://abcdefghijklmnopqrst.supabase.co:8443"],
["path", "bundle-project-mismatch", "https://abcdefghijklmnopqrst.supabase.co/rest/v1"],
["query", "bundle-project-mismatch", "https://abcdefghijklmnopqrst.supabase.co?x=1"],
["fragment", "bundle-project-mismatch", "https://abcdefghijklmnopqrst.supabase.co#f"],
["not a URL", "bundle-project-mismatch", "not a url"],
["empty", "bundle-project-mismatch", ""]
]}`;
const VECTORS_SHA256 = 'ca05b324277e3c5318a6bd398204bb5e9fbc21941141b396161171f837108d58';
const VECTOR_DOC = JSON.parse(VECTORS_TEXT);
const VECTORS = VECTOR_DOC.bundles;
const URL_VECTORS = VECTOR_DOC.urls;

const PROJECT = 'abcdefghijklmnopqrst';
const URL_OK = `https://${PROJECT}.supabase.co`;
const THROWAWAY = 'throwaway.synthetic@example.invalid';
const FREE = 'free.synthetic@example.invalid';
const T_ID = '11111111-1111-4111-8111-111111111111';
const F_ID = '22222222-2222-4222-8222-222222222222';
const RAW = VECTORS.find(([name]) => name === 'valid')[2];
const bundle = (mutate) => { const d = JSON.parse(RAW); mutate(d); return JSON.stringify(d); };

function world({ users = [{ id: 'other', email: 'someone@example.invalid' }, { id: T_ID, email: THROWAWAY.toUpperCase() }, { id: F_ID, email: FREE }],
  profiles = [{ id: T_ID, subscription_status: 'free' }, { id: F_ID, subscription_status: 'free' }], profileError = null, listError = null } = {}) {
  const queries = [];
  const ids = (q) => q.in?.[1] ?? [];
  const supabase = {
    from(table) {
      const q = { table, select: null, in: null };
      queries.push(q);
      const builder = {
        select(columns) { q.select = columns; return builder; },
        in(column, list) { q.in = [column, [...list]]; return builder; },
        then(ok, fail) { return Promise.resolve(profileError ? { data: null, error: profileError } : { data: profiles.filter((p) => ids(q).includes(p.id)), error: null }).then(ok, fail); },
      };
      return builder;
    },
  };
  const listUsers = async () => { if (listError) throw listError; return users; };
  return { supabase, listUsers, queries };
}
const verify = (w, raw = RAW, supabaseUrl = URL_OK) => verifyLiveJourneyAccounts({ supabase: w.supabase, raw, supabaseUrl, listUsers: w.listUsers });
const ROW = { authUserExists: true, tierMatches: true, idMatches: true, pass: true };
const leaks = (value) => new RegExp(`${T_ID}|${F_ID}|synthetic|example\\.invalid|${PROJECT}`, 'i').test(JSON.stringify(value));

describe('the private CLOUD_TEST_LIVE_ACCOUNTS bundle', () => {
  it('the shared vectors are the pinned ones', () => {
    expect(createHash('sha256').update(VECTORS_TEXT).digest('hex')).toBe(VECTORS_SHA256);
    expect(VECTORS.length).toBeGreaterThan(20);
  });

  it.each(VECTORS)('vector "%s" gives %s', (_name, code, raw) => {
    if (code === 'ok') {
      expect(parseLiveAccountsBundle(raw).projectRef).toBe(PROJECT);
      return;
    }
    let err;
    try { parseLiveAccountsBundle(raw); } catch (e) { err = e; }
    // The exact fixed code is the whole message: no part of the bundle is ever echoed.
    expect(err?.message).toBe(`LIVE_JOURNEY_ACCOUNTS_CONFIG: ${code}`);
  });

  it.each(URL_VECTORS)('origin vector "%s" gives %s', async (_name, code, url) => {
    expect(isProjectOrigin(url, PROJECT)).toBe(code === 'ok');
    if (code !== 'ok') {
      const w = world();
      await expect(verifyLiveJourneyAccounts({ supabase: w.supabase, raw: RAW, supabaseUrl: url, listUsers: w.listUsers }))
        .rejects.toThrow(`LIVE_JOURNEY_ACCOUNTS_CONFIG: ${code}`);
      expect(w.queries).toEqual([]);
    }
  });

  it('masks the whole bundle even when it is malformed, and every extracted email and id once it parses', () => {
    expect(liveJourneyMaskValues('{not json')).toEqual(['{not json']);
    const values = liveJourneyMaskValues(RAW);
    expect(values[0]).toBe(RAW);
    expect(new Set(values)).toEqual(new Set([RAW, THROWAWAY, FREE, T_ID, F_ID]));
    for (const line of maskCommands(liveJourneyMaskValues(`{"a":\n"b"}`))) expect(line).not.toMatch(/[\r\n]/);
  });
});

describe('verify-test-users live-journey-accounts target', () => {
  it('reports both required roles by role only, with one profile read and no identifier', async () => {
    const w = world();
    const out = await verify(w);
    expect(out).toEqual({ target: 'live-journey-accounts', allPass: true, results: [
      { role: 'existing-disposable', ...ROW }, { role: 'maintained-read-only', ...ROW }] });
    expect(leaks(out)).toBe(false);
    expect(w.queries).toEqual([{ table: 'user_profiles', select: 'id, subscription_status', in: ['id', [T_ID, F_ID]] }]);
    expect(LIVE_JOURNEY_ROLES.map((r) => [r.role, r.expectedTier])).toEqual([['existing-disposable', 'free'], ['maintained-read-only', 'free']]);
  });

  it('compares each found account with the bundle id; a wrong id or a cross-role swap fails without naming it', async () => {
    const w = world();
    const wrong = await verify(w, bundle((d) => { d.accounts['maintained-read-only'].accountId = '33333333-3333-4333-8333-333333333333'; }));
    expect(wrong.results.map((r) => [r.role, r.idMatches, r.pass])).toEqual([['existing-disposable', true, true], ['maintained-read-only', false, false]]);
    const swapped = await verify(w, bundle((d) => { d.accounts['existing-disposable'].accountId = F_ID; d.accounts['maintained-read-only'].accountId = T_ID; }));
    expect(swapped.results.map((r) => [r.role, r.idMatches, r.pass])).toEqual([['existing-disposable', false, false], ['maintained-read-only', false, false]]);
    expect(swapped.allPass).toBe(false);
    expect(leaks([wrong, swapped])).toBe(false);
  });

  it('a missing account or wrong tier fails that role without naming it', async () => {
    const cases = [
      [world({ users: [{ id: T_ID, email: THROWAWAY }] }), 'maintained-read-only', { authUserExists: false, tierMatches: false, idMatches: false }],
      [world({ profiles: [{ id: T_ID, subscription_status: 'free' }] }), 'maintained-read-only', { authUserExists: true, tierMatches: false, idMatches: true }],
      [world({ profiles: [{ id: T_ID, subscription_status: 'pro' }, { id: F_ID, subscription_status: 'free' }] }), 'existing-disposable', { authUserExists: true, tierMatches: false, idMatches: true }],
    ];
    for (const [w, role, facts] of cases) {
      const out = await verify(w);
      expect(out.allPass).toBe(false);
      expect(out.results.find((r) => r.role === role)).toEqual({ role, ...facts, pass: false });
      expect(leaks(out)).toBe(false);
    }
  });

  it('the bundle project must be the SUPABASE_URL project; a refused bundle reads nothing', async () => {
    const w = world();
    // Called directly: the verify() helper's default parameter would replace an undefined URL with the valid one.
    for (const supabaseUrl of ['https://zzzzzzzzzzzzzzzzzzzz.supabase.co', 'not a url', undefined, '']) {
      await expect(verifyLiveJourneyAccounts({ supabase: w.supabase, raw: RAW, supabaseUrl, listUsers: w.listUsers }))
        .rejects.toThrow(/^LIVE_JOURNEY_ACCOUNTS_CONFIG: bundle-project-mismatch$/);
    }
    await expect(verify(w, '{not json')).rejects.toThrow(/^LIVE_JOURNEY_ACCOUNTS_CONFIG: bundle-not-json$/);
    expect(w.queries).toEqual([]);
  });

  it('every read failure becomes one fixed code: no SDK message, email or id can leak', async () => {
    const sdk = new Error(`lookup failed for ${THROWAWAY} id ${T_ID}`);
    for (const w of [world({ listError: sdk }), world({ profileError: { message: `denied for ${F_ID}` } })]) {
      const err = await verify(w).catch((e) => e);
      expect(err.message).toBe('LIVE_JOURNEY_ACCOUNTS_READ_FAILED');
      expect(leaks(err.message)).toBe(false);
    }
  });

  it('mask commands escape their data, stay one line each, and mask every line of a multi-line value', () => {
    expect(maskCommands(['a%b'])).toEqual(['::add-mask::a%25b']);
    expect(maskCommands(['%0A'])).toEqual(['::add-mask::%250A'], 'a literal %0A is escaped, never decoded into a break');
    const multi = maskCommands([`first@example.invalid\nsecond-part\r\nthird`]);
    expect(multi).toEqual(['::add-mask::first@example.invalid%0Asecond-part%0D%0Athird', '::add-mask::first@example.invalid',
      '::add-mask::second-part', '::add-mask::third']);
    for (const line of [...multi, ...maskCommands(['x\ry', 'z\n'])]) {
      expect(line).not.toMatch(/[\r\n]/);
      expect(line.startsWith('::add-mask::')).toBe(true);
    }
    expect(maskCommands(['', '  ', null, undefined, 7])).toEqual([]);
    const src = readFileSync(resolve(process.cwd(), 'scripts/verify-test-users.mjs'), 'utf8');
    expect(src).toContain('for (const command of maskCommands(liveJourneyMaskValues(raw))) process.stdout.write(`${command}\\n`);');
    expect(src.match(/::add-mask::\$\{value\}/g)).toBeNull();
  });

  it('writes nothing: the target has no file, insert, update or sign-in path (historical no-overwrite protection)', async () => {
    const src = readFileSync(resolve(process.cwd(), 'scripts/verify-test-users.mjs'), 'utf8');
    const body = src.slice(src.indexOf('export function parseLiveAccountsBundle('), src.indexOf('export function statusLine('));
    for (const token of ['writeFile', 'appendFile', '.insert(', '.update(', '.upsert(', '.delete(', 'signIn', 'console.']) expect(body).not.toContain(token);
  });
});
