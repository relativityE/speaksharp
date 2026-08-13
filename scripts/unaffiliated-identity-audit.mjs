#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import { inventoryUnaffiliatedIdentities } from './lib/unaffiliatedIdentityAudit.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const IDENTITY_DOMAIN = process.env.IDENTITY_DOMAIN;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !STRIPE_SECRET_KEY || !IDENTITY_DOMAIN) {
  console.error('Read-only identity inventory configuration is incomplete.');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const result = await inventoryUnaffiliatedIdentities({
  admin,
  fetchFn: fetch,
  stripeSecretKey: STRIPE_SECRET_KEY,
  domain: IDENTITY_DOMAIN,
});
console.log(JSON.stringify(result));
