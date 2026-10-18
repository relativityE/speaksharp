import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "./index.ts";
import Stripe from "npm:stripe@16";

function request(plan?: string) {
  return new Request("http://localhost/stripe-checkout", {
    method: "POST",
    headers: {
      Authorization: "Bearer valid-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(plan ? { plan } : {}),
  });
}

// Baseline env for the ENABLED path: payments explicitly on + a LIVE secret key. Both are required by
// the fail-closed beta guard before any checkout logic runs.
const env = (key: string) => {
  const values: Record<string, string> = {
    PAYMENTS_ENABLED: "true",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_live_testsecret",
    STRIPE_PRO_PRICE_ID: "price_1TbnH175Lp2WYe28RTatJout",
    SITE_URL: "https://speaksharp-public.vercel.app",
  };
  return values[key];
};

/** Build an env getter overriding the enabled baseline (e.g. to disable payments or use a test key). */
const envWith = (overrides: Record<string, string | undefined>) => (key: string) => {
  if (key in overrides) return overrides[key];
  return env(key);
};

// #1282 — the server-configured Pro price MUST be an active recurring monthly price of exactly 1000
// cents in the configured currency. This is the valid baseline; verification tests override it.
type MockPrice = {
  active?: boolean;
  unit_amount?: number | null;
  currency?: string;
  recurring?: { interval?: string | null; interval_count?: number | null } | null;
};
const validProPrice: MockPrice = { active: true, unit_amount: 1000, currency: "usd", recurring: { interval: "month", interval_count: 1 } };

type CheckoutMock = { sessions: { create: (params: Record<string, unknown>, options?: { idempotencyKey: string; maxNetworkRetries: number }) => Promise<{ id: string; url: string | null }> } };
/** Compose a StripeLike mock: real checkout behavior + a prices.retrieve returning the given price. */
const stripeWith = (checkout: CheckoutMock, price: MockPrice = validProPrice) => ({
  checkout,
  prices: { retrieve: async (_id: string) => price },
});

const neverCallStripe = () => {
  let called = false;
  return {
    called: () => called,
    client: stripeWith({
      sessions: { create: async () => { called = true; return { id: "cs_unexpected", url: "x" }; } },
    }),
  };
};

Deno.test('operator checkout probe reads captured mode before the disabled payment gate without creating a client or session', async () => {
  const stripe = neverCallStripe(); let clients = 0;
  const deploymentId = 'example_33333333-3333-4333-8333-333333333333_2';
  const getEnv = envWith({ PAYMENTS_ENABLED: 'false', STRIPE_SECRET_KEY: 'sk_test_synthetic',
    DENO_DEPLOYMENT_ID: deploymentId, SB_REGION: 'us-east-1', SB_EXECUTION_ID: '44444444-4444-4444-8444-444444444444' });
  const dependencies = { getEnv, stripeClient: stripe.client, stripeClientMode: 'test' as const,
    createSupabase: () => { clients++; throw new Error('unexpected auth client'); } };
  const response = await handler(new Request('https://example.supabase.co/functions/v1/stripe-checkout?__operator_config=1', {
    method: 'POST', headers: { Authorization: 'Bearer service-key' },
    body: JSON.stringify({ nonce: 'a'.repeat(64), expectedDeploymentId: deploymentId }),
  }), dependencies);
  assertEquals(response.status, 200);
  const value = await response.json(); assertEquals(value.configuration.paymentsEnabled, false);
  assertEquals(value.configuration.capturedStripeMode, 'test');
  assertEquals((await handler(request('pro'), dependencies)).status, 403);
  assertEquals(clients, 0); assertEquals(stripe.called(), false);
});
Deno.test('real checkout refuses a captured test client under a newly live environment', async () => {
  const stripe = neverCallStripe(); let clients = 0;
  const response = await handler(request('pro'), { getEnv: env, stripeClient: stripe.client, stripeClientMode: 'test',
    createSupabase: () => { clients++; throw new Error('unexpected auth client'); } });
  assertEquals(response.status, 403); assertEquals(clients, 0); assertEquals(stripe.called(), false);
});

const createSupabase = (stripeCustomerId: string | null = null, profileError: unknown = null) => () =>
  ({
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: { id: "user-123", email: "user@example.com" } },
          error: null,
        }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: stripeCustomerId ? { stripe_customer_id: stripeCustomerId } : { stripe_customer_id: null },
              error: profileError,
            }),
        }),
      }),
    }),
  }) as any;

