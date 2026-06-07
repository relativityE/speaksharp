-- ACCOUNT-REC-LEASE: account-wide single-recording mutex (anti credential-sharing abuse).
--
-- The legacy localStorage lock is DEVICE-LOCAL (cross-tab only) — it cannot stop the same account
-- recording on two machines/browsers at once. This server-side lease enforces "one active
-- recording per user, anywhere," keyed by user_id, with heartbeat + expiry so a crashed device
-- frees the lease automatically. Enforcement is server-side (SECURITY DEFINER RPCs gated on
-- auth.uid()) so a credential-sharer cannot bypass it from the client.

CREATE TABLE IF NOT EXISTS public.active_recording_lease (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  lease_id uuid NOT NULL,
  holder_label text,
  state text NOT NULL DEFAULT 'recording',
  started_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.active_recording_lease ENABLE ROW LEVEL SECURITY;

-- RLS: a user may only see/modify their OWN lease row. The RPCs below are the sanctioned path.
DROP POLICY IF EXISTS "own recording lease select" ON public.active_recording_lease;
CREATE POLICY "own recording lease select"
  ON public.active_recording_lease FOR SELECT
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "own recording lease modify" ON public.active_recording_lease;
CREATE POLICY "own recording lease modify"
  ON public.active_recording_lease FOR ALL
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- Staleness window: a lease whose heartbeat is older than this is treated as free (crashed device).
-- Client heartbeats every ~3s; ~15s tolerates a few missed beats before another device can take over.

/**
 * Atomically acquire the recording lease for the calling user.
 *  - Succeeds if: no lease, the caller already owns it (re-acquire), the existing lease is stale,
 *    or p_force = true (explicit user-initiated take-over).
 *  - Otherwise returns acquired=false with the live holder's label/started_at so the UI can offer
 *    "Recording active on <device> — Take over / Cancel" (default = blocked).
 */
CREATE OR REPLACE FUNCTION public.acquire_recording_lease(
  p_lease_id uuid,
  p_holder_label text DEFAULT NULL,
  p_force boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := (select auth.uid());
  v_existing public.active_recording_lease%ROWTYPE;
  v_has_existing boolean := false;
  v_stale_cutoff timestamptz := now() - interval '15 seconds';
  v_live_other boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('acquired', false, 'reason', 'unauthenticated');
  END IF;

  SELECT * INTO v_existing FROM public.active_recording_lease WHERE user_id = v_uid FOR UPDATE;
  v_has_existing := FOUND;

  -- A DIFFERENT, still-heartbeating holder is the only thing that blocks (unless forced).
  v_live_other := v_has_existing
                  AND v_existing.lease_id <> p_lease_id
                  AND v_existing.heartbeat_at >= v_stale_cutoff;

  IF v_live_other AND NOT p_force THEN
    RETURN jsonb_build_object(
      'acquired', false,
      'reason', 'held_by_other',
      'holder_label', v_existing.holder_label,
      'started_at', v_existing.started_at
    );
  END IF;

  INSERT INTO public.active_recording_lease (user_id, lease_id, holder_label, state, started_at, heartbeat_at)
  VALUES (v_uid, p_lease_id, p_holder_label, 'recording', now(), now())
  ON CONFLICT (user_id) DO UPDATE
    SET lease_id = EXCLUDED.lease_id,
        holder_label = EXCLUDED.holder_label,
        state = 'recording',
        started_at = now(),
        heartbeat_at = now();

  RETURN jsonb_build_object('acquired', true, 'took_over', (v_live_other AND p_force));
END;
$$;

/**
 * Heartbeat: refresh the lease while recording. Returns valid=false if the caller no longer owns
 * the lease (another device took over, or it was released) — the client must then stop recording.
 */
CREATE OR REPLACE FUNCTION public.heartbeat_recording_lease(p_lease_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := (select auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'unauthenticated');
  END IF;

  UPDATE public.active_recording_lease
    SET heartbeat_at = now()
    WHERE user_id = v_uid AND lease_id = p_lease_id;

  IF FOUND THEN
    RETURN jsonb_build_object('valid', true);
  END IF;
  RETURN jsonb_build_object('valid', false, 'reason', 'revoked');
END;
$$;

/** Release the lease (only if the caller still owns this lease_id). Idempotent. */
CREATE OR REPLACE FUNCTION public.release_recording_lease(p_lease_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := (select auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('released', false, 'reason', 'unauthenticated');
  END IF;

  DELETE FROM public.active_recording_lease WHERE user_id = v_uid AND lease_id = p_lease_id;
  RETURN jsonb_build_object('released', FOUND);
END;
$$;

GRANT EXECUTE ON FUNCTION public.acquire_recording_lease(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_recording_lease(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_recording_lease(uuid) TO authenticated;
