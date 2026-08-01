/**
 * #1045 attribution distribution diagnostic (read-only): is `attribution_status='verified'` EVER produced
 * in production? Counts recent sessions by (engine × attribution_status). If verified sessions exist,
 * verification is achievable in real use and the CI fake-audio 'unverified' is a harness artifact; if none
 * exist, the verified requirement is systemically unmet. Service-role read only, no recording.
 */
import { test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

test('#1045 attrib distribution: verified vs unverified by engine @live', async () => {
  test.setTimeout(60_000);
  test.skip(!SUPABASE_URL || !SERVICE_ROLE, 'service-role required');
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data, error } = await admin.from('sessions')
    .select('engine, attribution_status, device_type, model_name, engine_version, created_at')
    .order('created_at', { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<Record<string, unknown>>;

  const byKey: Record<string, number> = {};
  const verifiedSamples: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    const key = `${String(r.engine)}|${String(r.attribution_status)}`;
    byKey[key] = (byKey[key] ?? 0) + 1;
    if (r.attribution_status === 'verified' && verifiedSamples.length < 5) {
      verifiedSamples.push({ engine: r.engine, device_type: r.device_type, model_name: r.model_name, engine_version: r.engine_version });
    }
  }
  console.log(`[attribdist] total=${rows.length} byEngineStatus=${JSON.stringify(byKey)}`);
  console.log(`[attribdist] verified_samples=${JSON.stringify(verifiedSamples)}`);
});
