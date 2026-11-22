/**
 * J8 nightly entry, parent recovery (Sam on 27ee1856, route (b)): the established scoped delete (runOwnedCleanup.ts
 * `cleanupRunOwnedAccount`) for the ONE account the parent found under this run's reservation and checked is bound to this run and
 * attempt. Run only by the parent (j8-live-adapters.cjs `scopedDelete`), after the J8 spec has exited, never by the spec.
 * The helper re-checks the id against the reserved email, the run-owned prefix and the run binding (GITHUB_* set by the parent to
 * the binding it checked), settles stopped takes, claims and clears the save journal, deletes the account, proves it gone and reads
 * every residue store at zero; it prints `RUN_OWNED_CLEANUP cleanup_verified ...` only after all of that. Exit 0 only then; 1 when
 * the helper refused or failed (its closed step code, never an id or email); 78 when the inputs are missing.
 * Inputs (env, set by the parent): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RWT_J8_DELETE_UID, RWT_J8_DELETE_EMAIL, and
 * RWT_J8_DELETE_DEADLINE_AT (epoch ms, from what is left of the parent's cleanup budget; Sam on 65365f36). Past it, nothing starts;
 * the parent kills the process tree at it either way, and counts nothing it could not confirm stopped.
 */
import { createClient } from '@supabase/supabase-js';
import { cleanupFailureStep, cleanupRunOwnedAccount } from '../tests/live/helpers/runOwnedCleanup';

const RUN_OWNED_PREFIX = 'rwt-journey-';
const url = process.env.SUPABASE_URL ?? '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const uid = process.env.RWT_J8_DELETE_UID ?? '';
const email = (process.env.RWT_J8_DELETE_EMAIL ?? '').toLowerCase();
const deadlineAt = Number(process.env.RWT_J8_DELETE_DEADLINE_AT ?? '');

async function main(): Promise<number> {
    if (!url || !key || !uid || !email.startsWith(RUN_OWNED_PREFIX) || !Number.isFinite(deadlineAt) || Date.now() >= deadlineAt) {
        console.error('RWT_J8_PARENT_DELETE blocked_setup');
        return 78;
    }
    const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    try {
        await cleanupRunOwnedAccount({ admin: admin as never, capturedUid: uid, createdEmail: email, runOwnedPrefix: RUN_OWNED_PREFIX });
        return 0;
    } catch (error) {
        console.error(`RWT_J8_PARENT_DELETE failed step=${cleanupFailureStep(error)}`);
        return 1;
    }
}

main().then((code) => { process.exitCode = code; }, () => { console.error('RWT_J8_PARENT_DELETE failed step=unknown'); process.exitCode = 1; });