const createAdmin = () => ({ rpc: async (name: string) => ({ data: name === 'inspect_account_checkout' ? [] : name === "begin_account_checkout" ? "operation" : null, error: null }) }) as unknown as import("npm:@supabase/supabase-js@2").SupabaseClient;

function parameterRejection(code = 'parameter_missing') {
  return new Stripe.errors.StripeInvalidRequestError({ type: 'invalid_request_error', code, param: 'line_items',
    message: 'Synthetic parameter validation rejection', statusCode: 400, requestId: 'req_synthetic',
    headers: { 'request-id': 'req_synthetic' } });
}

for (const code of ['parameter_missing', 'parameter_unknown']) {
Deno.test(`definitive ${code} rejection releases only its verified reservation before a later checkout`, async () => {
  let pending = false; let created = 0; let reconciled = false;
  const calls: string[] = [];
  const admin = () => ({ rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push(name);
    if (name === 'inspect_account_checkout') return { data: pending ? [{ operation_id: 'operation', session_id: null, phase: 'issuing' }] : [], error: null };
    if (name === 'begin_account_checkout') { pending = true; return { data: 'operation', error: null }; }
    if (name === 'reconcile_rejected_account_checkout') {
      assertEquals(args, { p_user_id: 'user-123', p_operation_id: 'operation', p_request_id: 'req_synthetic', p_code: code, p_param: 'line_items' });
      reconciled = true; pending = false; return { data: true, error: null };
    }
    if (name === 'inspect_rejected_account_checkout') return { data: [{ user_id: 'user-123', operation_id: 'operation', session_id: null,
      phase: 'settled', rejection_evidence: { request_id: 'req_synthetic', code, param: 'line_items' } }], error: null };
    return { data: null, error: null };
  } }) as unknown as import('npm:@supabase/supabase-js@2').SupabaseClient;
  // Exercise the installed SDK's real HTTP-error decoding, without network or
  // a provider: request-id/status/raw-type must reach the production classifier.
  const sdk = new Stripe('sk_live_synthetic', { telemetry: false,
    httpClient: Stripe.createFetchHttpClient(async (input: string | URL | Request, init?: RequestInit) => {
      if (new URL(String(input)).pathname.startsWith('/v1/prices/')) return Response.json(validProPrice);
      assertEquals(new Headers(init?.headers).get('idempotency-key'), 'operation');
      created++;
      if (created === 1) return Response.json({ error: { type: 'invalid_request_error', code, param: 'line_items', message: 'Synthetic invalid parameter' } },
        { status: 400, headers: { 'request-id': 'req_synthetic' } });
      return Response.json({ id: 'cs_next', url: 'https://checkout.stripe.com/next' });
    }) });
  const dependencies = { getEnv: env, createSupabase: createSupabase(), createAdmin: admin, stripeClient: sdk };
  assertEquals((await handler(request(), dependencies)).status, 502);
  assertEquals(reconciled, true);
  assertEquals(calls.slice(-2), ['reconcile_rejected_account_checkout', 'inspect_rejected_account_checkout']);
  assertEquals((await handler(request(), dependencies)).status, 200);
  assertEquals(created, 2);
});
}

Deno.test('ambiguous and malformed create errors never release a reservation', async () => {
  const errors: unknown[] = [new Error('response lost'), { type: 'StripeInvalidRequestError', statusCode: 400, code: 'parameter_missing' },
    parameterRejection('resource_missing'), parameterRejection('idempotency_key_in_use'),
    new Stripe.errors.StripeAPIError({ type: 'api_error', statusCode: 500 }),
    new Stripe.errors.StripeInvalidRequestError({ type: 'invalid_request_error', code: 'parameter_missing', param: 'line_items', statusCode: 400 }),
    Object.assign(parameterRejection(), { statusCode: 500 }),
    Object.assign(parameterRejection(), { headers: { 'request-id': 'req_other' } }),
    Object.assign(parameterRejection(), { headers: { 'request-id': 'req_synthetic', 'stripe-should-retry': 'true' } }), null];
  for (const error of errors) {
    const calls: string[] = [];
    const admin = () => ({ rpc: async (name: string) => { calls.push(name); return { data: name === 'inspect_account_checkout' ? [] : 'operation', error: null }; } }) as unknown as import('npm:@supabase/supabase-js@2').SupabaseClient;
    const response = await handler(request(), { getEnv: env, createSupabase: createSupabase(), createAdmin: admin,
      stripeClient: stripeWith({ sessions: { create: async () => { throw error; } } }) });
    assertEquals(response.status, 502);
    assertEquals(calls, ['inspect_account_checkout', 'begin_account_checkout']);
  }
});

