/**
 * J8 parent delete (Sam on 65365f36): the scoped delete is given what is left of the parent's cleanup budget as a deadline. Without
 * one, or past it, the script starts nothing: it refuses before any client is built, so this proof touches no service.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = path.resolve(__dirname, '..', '..');
const TSX = path.join(REPO, 'node_modules', '.bin', 'tsx');
const SCRIPT = path.join(REPO, 'scripts', 'rwt-j8-parent-delete.mts');
const BASE = {
    PATH: process.env.PATH ?? '',
    SUPABASE_URL: 'http://127.0.0.1:9',
    SUPABASE_SERVICE_ROLE_KEY: 'k',
    RWT_J8_DELETE_UID: 'u1',
    RWT_J8_DELETE_EMAIL: 'rwt-journey-a@t.example.com',
};

describe('rwt-j8-parent-delete refuses without a live deadline', () => {
    it.each([
        ['no deadline', undefined],
        ['an unreadable deadline', 'soon'],
        ['a deadline already past', String(Date.now() - 1)],
    ])('%s: exit 78, blocked_setup, nothing started', (_name, deadline) => {
        const env: Record<string, string> = { ...BASE, ...(deadline === undefined ? {} : { RWT_J8_DELETE_DEADLINE_AT: deadline }) };
        const r = spawnSync(TSX, [SCRIPT], { env, encoding: 'utf8', timeout: 60_000 });
        expect({ status: r.status, err: r.stderr.trim() }).toEqual({ status: 78, err: 'RWT_J8_PARENT_DELETE blocked_setup' });
    }, 70_000);
});
