/**
 * #1258 — Share Feedback stores with a plain insert; only THIS draft's idempotency collision counts as stored.
 *
 * `upsert(..., { onConflict: 'idempotency_key' })` runs `INSERT … ON CONFLICT`, which needs SELECT on the conflict
 * column, and `authenticated` holds INSERT only (tests/db/share-feedback-plain-insert.integration.test.ts proves the
 * 42501 under the real migrations). A plain insert needs no read grant; the unique index still keeps a retried draft
 * to one row, and its collision on this draft's key is success. Every other failure stays a failure.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { FEEDBACK_IDEMPOTENCY_CONSTRAINT, isIdempotentReplay, issueReportService } from '../issueReportService';

vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: vi.fn() }));
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
const emitted: Array<{ event: string; props: Record<string, unknown> }> = [];
vi.mock('@/services/telemetry/safeEmit', () => ({
  safeEmit: (event: string, props: Record<string, unknown>) => { emitted.push({ event, props }); },
}));

const KEY = '130bbc6c-5d89-465d-91e6-51f5a5951e34';
const OTHER_KEY = '2c0c8f53-0d3b-4f45-9d0a-6a0a1d8d1f7e';
const BODY = 'The microphone stopped after one minute and nothing saved.';
const replay = (key = KEY) => ({
  code: '23505',
  message: `duplicate key value violates unique constraint "${FEEDBACK_IDEMPOTENCY_CONSTRAINT}"`,
  details: `Key (idempotency_key)=(${key}) already exists.`,
});

const insert = vi.fn();
const upsert = vi.fn();
const send = (key: string | null = KEY) => issueReportService.submit({
  userId: 'user-1', sessionId: null, category: 'something_else', severity: 'not_applicable', title: 'Mic stopped',
  description: BODY, pageUrl: '/session', metadata: { route: '/session', feedback_kind: 'comment', feedback_type: 'idea' },
  includeAudio: false, idempotencyKey: key,
});
// Codex r4195165652: the DIALOG is the single `feedback_submit` emitter (it owns submit_seq and sees the screen); the
// storage layer emitting too doubled every outcome and left an uncorrelatable orphan. So this layer emits none.
const submits = () => emitted.filter((e) => e.event === 'feedback_submit').map((e) => e.props);

beforeEach(() => {
  vi.clearAllMocks();
  emitted.length = 0;
  insert.mockResolvedValue({ error: null });
  vi.mocked(getSupabaseClient).mockReturnValue({ from: vi.fn(() => ({ insert, upsert })) } as unknown as ReturnType<typeof getSupabaseClient>);
});

describe('#1258 Share Feedback plain insert', () => {
  it('first send: ONE plain insert carrying the draft key; no upsert; stored', async () => {
    await expect(send()).resolves.toEqual({ id: null });
    expect(upsert).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0]).toHaveLength(1); // no ON CONFLICT options
    expect(insert.mock.calls[0][0]).toMatchObject({ idempotency_key: KEY, user_id: 'user-1' });
    expect(submits()).toEqual([]);
  });

  it('retry after a lost response / duplicate delivery: THIS draft\'s idempotency collision is success, not a failure', async () => {
    insert.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: replay() });
    await expect(send()).resolves.toEqual({ id: null });
    await expect(send()).resolves.toEqual({ id: null });
    expect(submits()).toEqual([]);
  });

  it('concurrent delivery: one insert wins, the racing one collides on the same key, and both resolve stored', async () => {
    insert.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: replay() });
    await expect(Promise.all([send(), send()])).resolves.toEqual([{ id: null }, { id: null }]);
  });

  it.each([
    ['another unique constraint (23505, different index)', { code: '23505', message: 'duplicate key value violates unique constraint "user_issue_reports_pkey"', details: 'Key (id)=(x) already exists.' }],
    ['the idempotency index but ANOTHER draft\'s key', replay(OTHER_KEY)],
    ['a check constraint', { code: '23514', message: 'new row for relation "user_issue_reports" violates check constraint "user_issue_reports_title_length"' }],
    ['a permission refusal', { code: '42501', message: 'permission denied for table user_issue_reports' }],
    ['a row-level security refusal', { code: '42501', message: 'new row violates row-level security policy for table "user_issue_reports"' }],
    ['a network failure', { code: '', message: 'TypeError: Failed to fetch' }],
  ])('%s stays a FAILURE: it throws (the dialog records the one storage_failed)', async (_label, error) => {
    insert.mockResolvedValue({ error });
    await expect(send()).rejects.toBe(error);
    expect(submits()).toEqual([]);
  });

  it('a draft with no key never treats a collision as stored', async () => {
    insert.mockResolvedValue({ error: replay() });
    await expect(send(null)).rejects.toBeTruthy();
    expect(isIdempotentReplay(replay(), null)).toBe(false);
  });

  it('isIdempotentReplay accepts the constraint without details (no key to contradict) and rejects a malformed code', () => {
    expect(isIdempotentReplay({ code: '23505', message: replay().message }, KEY)).toBe(true);
    expect(isIdempotentReplay({ ...replay(), code: 23505 }, KEY)).toBe(false);
    expect(isIdempotentReplay(null, KEY)).toBe(false);
  });

  it('no content reaches telemetry on success, replay or failure', async () => {
    insert.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: replay() }).mockResolvedValueOnce({ error: { code: '42501', message: 'permission denied for table user_issue_reports' } });
    await send(); await send(); await send().catch(() => undefined);
    const wire = JSON.stringify(emitted);
    expect(wire).not.toContain(BODY);
    expect(wire).not.toContain(KEY);
    expect(wire).not.toMatch(/permission denied|duplicate key|user_issue_reports/);
  });
});
