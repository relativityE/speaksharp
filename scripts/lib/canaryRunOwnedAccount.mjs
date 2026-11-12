/**
 * Canary active-trial lane: create ONE run-owned trial account and bind it to
 * this exact run before anything else uses it. Injectable admin; closed codes only; the password never leaves memory.
 */
import { randomBytes } from 'node:crypto';
import { BINDING_KEY, RUN_OWNED_PREFIX, ROLE, parseBinding } from './canaryRunOwnedSweep.mjs';

const RUN_ID = /^[1-9]\d{0,19}$/;
const ATTEMPT = /^[1-9]\d{0,3}$/;

/** This run's binding from the GitHub Actions environment, or null outside a well-formed run. */
export function currentCanaryBinding(env = process.env) {
    if (env.GITHUB_ACTIONS !== 'true') return null;
    const { GITHUB_REPOSITORY: repository, GITHUB_WORKFLOW_REF: workflow, GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: runAttempt } = env;
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !/^[\w.-]+\/[\w.-]+\/\.github\/workflows\/[\w.-]+\.ya?ml@\S+$/.test(workflow ?? '')) return null;
    if (!RUN_ID.test(runId ?? '') || !ATTEMPT.test(runAttempt ?? '')) return null;
    return { repository, workflow, runId, runAttempt, role: ROLE };
}

let createdThisProcess = false;
/** Test seam only. */
export function __resetCreateGuardForTests() { createdThisProcess = false; }

/**
 * Create the run's single trial account. Returns {status:'created', userId, email, password} or {status:'refused'|'failed', code}.
 * On a bind failure the just-created account is deleted (and that deletion's outcome reported) — never left unbound.
 */
export async function createRunOwnedTrialAccount(admin, { binding, domain }) {
    if (!binding) return { status: 'refused', code: 'no-run-binding' };
    if (createdThisProcess) return { status: 'refused', code: 'second-create-in-run' };
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain ?? '') || /(^|\.)speaksharp\.app$/i.test(domain)) return { status: 'refused', code: 'domain-invalid' };
    createdThisProcess = true;
    const email = `${RUN_OWNED_PREFIX}${binding.runId}-${binding.runAttempt}-${randomBytes(4).toString('hex')}@${domain}`;
    const password = `Ct-${randomBytes(18).toString('base64url')}-9a!`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { [BINDING_KEY]: binding } });
    const userId = data?.user?.id;
    if (error || !userId) return { status: 'failed', code: 'create-failed' };
    // Read back: the binding must be exactly this run's, or the account is removed.
    const { data: read, error: readError } = await admin.auth.admin.getUserById(userId);
    const bound = !readError && parseBinding(read?.user?.app_metadata, binding);
    if (!bound || bound.runId !== binding.runId || bound.runAttempt !== binding.runAttempt) {
        const { error: delError } = await admin.auth.admin.deleteUser(userId);
        return { status: 'failed', code: delError ? 'bind-failed-delete-failed' : 'bind-failed-deleted' };
    }
    return { status: 'created', userId, email, password };
}
