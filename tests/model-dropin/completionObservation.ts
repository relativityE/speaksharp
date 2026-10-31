import type { Response } from 'playwright';
/** The actual shipping save observation. Plaintext is returned only in memory for the existing scorer. */
export async function observeCompletedSave(response: Response, apiOrigin: string) {
  const request = response.request();
  if (!response.ok() || response.url() !== apiOrigin + '/rest/v1/rpc/complete_session_v2'
    || request.method() !== 'POST') throw Error('completion_response_invalid');
  const payload = request.postDataJSON() as Record<string, unknown>;
  const result = await response.json() as Record<string, unknown>;
  if (payload.p_status !== 'completed' || typeof payload.p_session_id !== 'string'
    || !/^[a-f0-9-]{36}$/i.test(payload.p_session_id) || typeof payload.p_final_transcript !== 'string'
    || !payload.p_final_transcript.trim() || result.success !== true || result.session_saved !== true
    || result.final_status !== 'completed' || result.transcript_outcome !== 'retained') {
    throw Error('completion_not_durably_retained');
  }
  return {sessionId:payload.p_session_id,transcript:payload.p_final_transcript};
}
