/**
 * Private STT status reducer (no browser).
 *
 * Implements test-report "Unit-testable checks without browser" #4:
 *   "Status reducer: STOPPING + local finalization must prefer
 *    'Processing speech locally...' over 'Recording active'."
 *
 * Pure mirror of the controller's status-priority rule (SpeechRuntimeController
 * .handleStatusChange + store guard): while a session is STOPPING/RECORDING, an
 * informational engine status (local finalization) takes precedence over the
 * generic recording status. ready/recording/error remain owned by lifecycle
 * transitions. Dependency-free so it is regression-guarded without Chrome.
 */

/**
 * @param {{ runtimeState?: string, currentStatus?: {type?:string,message?:string}|null, engineStatus?: {type?:string,message?:string}|null }} input
 * @returns {{type:string,message:string}} the status that should be visible
 */
export function reducePrivateStatus(input) {
  const runtimeState = input?.runtimeState ?? 'IDLE';
  const current = input?.currentStatus ?? { type: 'idle', message: 'Ready to record' };
  const engine = input?.engineStatus ?? null;

  // During an active/stopping session, an informational engine status (e.g. local
  // finalization) wins over the generic "Recording active".
  if (engine && engine.type === 'info' && (runtimeState === 'STOPPING' || runtimeState === 'RECORDING')) {
    return { type: 'info', message: engine.message ?? '' };
  }

  return { type: current.type ?? 'idle', message: current.message ?? '' };
}