Deno.test('created-session recording failure never enters create-rejection recovery', async () => {
  const calls: string[] = [];
  const admin = () => ({ rpc: async (name: string) => {
    calls.push(name); if (name === 'record_account_checkout') throw parameterRejection();
    return { data: name === 'inspect_account_checkout' ? [] : 'operation', error: null };
  } }) as unknown as import('npm:@supabase/supabase-js@2').SupabaseClient;
  const response = await handler(request(), { getEnv: env, createSupabase: createSupabase(), createAdmin: admin,
    stripeClient: stripeWith({ sessions: { create: async () => ({ id: 'cs_created', url: 'https://checkout.stripe.com/created' }) } }) });
  assertEquals(response.status, 502);
  assertEquals(calls, ['inspect_account_checkout', 'begin_account_checkout', 'record_account_checkout']);
});

Deno.test('rejection recovery requires exact ACK/readback and never retries uncertain SQL delivery', async () => {
  for (const failure of ['write-error', 'write-false', 'write-lost', 'read-error', 'read-empty', 'read-owner', 'read-operation', 'read-session', 'read-phase', 'read-proof']) {
    const calls: string[] = []; let creates = 0;
    const admin = () => ({ rpc: async (name: string) => {
      calls.push(name);
      if (name === 'inspect_account_checkout') return { data: [], error: null };
      if (name === 'begin_account_checkout') return { data: 'operation', error: null };
      if (name === 'reconcile_rejected_account_checkout') {
        if (failure === 'write-lost') throw new Error('SQL response lost');
        return { data: failure !== 'write-false', error: failure === 'write-error' ? { message: 'uncertain' } : null };
      }
      const row = { user_id: failure === 'read-owner' ? 'other' : 'user-123', operation_id: failure === 'read-operation' ? 'other' : 'operation',
        session_id: failure === 'read-session' ? 'cs_other' : null, phase: failure === 'read-phase' ? 'issuing' : 'settled',
        rejection_evidence: { request_id: failure === 'read-proof' ? 'req_other' : 'req_synthetic', code: 'parameter_unknown', param: 'line_items' } };
      return { data: failure === 'read-empty' ? [] : [row], error: failure === 'read-error' ? { message: 'unavailable' } : null };
    } }) as unknown as import('npm:@supabase/supabase-js@2').SupabaseClient;
    const response = await handler(request(), { getEnv: env, createSupabase: createSupabase(), createAdmin: admin,
      stripeClient: stripeWith({ sessions: { create: async () => { creates++; throw parameterRejection('parameter_unknown'); } } }) });
    assertEquals(response.status, 502); assertEquals((await response.json()).checkoutUrl, undefined);
    assertEquals(creates, 1);
    assertEquals(calls.filter((name) => name === 'reconcile_rejected_account_checkout').length, 1);
    assertEquals(calls.filter((name) => name === 'inspect_rejected_account_checkout').length, failure.startsWith('write-') ? 0 : 1);
  }
});

