/**
 * Trusted, exact-request recovery after an uncertain Auth DELETE. This is not a
 * public endpoint or permission to delete: there is deliberately no delete,
 * cancel, token-claim, fence-release or enumeration port.
 *
 * The caller must bind all ports to the SAME independently verified database /
 * Auth target. readAuthority must independently enforce the current deployment,
 * configuration, drain generation and exact stored request binding. A browser
 * body, REGISTERED receipt or old boolean switch is not that authority.
 *
 * SQL transitions must check the supplied authority under their own locks and
 * retain authoritative compare-and-set and complete residue checks. These
 * client rechecks do not serialize external deployment
 * changes; the release controller must invalidate before changing that context.
 */
export interface ClosureRecoveryDependencies {
  now(): number;
  readAuthority(userId: string, requestId: string): Promise<unknown>;
  inspectAttempt(userId: string, requestId: string): Promise<unknown>;
  /** Raw authoritative getUserById response; only explicit 404/user_not_found is absence. */
  readAuthUser(userId: string): Promise<unknown>;
  recordAuthState(userId: string, requestId: string, state: 'auth_deleted' | 'completed',
    authority: Readonly<ClosureRecoveryAuthority>): Promise<void>;
  verifyResidue(userId: string, claimedEmail: string): Promise<unknown>;
}

export interface ClosureRecoveryAuthority {
  userId: string;
  requestId: string;
  generation: string;
  bindingDigest: string;
  validFrom: number;
  expiresAt: number;
}
interface Attempt {
  userId: string;
  requestId: string;
  email: string;
  phase: 'auth_unknown' | 'auth_deleted' | 'completed';
}
type Stage = 'authority' | 'journal' | 'auth' | 'residue' | 'completion';
type Reason = 'request_invalid' | 'authority_unavailable' | 'authority_changed'
  | 'journal_unavailable' | 'journal_changed' | 'auth_unknown' | 'auth_present'
  | 'residue_unverified' | 'transition_unverified' | 'operation_unknown' | 'verified';
export interface ClosureRecoveryResult {
  outcome: 'completed' | 'hold';
  stage: Stage;
  reason: Reason;
  accountDeleted: true | null;
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const closed = (value: unknown, keys: string[]): value is Record<string, unknown> =>
  object(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
class Held extends Error {
  constructor(readonly reason: Reason) { super(reason); }
}
function stop(reason: Reason): never { throw new Held(reason); }

export async function recoverAccountClosure(
  request: { userId: string; requestId: string },
  deps: ClosureRecoveryDependencies,
): Promise<ClosureRecoveryResult> {
  let stage: Stage = 'authority';
  let accountDeleted: true | null = null;
  try {
    const input = structuredClone(request);
    if (!closed(input, ['userId', 'requestId']) || !uuid(input.userId) || !uuid(input.requestId)) stop('request_invalid');
    const userId = input.userId;
    const requestId = input.requestId;
    let firstAuthority: ClosureRecoveryAuthority | undefined;
    let claimedEmail: string | undefined;

    async function authority() {
      const value = structuredClone(await deps.readAuthority(userId, requestId));
      // Check the clock AFTER the port returns: a lock or network wait can use
      // up an otherwise valid grant. Never renew it within this invocation.
      const now = deps.now();
      if (!closed(value, ['userId', 'requestId', 'generation', 'bindingDigest', 'validFrom', 'expiresAt'])
        || value.userId !== userId || value.requestId !== requestId
        || typeof value.generation !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(value.generation)
        || BigInt(value.generation) > 9223372036854775807n
        || typeof value.bindingDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.bindingDigest)
        || typeof value.validFrom !== 'number' || typeof value.expiresAt !== 'number'
        || ![now, value.validFrom, value.expiresAt].every(Number.isFinite)
        || value.validFrom > now || value.expiresAt <= now || value.expiresAt <= value.validFrom
        || value.expiresAt - value.validFrom > 15 * 60_000) stop('authority_unavailable');
      const current = value as unknown as ClosureRecoveryAuthority;
      if (firstAuthority && (['generation', 'bindingDigest', 'validFrom', 'expiresAt'] as const)
        .some((key) => current[key] !== firstAuthority?.[key])) stop('authority_changed');
      firstAuthority ??= current;
    }

    async function journal(): Promise<Attempt> {
      await authority();
      const value = structuredClone(await deps.inspectAttempt(userId, requestId));
      await authority();
      if (!closed(value, ['userId', 'requestId', 'email', 'phase'])
        || value.userId !== userId || value.requestId !== requestId
        || typeof value.email !== 'string' || value.email.length === 0
        || value.email !== value.email.trim().toLowerCase()
        || typeof value.phase !== 'string'
        || !['auth_unknown', 'auth_deleted', 'completed'].includes(value.phase)) stop('journal_unavailable');
      if (claimedEmail !== undefined && value.email !== claimedEmail) stop('journal_changed');
      claimedEmail = value.email;
      return value as unknown as Attempt;
    }

    async function absent() {
      stage = 'auth';
      await authority();
      const response = await deps.readAuthUser(userId);
      await authority();
      if (!object(response) || !object(response.data)) stop('auth_unknown');
      const user = response.data.user;
      if (response.error === null && object(user) && user.id === userId) {
        accountDeleted = null;
        stop('auth_present');
      }
      if (user !== null || !object(response.error) || response.error.status !== 404
        || response.error.code !== 'user_not_found') {
        accountDeleted = null;
        stop('auth_unknown');
      }
      accountDeleted = true;
    }

    async function residue() {
      stage = 'residue';
      await authority();
      const clean = await deps.verifyResidue(userId, claimedEmail!);
      await authority();
      if (clean !== true) stop('residue_unverified');
    }

    stage = 'journal';
    let attempt = await journal();
    await absent();
    if (attempt.phase === 'auth_unknown') {
      stage = 'journal';
      attempt = await journal();
      if (attempt.phase !== 'auth_unknown') stop('journal_changed');
      await authority();
      await deps.recordAuthState(userId, requestId, 'auth_deleted', Object.freeze({ ...firstAuthority! }));
      attempt = await journal();
      if (attempt.phase !== 'auth_deleted') stop('transition_unverified');
    }
    if (attempt.phase === 'auth_deleted') {
      await residue();
      await absent();
      stage = 'completion';
      if ((await journal()).phase !== 'auth_deleted') stop('journal_changed');
      await authority();
      // The SQL transition must itself prove complete residue atomically. A
      // success acknowledgment is still not a persisted completion readback.
      await deps.recordAuthState(userId, requestId, 'completed', Object.freeze({ ...firstAuthority! }));
      if ((await journal()).phase !== 'completed') stop('transition_unverified');
    }
    await absent();
    await residue();
    stage = 'completion';
    if ((await journal()).phase !== 'completed') stop('transition_unverified');
    return { outcome: 'completed', stage, reason: 'verified', accountDeleted: true };
  } catch (error) {
    // An uncertain transition may already have committed. Never retry it here,
    // expose provider errors, release its hold, or report non-deletion.
    return { outcome: 'hold', stage, reason: error instanceof Held ? error.reason : 'operation_unknown', accountDeleted };
  }
}
