import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readRepoFile = (...parts: string[]) =>
  readFileSync(resolve(process.cwd(), ...parts), 'utf8');

describe('paid soft-launch billing contract', () => {
  it('deploys the Stripe billing portal edge function with checkout and webhook', () => {
    const workflow = readRepoFile('.github', 'workflows', 'deploy-supabase-migrations.yml');
    const config = readRepoFile('backend', 'supabase', 'config.toml');

    expect(workflow).toMatch(/supabase functions deploy stripe-checkout/);
    expect(workflow).toMatch(/supabase functions deploy stripe-webhook/);
    expect(workflow).toMatch(/supabase functions deploy stripe-billing-portal/);
    expect(config).toMatch(/\[functions\.stripe-billing-portal\]/);
    expect(config).toMatch(/functions\/stripe-billing-portal\/index\.ts/);
  });

  it('persists Stripe customer ids through the webhook RPC contract', () => {
    const migration = readRepoFile(
      'backend',
      'supabase',
      'migrations',
      '20260608190000_store_stripe_customer_id_in_webhook.sql'
    );

    expect(migration).toMatch(/p_stripe_customer_id text DEFAULT NULL/);
    expect(migration).toMatch(/stripe_customer_id = COALESCE\(v_customer_id, stripe_customer_id\)/);
    expect(migration).toMatch(/process_stripe_webhook_event\(text, text, text, uuid, text, text\)/);
    expect(migration).toMatch(/GRANT EXECUTE[\s\S]*TO service_role/);
  });
});
