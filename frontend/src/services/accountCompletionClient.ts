/**
 * #1643 — App client for CLI's inactive completion status HTTP contract (handler 192c489c, Sam SOURCE ACCEPT
 * 1792544722): POST `{action, requestId[, token]}` with `completion_status_issue` / `_ack` (live owner Bearer) and
 * `completion_status_read` (capability only, no JWT). No route is selected: the transport is injected, so nothing here
 * names an endpoint. Every reply passes through the closed parsers in accountCompletionStatus; anything else is
 * `unavailable`, never completion or absence. The capability stays in memory (completionCapabilities) only.
 */
import {
  accountCompletionStatus,
  accountStatusAcknowledgment,
  accountStatusCapability,
  completionCapabilities,
  type AccountCompletionStatus,
} from './accountCompletionStatus';

export type CompletionAction = 'completion_status_issue' | 'completion_status_ack' | 'completion_status_read';
/** One POST of a JSON body; `bearer` is sent only for issue/ack. Returns the parsed JSON body or throws. */
export type CompletionTransport = (body: Record<string, string>, bearer: string | null) => Promise<unknown>;

const unavailable = (): AccountCompletionStatus => ({ outcome: 'unavailable', canRetry: false });

/** One in-flight securing per owner + request + holder lifecycle (Sam RETURN 1792550424). */
const flights = new Map<string, Promise<boolean>>();

/**
 * Obtain and acknowledge a status capability for the owner's pending request while the owner's session is live.
 * Returns true only when the server acknowledged the held capability. Acknowledgment is not an effect grant.
 *
 * Single-flight: concurrent calls for the same owner, request and holder lifecycle share one flight, so only one issue
 * is ever dispatched (the server replaces an unacknowledged key on every issue, so two issues race to invalidate each
 * other). clear() starts a new lifecycle: a later call gets its own flight and the old one can no longer hold anything.
 */
export function secureStatusCapability(
  transport: CompletionTransport, ownerId: string, requestId: string, bearer: string, now: () => number,
): Promise<boolean> {
  const key = `${ownerId}\u0000${requestId}\u0000${completionCapabilities.lifecycle()}`;
  const existing = flights.get(key);
  if (existing) return existing;
  const flight = secureOnce(transport, ownerId, requestId, bearer, now)
    .finally(() => { if (flights.get(key) === flight) flights.delete(key); });
  flights.set(key, flight);
  return flight;
}

async function secureOnce(
  transport: CompletionTransport, ownerId: string, requestId: string, bearer: string, now: () => number,
): Promise<boolean> {
  const held = completionCapabilities.get(ownerId, requestId, now());
  if (held?.acknowledged) return true;
  let capability = held;
  if (!capability) {
    const issuedAt = completionCapabilities.epoch();
    let reply: unknown;
    try { reply = await transport({ action: 'completion_status_issue', requestId }, bearer); } catch { return false; }
    // A clear (owner switch) or another holding while the issue was in flight: the reply belongs to stale work.
    if (completionCapabilities.epoch() !== issuedAt) return false;
    const parsed = accountStatusCapability(reply, requestId, now());
    if (!parsed) return false;
    completionCapabilities.hold(ownerId, parsed);
    capability = { ...parsed, acknowledged: false };
  }
  const ackAt = completionCapabilities.epoch();
  let ack: unknown;
  try {
    ack = await transport({ action: 'completion_status_ack', requestId, token: capability.token }, bearer);
  } catch { return false; }
  return completionCapabilities.epoch() === ackAt && accountStatusAcknowledgment(ack, requestId)
    && completionCapabilities.acknowledge(ownerId, requestId, capability.token, now());
}

/** Read status with the held capability only — no JWT, so it still works after the account's sign-in is gone. */
export async function readCompletionStatus(
  transport: CompletionTransport, ownerId: string, requestId: string, now: () => number,
): Promise<AccountCompletionStatus> {
  const held = completionCapabilities.get(ownerId, requestId, now());
  if (!held?.acknowledged) return unavailable();
  const readAt = completionCapabilities.epoch();
  let reply: unknown;
  try {
    reply = await transport({ action: 'completion_status_read', requestId, token: held.token }, null);
  } catch {
    return unavailable();
  }
  // Re-check after the await: the holding must be unchanged (no clear or replacement) and still within its deadline.
  const still = completionCapabilities.get(ownerId, requestId, now());
  if (completionCapabilities.epoch() !== readAt || !still?.acknowledged || still.token !== held.token) return unavailable();
  return accountCompletionStatus(reply, requestId);
}