Deno.test('operator evidence preserves the exact trimmed price consumed by real checkout', async () => {
  for (const priceId of ['price_First', 'price_Second']) {
    const deploymentId = 'example_33333333-3333-4333-8333-333333333333_2';
    const getEnv = envWith({ STRIPE_PRO_PRICE_ID: `  ${priceId}\t`, DENO_DEPLOYMENT_ID: deploymentId,
      SB_REGION: 'us-east-1', SB_EXECUTION_ID: '44444444-4444-4444-8444-444444444444' });
    let retrieved = ''; let purchased = '';
    const dependencies = { getEnv, stripeClientMode: 'live' as const,
      createSupabase: createSupabase(), createAdmin,
      stripeClient: { prices: { retrieve: async (id: string) => { retrieved = id; return validProPrice; } },
        checkout: { sessions: { create: async (params: Record<string, unknown>) => {
          purchased = (params.line_items as {price:string}[])[0].price;
          return { id: 'cs_parity', url: 'https://checkout.stripe.com/parity' };
        } } } } };
    const probe = await handler(new Request('https://example.supabase.co/functions/v1/stripe-checkout?__operator_config=1', {
      method: 'POST', headers: { Authorization: 'Bearer service-key' },
      body: JSON.stringify({ nonce: 'a'.repeat(64), expectedDeploymentId: deploymentId }),
    }), dependencies);
    assertEquals(probe.status, 200);
    const configuration = (await probe.json()).configuration;
    assertEquals((await handler(request('pro'), dependencies)).status, 200);
    assertEquals(configuration.proPriceId, retrieved);
    assertEquals(configuration.proPriceId, purchased);
    assertEquals(configuration.proPriceId, priceId);
  }
});

Deno.test('operator evidence refuses site URLs whose checkout redirects cannot be represented by an origin', async () => {
  for (const suffix of ['', '/', '/nested']) {
    const siteUrl = `https://speaksharp-public.vercel.app${suffix}`;
    const deploymentId = 'example_33333333-3333-4333-8333-333333333333_2';
    const getEnv = envWith({ SITE_URL: siteUrl, DENO_DEPLOYMENT_ID: deploymentId,
      SB_REGION: 'us-east-1', SB_EXECUTION_ID: '44444444-4444-4444-8444-444444444444' });
    let actualRedirect = '';
    const dependencies = { getEnv, stripeClientMode: 'live' as const, createSupabase: createSupabase(), createAdmin,
      stripeClient: stripeWith({ sessions: { create: async (params) => {
        actualRedirect = String(params.success_url); return { id: 'cs_site', url: 'https://checkout.stripe.com/site' };
      } } }) };
    const probe = await handler(new Request('https://example.supabase.co/functions/v1/stripe-checkout?__operator_config=1', {
      method: 'POST', headers: { Authorization: 'Bearer service-key' },
      body: JSON.stringify({ nonce: 'a'.repeat(64), expectedDeploymentId: deploymentId }),
    }), dependencies);
    assertEquals(probe.status, suffix ? 503 : 200);
    assertEquals((await handler(request('pro'), dependencies)).status, 200);
    assertEquals(actualRedirect.startsWith(`${siteUrl}/session?`), true);
  }
});

