// #1846 — a PostgREST-shaped `fetch` over PGlite, so the REAL `@supabase/supabase-js` client and the REAL
// `frontend/src/lib/storage.ts` functions can run against real PostgreSQL executing the checked-in migrations.
//
// WHY. A fake client that records calls proves only what the client SENDS. It cannot show that the database
// accepts the request, that the metric lands in the column it was meant for, or that a refusal reaches the
// caller as a failure. Here every request becomes real SQL, run the way PostgREST runs it: one transaction per
// request, `SET LOCAL ROLE` to the JWT's role, and the JWT claims exposed ONLY through `request.jwt.claims` (as
// PostgREST v12 does), so `auth.uid()`, RLS policies and column grants see the caller the way production does. The
// database must therefore carry Supabase's own `auth.uid()`/`auth.role()`/`auth.jwt()`, which read that setting.
//
// SCOPE IS DELIBERATELY NARROW. Only the request shapes the session save path uses are implemented:
//   - POST  /rest/v1/rpc/<fn>          named-argument function calls
//   - PATCH /rest/v1/<table>?col=eq.v  updates with `eq` filters
//   - GET   /rest/v1/<table>?select=…&col=eq.v  reads with `eq` filters (object or array response)
// Anything else is refused with a 501 and recorded in `unsupported`, so a test can assert that nothing it relied on
// went through an unimplemented path. It never guesses at semantics it does not model.
//
// NOT MODELLED (stated so nobody over-reads the result): JWT signatures and expiry are not verified (the token is
// decoded, not trusted from a network peer); the JWT carries only `sub` and `role`; HTTP statuses follow PostgREST's
// SQLSTATE table (httpStatusFor) but supabase-js does not branch on them on this path; embedded resources, ordering,
// ranges, non-`eq` filters and `Prefer: return=representation` are refused. Who OWNS the SECURITY DEFINER functions is
// the database fixture's job, not this transport's.
import type { PGlite, Transaction } from '@electric-sql/pglite';

export const FAKE_SUPABASE_URL = 'http://postgrest-pglite.invalid';
export const FAKE_ANON_KEY = 'postgrest-pglite-anon-key';

/** One request as the emulator answered it. `response` is the decoded JSON body (null for 204). */
export type RecordedRequest = { method: string; path: string; query: Record<string, string>; status: number; response: unknown };

type Claims = { sub?: string; role?: string };

const b64url = (value: string) => Buffer.from(value, 'utf8').toString('base64url');

/** An UNSIGNED JWT-shaped token carrying `sub` and `role`. The emulator decodes it; nothing verifies it. */
export function testAccessToken(sub: string, role = 'authenticated'): string {
  return `${b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${b64url(JSON.stringify({ sub, role }))}.unsigned`;
}

function decodeClaims(authorization: string | null): Claims {
  const token = authorization?.replace(/^Bearer\s+/i, '') ?? '';
  const parts = token.split('.');
  if (parts.length !== 3) return { role: 'anon' };
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Claims;
    return { sub: typeof claims.sub === 'string' ? claims.sub : undefined, role: claims.role === 'authenticated' ? 'authenticated' : 'anon' };
  } catch {
    return { role: 'anon' };
  }
}

const IDENT = /^[a-z_][a-z0-9_]*$/;
const quoteIdent = (name: string) => {
  if (!IDENT.test(name)) throw new UnsupportedRequest(`identifier not supported: ${name}`);
  return `"${name}"`;
};

class UnsupportedRequest extends Error {}
class PostgrestError extends Error {
  constructor(readonly status: number, readonly body: Record<string, unknown>) { super(String(body.message)); }
}

/** PostgREST's documented SQLSTATE → HTTP table. Anything it does not list is a 400, as in PostgREST. */
function httpStatusFor(sqlstate: string | undefined, role: string): number {
  if (!sqlstate) return 500;
  if (sqlstate === '42501') return role === 'anon' ? 401 : 403;
  if (sqlstate === '23503' || sqlstate === '23505') return 409;
  if (sqlstate === '42883' || sqlstate === '42P01') return 404;
  if (sqlstate === '25006') return 405;
  if (sqlstate === 'P0001') return 400;
  if (/^(08|53)/.test(sqlstate)) return 503;
  if (/^(0L|0P|28)/.test(sqlstate)) return 403;
  if (/^(09|25|2D|38|39|3B|40|54|55|57|58|F0|HV|P0|XX)/.test(sqlstate) || sqlstate === '42P17') return 500;
  return 400;
}

function pgErrorBody(error: unknown): { sqlstate?: string; body: Record<string, unknown> } {
  const e = error as { code?: string; message?: string; detail?: string; hint?: string };
  return {
    sqlstate: e.code,
    body: { code: e.code ?? 'XX000', message: e.message ?? 'unknown error', details: e.detail ?? null, hint: e.hint ?? null },
  };
}

