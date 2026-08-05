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

  it('parameterizes Edge deployment by explicit use case without coupling migrations', () => {
    const reusable = readRepoFile('.github', 'workflows', 'deploy-supabase-migrations.yml');
    const releaseCaller = readRepoFile('.github', 'workflows', 'deploy-supabase-edge-release.yml');

    expect(reusable).toMatch(/workflow_call:[\s\S]*deploy_edge_functions:[\s\S]*type: boolean[\s\S]*required: true/);
    expect(reusable).not.toMatch(/deploy_edge_functions:[\s\S]{0,120}default:/);
    expect(reusable).toMatch(/Edge source\/shared configuration changed but deploy_edge_functions=false/);
    expect(reusable).toMatch(/deploy-edge-functions:[\s\S]*needs: \[validate-edge-configuration, deploy-production-db\][\s\S]*deploy_edge_functions == 'true'/);
    expect(reusable).toMatch(/needs\.deploy-production-db\.result == 'success'/);
    expect(reusable).toMatch(/verify-edge-functions:[\s\S]*deploy_edge_functions == 'true'/);
    expect(releaseCaller).toMatch(/uses: \.\/\.github\/workflows\/deploy-supabase-migrations\.yml/);
    expect(releaseCaller).toMatch(/deploy_edge_functions: true/);
    expect(releaseCaller).toMatch(/edge_changes_present: true/);
    expect(releaseCaller).toMatch(/backend\/supabase\/functions\/\*\*/);
    expect(releaseCaller).not.toMatch(/tests\/|docs\/|frontend\//);

    // Migration/secrets decisions remain tied to the explicit operation, not the Edge Boolean.
    expect(reusable).toMatch(/inputs\.operation == 'migrations'/);
    expect(reusable).toMatch(/inputs\.operation == 'secrets'/);
    expect(reusable).toMatch(/inputs\.confirm/);
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