Deno.test("stripe-checkout edge function", async (t) => {
  await t.step('cancel-return retries reuse the verified open checkout without another purchase',async()=>{
    const calls:string[]=[];
    const admin=()=>({rpc:async(name:string)=>{calls.push(name);return {
      data:name==='inspect_account_checkout'?[{operation_id:'operation',session_id:'cs_open',phase:'open'}]:name==='confirm_account_checkout_reuse'?true:null,
      error:name==='begin_account_checkout'?{message:'existing checkout'}:null,
    };}}) as unknown as import('npm:@supabase/supabase-js@2').SupabaseClient;
    let created=0;
    const client={...stripeWith({sessions:{create:async()=>{created++;return {id:'new',url:'https://checkout.stripe.com/new'};}}}),
      checkout:{sessions:{create:async()=>{created++;return {id:'new',url:'https://checkout.stripe.com/new'};},
        retrieve:async()=>({id:'cs_open',status:'open',url:'https://checkout.stripe.com/old',client_reference_id:'user-123',metadata:{userId:'user-123'}})}}};
    const res=await handler(request('pro'),{getEnv:env,createSupabase:createSupabase(),createAdmin:admin,stripeClient:client});
    assertEquals(res.status,200); assertEquals((await res.json()).checkoutUrl,'https://checkout.stripe.com/old');
    assertEquals(created,0); assertEquals(calls,['inspect_account_checkout','confirm_account_checkout_reuse']);
  });
  await t.step('provider-confirmed expiry is reconciled before a fresh checkout reservation',async()=>{
    const order:string[]=[];
    const admin=()=>({rpc:async(name:string)=>{order.push(name);return {
      data:name==='inspect_account_checkout'?[{operation_id:'old',session_id:'cs_old',phase:'open'}]
        :name==='begin_account_checkout'?'new':null,error:null,
    };}}) as unknown as import('npm:@supabase/supabase-js@2').SupabaseClient;
    const client={...stripeWith({sessions:{create:async()=>({id:'cs_new',url:'https://checkout.stripe.com/new'})}}),
      checkout:{sessions:{retrieve:async()=>({id:'cs_old',status:'expired',url:null,client_reference_id:'user-123',metadata:{userId:'user-123'}}),
        create:async()=>{order.push('stripe');return {id:'cs_new',url:'https://checkout.stripe.com/new'};}}}};
    const res=await handler(request('pro'),{getEnv:env,createSupabase:createSupabase(),createAdmin:admin,stripeClient:client});
    assertEquals(res.status,200);
    assertEquals(order,['inspect_account_checkout','reconcile_account_checkout_expiry','begin_account_checkout','stripe','record_account_checkout']);
  });
  for (const phase of ['issuing','unknown']) {
    await t.step(`${phase} checkout remains held on purchase retry`,async()=>{
      let contacted=false;
      const admin=()=>({rpc:async()=>({data:[{operation_id:'old',session_id:null,phase}],error:null})}) as unknown as import('npm:@supabase/supabase-js@2').SupabaseClient;
      const client={...stripeWith({sessions:{create:async()=>({id:'unexpected',url:'x'})}}),checkout:{sessions:{
        retrieve:async()=>{contacted=true;throw new Error('must not guess');},
        create:async()=>{contacted=true;return {id:'unexpected',url:'x'};},
      }}};
      const res=await handler(request('pro'),{getEnv:env,createSupabase:createSupabase(),createAdmin:admin,stripeClient:client});
      assertEquals(res.status,502); assertEquals(contacted,false);
    });
  }
  for (const mode of ['wrong_owner','unusable_url','closure_won','lost_readback']) {
    await t.step(`open checkout retry ${mode} fails closed without another purchase`,async()=>{
      let created=false; const names:string[]=[];
      const admin=()=>({rpc:async(name:string)=>{names.push(name);return {
        data:name==='inspect_account_checkout'?[{operation_id:'old',session_id:'cs_old',phase:'open'}]:mode!=='closure_won',error:null,
      };}}) as unknown as import('npm:@supabase/supabase-js@2').SupabaseClient;
      const client={...stripeWith({sessions:{create:async()=>({id:'unexpected',url:'x'})}}),checkout:{sessions:{
        retrieve:async()=>{if(mode==='lost_readback') throw new Error('timeout'); return {
          id:'cs_old',status:'open',url:mode==='unusable_url'?null:'https://checkout.stripe.com/old',
          client_reference_id:mode==='wrong_owner'?'other':'user-123',metadata:{userId:'user-123'},
        };},create:async()=>{created=true;return {id:'unexpected',url:'x'};},
      }}};
      const res=await handler(request('pro'),{getEnv:env,createSupabase:createSupabase(),createAdmin:admin,stripeClient:client});
      assertEquals(res.status,502); assertEquals(created,false);
      assertEquals(names.includes('begin_account_checkout'),false);
    });
  }
  await t.step('closed billing fence refuses checkout before Stripe; no fallback creation',async()=>{
    const stripe=neverCallStripe();
    const admin=()=>({rpc:async()=>({data:null,error:{message:'closure pending'}})}) as unknown as import('npm:@supabase/supabase-js@2').SupabaseClient;
    const res=await handler(request('pro'),{getEnv:env,createSupabase:createSupabase(),createAdmin:admin,stripeClient:stripe.client});
    assertEquals(res.status,502); assertEquals(stripe.called(),false);
  });
  await t.step('checkout is reserved before Stripe and recorded before URL delivery',async()=>{
    const order:string[]=[];
    const admin=()=>({rpc:async(name:string)=>{order.push(name);return {data:name==='inspect_account_checkout'?[]:name==='begin_account_checkout'?'operation':null,error:null};}}) as unknown as import('npm:@supabase/supabase-js@2').SupabaseClient;
    const client=stripeWith({sessions:{create:async(params)=>{order.push('stripe');
      assertEquals((params.metadata as {billingOperationId:string}).billingOperationId,'operation');
      return {id:'cs',url:'https://checkout.stripe.com/cs'};}}});
    const res=await handler(request('pro'),{getEnv:env,createSupabase:createSupabase(),createAdmin:admin,stripeClient:client});
    assertEquals(res.status,200);
    assertEquals(order,['inspect_account_checkout','begin_account_checkout','stripe','record_account_checkout']);
  });
  await t.step('lost Stripe creation response leaves issuance held; no release or URL claimed',async()=>{
    const calls:string[]=[];
    const admin=()=>({rpc:async(name:string)=>{calls.push(name);return {data:name==='inspect_account_checkout'?[]:'operation',error:null};}}) as unknown as import('npm:@supabase/supabase-js@2').SupabaseClient;
    const client=stripeWith({sessions:{create:async()=>{throw new Error('lost response');}}});
    const res=await handler(request('pro'),{getEnv:env,createSupabase:createSupabase(),createAdmin:admin,stripeClient:client});
    assertEquals(res.status,502);
    assertEquals(calls,['inspect_account_checkout','begin_account_checkout']);
    assertEquals((await res.json()).checkoutUrl,undefined);
  });
  await t.step("rejects every non-product checkout plan", async () => {
    let stripeCalled = false;
    const res = await handler(request("basic"), {
      getEnv: env,
      createAdmin,
      createSupabase: createSupabase(),
      stripeClient: stripeWith({
        sessions: {
          create: async () => {
            stripeCalled = true;
            return { id: "cs_unexpected", url: "https://checkout.stripe.com/unexpected" };
          },
        },
      }),
    });
    const json = await res.json();

    assertEquals(res.status, 400);
    assertEquals(json.error.code, "VALIDATION_INVALID_FORMAT");
    assertEquals(json.error.message, "Invalid checkout plan");
    assertEquals(stripeCalled, false);
  });

  await t.step("creates Pro checkout with the configured Pro price", async () => {
    let receivedPrice: string | undefined;
    let receivedCustomerEmail: unknown;
    let receivedClientReferenceId: unknown;
    const res = await handler(request("pro"), {
      getEnv: env,
      createAdmin,
      createSupabase: createSupabase(),
      stripeClient: stripeWith({
        sessions: {
          create: async (params) => {
            const lineItems = params.line_items as Array<{ price?: string }>;
            receivedPrice = lineItems[0]?.price;
            receivedCustomerEmail = params.customer_email;
            receivedClientReferenceId = params.client_reference_id;
            return { id: "cs_test", url: "https://checkout.stripe.com/test" };
          },
        },
      }),
    });
    const json = await res.json();

    assertEquals(res.status, 200);
    assertEquals(json.checkoutUrl, "https://checkout.stripe.com/test");
    assertEquals(receivedPrice, "price_1TbnH175Lp2WYe28RTatJout");
    assertEquals(receivedCustomerEmail, "user@example.com");
    assertEquals(receivedClientReferenceId, "user-123");
  });

  await t.step("reuses a stored Stripe customer instead of creating a duplicate customer", async () => {
    let receivedCustomer: unknown;
    let receivedCustomerEmail: unknown;
    const res = await handler(request("pro"), {
      getEnv: env,
      createAdmin,
      createSupabase: createSupabase("cus_existing"),
      stripeClient: stripeWith({
        sessions: {
          create: async (params) => {
            receivedCustomer = params.customer;
            receivedCustomerEmail = params.customer_email;
            return { id: "cs_test", url: "https://checkout.stripe.com/test" };
          },
        },
      }),
    });
    const json = await res.json();

    assertEquals(res.status, 200);
    assertEquals(json.checkoutUrl, "https://checkout.stripe.com/test");
    assertEquals(receivedCustomer, "cus_existing");
    assertEquals(receivedCustomerEmail, undefined);
  });

  await t.step("rejects Pro checkout when the Pro price is not configured", async () => {
    let stripeCalled = false;
    const res = await handler(request("pro"), {
      getEnv: (key) => key === "STRIPE_PRO_PRICE_ID" ? undefined : env(key),
      createAdmin,
      createSupabase: createSupabase(),
      stripeClient: stripeWith({
        sessions: {
          create: async () => {
            stripeCalled = true;
            return { id: "cs_unexpected", url: "https://checkout.stripe.com/unexpected" };
          },
        },
      }),
    });
    const json = await res.json();

    assertEquals(res.status, 500);
    assertEquals(json.error.code, "CONFIG_MISSING_ENV");
    assertEquals(json.error.message, "Configuration Error: STRIPE_PRO_PRICE_ID is missing");
    assertEquals(json.error.details.missing, "STRIPE_PRO_PRICE_ID");
    assertEquals(stripeCalled, false);
  });

  // #1282 — the price amount is server-owned and verified. A price that is not exactly 1000 cents,
  // not recurring monthly, or in the wrong currency fails closed: no checkout session is created.
  await t.step("rejects checkout when the Pro price is not exactly 1000 cents", async () => {
    let stripeCalled = false;
    const res = await handler(request("pro"), {
      getEnv: env,
      createAdmin,
      createSupabase: createSupabase(),
      stripeClient: stripeWith(
        { sessions: { create: async () => { stripeCalled = true; return { id: "cs_unexpected", url: "x" }; } } },
        { active: true, unit_amount: 999, currency: "usd", recurring: { interval: "month", interval_count: 1 } },
      ),
    });
    const json = await res.json();

    assertEquals(res.status, 500);
    assertEquals(json.error.code, "CONFIG_INVALID_PRICE");
    assertEquals(stripeCalled, false);
    const problems = json.error.details.problems as string[];
    assertEquals(problems.includes("unit_amount:999"), true);
  });

  await t.step("rejects checkout when the Pro price is not recurring monthly", async () => {
    let stripeCalled = false;
    const res = await handler(request("pro"), {
      getEnv: env,
      createAdmin,
      createSupabase: createSupabase(),
      stripeClient: stripeWith(
        { sessions: { create: async () => { stripeCalled = true; return { id: "cs_unexpected", url: "x" }; } } },
        { active: true, unit_amount: 1000, currency: "usd", recurring: { interval: "year", interval_count: 1 } },
      ),
    });
    const json = await res.json();

    assertEquals(res.status, 500);
    assertEquals(json.error.code, "CONFIG_INVALID_PRICE");
    assertEquals(stripeCalled, false);
    const problems = json.error.details.problems as string[];
    assertEquals(problems.includes("interval:year"), true);
  });

  await t.step("rejects checkout when the Pro price currency does not match the configured currency", async () => {
    let stripeCalled = false;
    const res = await handler(request("pro"), {
      getEnv: env,
      createAdmin,
      createSupabase: createSupabase(),
      stripeClient: stripeWith(
        { sessions: { create: async () => { stripeCalled = true; return { id: "cs_unexpected", url: "x" }; } } },
        { active: true, unit_amount: 1000, currency: "eur", recurring: { interval: "month", interval_count: 1 } },
      ),
    });
    const json = await res.json();

    assertEquals(res.status, 500);
    assertEquals(json.error.code, "CONFIG_INVALID_PRICE");
    assertEquals(stripeCalled, false);
    const problems = json.error.details.problems as string[];
    assertEquals(problems.includes("currency:eur"), true);
  });

  await t.step("rejects checkout when the Pro price is inactive", async () => {
    let stripeCalled = false;
    const res = await handler(request("pro"), {
      getEnv: env,
      createAdmin,
      createSupabase: createSupabase(),
      stripeClient: stripeWith(
        { sessions: { create: async () => { stripeCalled = true; return { id: "cs_unexpected", url: "x" }; } } },
        { active: false, unit_amount: 1000, currency: "usd", recurring: { interval: "month", interval_count: 1 } },
      ),
    });
    const json = await res.json();

    assertEquals(res.status, 500);
    assertEquals(json.error.code, "CONFIG_INVALID_PRICE");
    assertEquals(stripeCalled, false);
  });

  await t.step("rejects checkout when the Pro price has NO active field (missing is not active)", async () => {
    let stripeCalled = false;
    const res = await handler(request("pro"), {
      getEnv: env,
      createAdmin,
      createSupabase: createSupabase(),
      stripeClient: stripeWith(
        { sessions: { create: async () => { stripeCalled = true; return { id: "cs_unexpected", url: "x" }; } } },
        { unit_amount: 1000, currency: "usd", recurring: { interval: "month", interval_count: 1 } }, // active omitted
      ),
    });
    const json = await res.json();
    assertEquals(res.status, 500);
    assertEquals(json.error.code, "CONFIG_INVALID_PRICE");
    assertEquals(stripeCalled, false);
    assertEquals((json.error.details.problems as string[]).includes("active:missing"), true);
  });

  await t.step("rejects checkout when the Pro price recurs every N months (interval_count != 1)", async () => {
    let stripeCalled = false;
    const res = await handler(request("pro"), {
      getEnv: env,
      createAdmin,
      createSupabase: createSupabase(),
      stripeClient: stripeWith(
        { sessions: { create: async () => { stripeCalled = true; return { id: "cs_unexpected", url: "x" }; } } },
        { active: true, unit_amount: 1000, currency: "usd", recurring: { interval: "month", interval_count: 2 } },
      ),
    });
    const json = await res.json();
    assertEquals(res.status, 500);
    assertEquals(json.error.code, "CONFIG_INVALID_PRICE");
    assertEquals(stripeCalled, false);
    assertEquals((json.error.details.problems as string[]).includes("interval_count:2"), true);
  });

  await t.step("fails closed when the Pro price cannot be retrieved (no checkout created)", async () => {
    let stripeCalled = false;
    const res = await handler(request("pro"), {
      getEnv: env,
      createAdmin,
      createSupabase: createSupabase(),
      stripeClient: {
        checkout: { sessions: { create: async () => { stripeCalled = true; return { id: "cs_unexpected", url: "x" }; } } },
        prices: { retrieve: async () => { throw new Error("stripe price retrieve failed"); } },
      },
    });
    const json = await res.json();
    assertEquals(res.status, 500);
    assertEquals(json.error.code, "CONFIG_INVALID_PRICE");
    assertEquals(stripeCalled, false);
  });

  await t.step("fails safely instead of creating checkout when billing profile lookup fails", async () => {
    let stripeCalled = false;
    const res = await handler(request("pro"), {
      getEnv: env,
      createAdmin,
      createSupabase: createSupabase(null, { message: "profile unavailable" }),
      stripeClient: stripeWith({
        sessions: {
          create: async () => {
            stripeCalled = true;
            return { id: "cs_unexpected", url: "https://checkout.stripe.com/unexpected" };
          },
        },
      }),
    });
    const json = await res.json();

    assertEquals(res.status, 500);
    assertEquals(json.error.code, "DATABASE_ERROR");
    assertEquals(stripeCalled, false);
  });

  await t.step("fails closed with 403 when payments are not explicitly enabled (no checkout created)", async () => {
    const stripe = neverCallStripe();
    const res = await handler(request("pro"), {
      getEnv: envWith({ PAYMENTS_ENABLED: undefined }),
      createAdmin,
      createSupabase: createSupabase(),
      stripeClient: stripe.client,
    });
    const json = await res.json();
    assertEquals(res.status, 403);
    assertEquals(json.error.code, "payments_disabled");
    assertEquals(json.error.message, "Pro enrollment is not open during this beta.");
    assertEquals(stripe.called(), false);
  });

  await t.step("fails closed with 403 when the Stripe secret key is not a live key", async () => {
    const stripe = neverCallStripe();
    const res = await handler(request("pro"), {
      getEnv: envWith({ STRIPE_SECRET_KEY: "sk_test_notlive" }),
      createAdmin,
      createSupabase: createSupabase(),
      stripeClient: stripe.client,
    });
    const json = await res.json();
    assertEquals(res.status, 403);
    assertEquals(json.error.code, "payments_disabled");
    assertEquals(stripe.called(), false);
  });

  await t.step("fails closed with 403 when payments enabled but no secret key present", async () => {
    const stripe = neverCallStripe();
    const res = await handler(request("pro"), {
      getEnv: envWith({ STRIPE_SECRET_KEY: undefined }),
      createAdmin,
      createSupabase: createSupabase(),
      stripeClient: stripe.client,
    });
    const json = await res.json();
    assertEquals(res.status, 403);
    assertEquals(json.error.code, "payments_disabled");
    assertEquals(stripe.called(), false);
  });
});