type ColumnTypes = Map<string, string>;

async function columnTypes(tx: Transaction, table: string): Promise<ColumnTypes> {
  const r = await tx.query<{ column_name: string; t: string }>(
    `SELECT a.attname AS column_name, format_type(a.atttypid, a.atttypmod) AS t
       FROM pg_attribute a WHERE a.attrelid = to_regclass($1) AND a.attnum > 0 AND NOT a.attisdropped`,
    [`public.${table}`]);
  if (r.rows.length === 0) {
    throw new PostgrestError(404, { code: '42P01', message: `relation "public.${table}" does not exist`, details: null, hint: null });
  }
  return new Map(r.rows.map(row => [row.column_name, row.t]));
}

/** Encode a JSON value as a text parameter for `$n::type`, the way PostgREST hands JSON scalars to PostgreSQL. */
function encodeParam(value: unknown, type: string): string | null {
  if (value === null || value === undefined) return null;
  if (type === 'jsonb' || type === 'json') return JSON.stringify(value);
  if (typeof value === 'object') throw new UnsupportedRequest(`a JSON ${Array.isArray(value) ? 'array' : 'object'} for a ${type} value`);
  return String(value);
}

function eqFilters(table: string, query: Record<string, string>, types: ColumnTypes, params: (string | null)[]): string {
  const clauses: string[] = [];
  for (const [key, raw] of Object.entries(query)) {
    if (key === 'select') continue;
    if (!raw.startsWith('eq.')) throw new UnsupportedRequest(`filter operator not supported: ${key}=${raw}`);
    const type = types.get(key);
    if (!type) {
      throw new PostgrestError(400, { code: '42703', message: `column ${table}.${key} does not exist`, details: null, hint: null });
    }
    params.push(raw.slice(3));
    clauses.push(`${quoteIdent(key)} = $${params.length}::${type}`);
  }
  return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
}

async function asRequestRole(db: PGlite, claims: Claims, body: (tx: Transaction) => Promise<unknown>): Promise<unknown> {
  return db.transaction(async tx => {
    await tx.query(
      `SELECT set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify(claims.sub ? { sub: claims.sub, role: claims.role ?? 'anon' } : { role: claims.role ?? 'anon' })]);
    await tx.exec(`SET LOCAL ROLE ${claims.role === 'authenticated' ? 'authenticated' : 'anon'}`);
    return body(tx);
  });
}

async function rpc(tx: Transaction, fn: string, args: Record<string, unknown>): Promise<unknown> {
  // Overload resolution by argument NAMES, as PostgREST does: the supplied names must all exist, and every
  // argument without a default must be supplied. Zero matches is PGRST202, more than one is PGRST203.
  const r = await tx.query<{ oid: number; names: string[] | null; types: string[]; nargs: number; ndefaults: number }>(
    `SELECT p.oid, p.proargnames AS names, p.pronargs AS nargs, p.pronargdefaults AS ndefaults,
            ARRAY(SELECT format_type(t, NULL) FROM unnest(p.proargtypes) AS t) AS types
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = $1`, [quoteIdent(fn).slice(1, -1)]);
  const supplied = Object.keys(args);
  const candidates = r.rows.filter(row => {
    const names = (row.names ?? []).slice(0, row.nargs);
    if (!supplied.every(k => names.includes(k))) return false;
    const required = names.slice(0, row.nargs - row.ndefaults);
    return required.every(k => supplied.includes(k));
  });
  if (candidates.length === 0) {
    throw new PostgrestError(404, {
      code: 'PGRST202', message: `Could not find the function public.${fn}(${supplied.sort().join(', ')}) in the schema cache`,
      details: null, hint: null,
    });
  }
  if (candidates.length > 1) {
    throw new PostgrestError(300, { code: 'PGRST203', message: `Could not choose the best candidate function for public.${fn}`, details: null, hint: null });
  }
  const chosen = candidates[0];
  const names = (chosen.names ?? []).slice(0, chosen.nargs);
  const params: (string | null)[] = [];
  const named = supplied.map(k => {
    const type = chosen.types[names.indexOf(k)];
    params.push(encodeParam(args[k], type));
    return `${quoteIdent(k)} => $${params.length}::${type}`;
  });
  const result = await tx.query<{ r: unknown }>(`SELECT to_jsonb(public.${quoteIdent(fn)}(${named.join(', ')})) AS r`, params);
  return result.rows[0]?.r ?? null;
}

async function patch(tx: Transaction, table: string, query: Record<string, string>, body: Record<string, unknown>): Promise<void> {
  const types = await columnTypes(tx, table);
  const params: (string | null)[] = [];
  const sets = Object.entries(body).map(([col, value]) => {
    const type = types.get(col);
    if (!type) {
      throw new PostgrestError(400, {
        code: 'PGRST204', message: `Could not find the '${col}' column of '${table}' in the schema cache`, details: null, hint: null,
      });
    }
    params.push(encodeParam(value, type));
    return `${quoteIdent(col)} = $${params.length}::${type}`;
  });
  if (sets.length === 0) return;
  const where = eqFilters(table, query, types, params);
  await tx.query(`UPDATE public.${quoteIdent(table)} SET ${sets.join(', ')} ${where}`, params);
}

async function select(tx: Transaction, table: string, query: Record<string, string>): Promise<unknown[]> {
  const types = await columnTypes(tx, table);
  const columns = (query.select ?? '*').split(',').map(c => c.trim()).filter(Boolean);
  for (const c of columns) {
    if (c !== '*' && !types.has(c)) {
      throw new PostgrestError(400, { code: '42703', message: `column ${table}.${c} does not exist`, details: null, hint: null });
    }
  }
  const list = columns.includes('*') ? '*' : columns.map(quoteIdent).join(', ');
  const params: (string | null)[] = [];
  const where = eqFilters(table, query, types, params);
  const r = await tx.query<{ j: unknown }>(`SELECT to_jsonb(t) AS j FROM (SELECT ${list} FROM public.${quoteIdent(table)} ${where}) t`, params);
  return r.rows.map(row => row.j);
}

export type PostgrestPglite = {
  fetch: typeof fetch;
  requests: RecordedRequest[];
  unsupported: string[];
};

/**
 * Build the `fetch` to hand to `createClient(..., { global: { fetch } })`. `intercept` lets a test rewrite or fail a
 * request BEFORE it reaches the database — used only by negative controls and transport-failure cases.
 */
export function postgrestPglite(
  db: PGlite,
  intercept?: (req: { method: string; path: string; body: unknown }) => { body?: unknown; networkError?: Error } | undefined,
): PostgrestPglite {
  const requests: RecordedRequest[] = [];
  const unsupported: string[] = [];

  const respond = (status: number, payload: unknown, record: Omit<RecordedRequest, 'status' | 'response'>) => {
    requests.push({ ...record, status, response: status === 204 ? null : payload });
    if (status === 204) return new Response(null, { status });
    return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
  };

  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const query = Object.fromEntries(url.searchParams.entries());
    const record = { method, path: url.pathname, query };
    const text = method === 'GET' || method === 'HEAD' ? '' : await request.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      return respond(400, { code: 'PGRST102', message: 'Empty or invalid json', details: null, hint: null }, record);
    }

    const override = intercept?.({ method, path: url.pathname, body });
    if (override?.networkError) throw override.networkError;
    if (override && 'body' in override) body = override.body;

    const claims = decodeClaims(request.headers.get('authorization'));
    const accept = request.headers.get('accept') ?? '';
    try {
      if (url.origin !== new URL(FAKE_SUPABASE_URL).origin || !url.pathname.startsWith('/rest/v1/')) {
        throw new UnsupportedRequest(`${method} ${url.pathname}`);
      }
      const resource = url.pathname.slice('/rest/v1/'.length);
      if (method === 'POST' && resource.startsWith('rpc/')) {
        const data = await asRequestRole(db, claims, tx => rpc(tx, resource.slice(4), (body ?? {}) as Record<string, unknown>));
        return respond(200, data, record);
      }
      if (resource.includes('/') || !IDENT.test(resource)) throw new UnsupportedRequest(`${method} ${url.pathname}`);
      if (method === 'PATCH') {
        if ((request.headers.get('prefer') ?? '').includes('return=representation')) {
          throw new UnsupportedRequest('PATCH with return=representation');
        }
        await asRequestRole(db, claims, tx => patch(tx, resource, query, (body ?? {}) as Record<string, unknown>));
        return respond(204, null, record);
      }
      if (method === 'GET') {
        const rows = (await asRequestRole(db, claims, tx => select(tx, resource, query))) as unknown[];
        if (accept.includes('application/vnd.pgrst.object+json')) {
          if (rows.length !== 1) {
            return respond(406, {
              code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned',
              details: `The result contains ${rows.length} rows`, hint: null,
            }, record);
          }
          return respond(200, rows[0], record);
        }
        return respond(200, rows, record);
      }
      throw new UnsupportedRequest(`${method} ${url.pathname}`);
    } catch (error) {
      if (error instanceof UnsupportedRequest) {
        unsupported.push(error.message);
        return respond(501, { code: 'EMULATOR_UNSUPPORTED', message: error.message, details: null, hint: null }, record);
      }
      if (error instanceof PostgrestError) return respond(error.status, error.body, record);
      const { sqlstate, body: errBody } = pgErrorBody(error);
      return respond(httpStatusFor(sqlstate, claims.role ?? 'anon'), errBody, record);
    }
  };

  return { fetch: handler as typeof fetch, requests, unsupported };
}
