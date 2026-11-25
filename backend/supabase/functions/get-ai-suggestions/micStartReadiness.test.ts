import { strict as assert } from 'node:assert';
import { handler } from './index.ts';
import { readReadyCoachingModel } from './modelReadinessStore.ts';
import contract from './contract.json' with { type: 'json' };

const user = '0da395d5-2ee3-4c84-9200-5ae232b20c00';
const lease = 'bd63af39-0717-476e-9796-326154d822af';
const body = { operation: 'mic_start_readiness', consentRevision: 3, leaseId: lease };

Deno.test('real Edge handler: only authenticated matching opt-in and fresh owned lease can start the synthetic probe', async () => {
  const savedFetch = globalThis.fetch;
  let aiCoaching = true, fresh = true, readRevision = 3, answerStatus = 200, valid = true, claims = 0;
  const prompts: string[] = [];
  const completions: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(new URL(String(url)).pathname, '/v1beta/models/' + contract.model + ':generateContent');
    const posted = JSON.parse(String(init && 'body' in init ? init.body : undefined));
    prompts.push(posted.contents[0].parts[0].text);
    assert.deepEqual(posted.generationConfig, contract.generationConfig);
    return answerStatus === 200
      ? Response.json({ modelVersion: contract.model, candidates: [{ finishReason: 'STOP', content: { parts: [{
        text: valid ? JSON.stringify({ version: contract.version, what_worked: /Focus Points/i.test(prompts.at(-1) ?? '') ? 'You named the phone line problem first.' : 'You opened with the onboarding checklist.',
          what_to_try_next: 'Give one concrete example of the expected improvement.' }) : '{"what_worked":""}',
      }] } }] })
      : Response.json({ error: { status: answerStatus === 429 ? 'RESOURCE_EXHAUSTED' : 'UNAVAILABLE' } }, { status: answerStatus });
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: user } }, error: null }) },
    rpc: async (name: string) => {
      assert.equal(name, 'check_usage_limit'); // No user coaching quota, account admission or persistence RPC.
      return { data: { is_pro: true }, error: null };
    },
    from: (name: string) => {
      assert.ok(['user_profiles', 'practice_privacy_choices', 'active_recording_lease'].includes(name));
      const q = { select: () => q, eq: () => q, single: async () => ({ data: { id: user }, error: null }),
        maybeSingle: async () => ({ data: name === 'practice_privacy_choices'
          ? { transcript_save: true, ai_coaching: aiCoaching, choice_revision: readRevision, consent_version: 1 }
          : { heartbeat_at: new Date(Date.now() - (fresh ? 5 : 20_000)).toISOString() }, error: null }) };
      return q;
    },
  };
  const service = {
    rpc: async (name: string, data: Record<string, unknown>) => {
      if (name === 'claim_coaching_model_probe_v1') {
        claims++;
        return { data: { kind: 'claimed', lease: { state: { model: contract.model, revision: 1 }, token: lease, deadlineMs: Date.now() + 30_000 } }, error: null };
      }
      assert.equal(name, 'finish_coaching_model_probe_v1');
      completions.push(data);
      return { data: true, error: null };
    },
  };
  const invoke = () => handler(new Request('http://localhost/functions/v1/get-ai-suggestions', {
    method: 'POST', headers: { Authorization: 'Bearer synthetic' }, body: JSON.stringify(body),
  }), (() => client) as unknown as Parameters<typeof handler>[1],
  (() => service) as unknown as NonNullable<Parameters<typeof handler>[2]>, () => true, {
    readbackKey: () => { throw Error('readback path reached'); },
    providerKey: (name) => { assert.equal(name, 'GEMINI_API_KEY'); return 'test-key'; },
  });
  try {
    aiCoaching = false;
    assert.equal((await invoke()).status, 204);
    aiCoaching = true; readRevision++;
    assert.equal((await invoke()).status, 204);
    readRevision--; fresh = false;
    assert.equal((await invoke()).status, 204);
    assert.equal(claims, 0); assert.equal(prompts.length, 0);
    fresh = true;
    assert.equal((await invoke()).status, 204);
    assert.equal(prompts.length, 2);
    assert.ok(prompts.some((text) => /Focus Points/i.test(text)));
    assert.equal(completions[0].p_verified, true);
    assert.equal(completions[0].p_promote_to, null);
    valid = false;
    assert.equal((await invoke()).status, 204);
    assert.equal(completions[1].p_verified, false);
    for (const status of [429, 503]) {
      answerStatus = status; const before: number = prompts.length;
      assert.equal((await invoke()).status, 204);
      assert.equal(prompts.length - before, 1);
      assert.equal(completions.at(-1)?.p_promote_to, null);
    }
  } finally {
    globalThis.fetch = savedFetch;
  }
});

Deno.test('quick Stop waits for the committed revision; freshness expiry does not strand a long take', async () => {
  let reads = 0;
  const client = { from: () => {
    const q = { select: () => q, eq: () => q, abortSignal: () => q, maybeSingle: async () => ({
      data: ++reads === 1
        ? { model: 'pending-incumbent', verified: true, verified_until: new Date(Date.now() + 60_000).toISOString(), probe_deadline: new Date(Date.now() + 5000).toISOString() }
        : { model: 'committed-fallback', verified: true, verified_until: new Date(Date.now() - 60_000).toISOString(), probe_deadline: null },
      error: null,
    }) };
    return q;
  } };
  assert.deepEqual(await readReadyCoachingModel(client as unknown as Parameters<typeof readReadyCoachingModel>[0], new AbortController().signal),
    { kind: 'ready', model: 'committed-fallback' });
  assert.equal(reads, 2);
});

Deno.test('Ops readback: browser and ordinary bearer denied, service role reads deployed state without a provider request', async () => {
  let reads = 0;
  const client = { from: (table: string) => {
    assert.equal(table, 'coaching_model_selection');
    const q = { select: () => q, eq: () => q, abortSignal: () => q,
      maybeSingle: async () => {
        reads++;
        return { data: { model: contract.model, revision: 2, verified: true, verified_until: new Date(Date.now() + 60_000).toISOString(), probe_deadline: null }, error: null };
      } };
    return q;
  } };
  const invoke = (auth: string, origin?: string) => handler(new Request('http://localhost/functions/v1/get-ai-suggestions', {
    method: 'POST', headers: { Authorization: 'Bearer ' + auth, ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify({ operation: 'active_model_readback' }),
  }), (() => { throw Error('ordinary-user path reached'); }) as Parameters<typeof handler>[1],
     (() => client) as unknown as NonNullable<Parameters<typeof handler>[2]>, () => true, {
       readbackKey: () => 'mock-service-role',
       providerKey: () => { throw Error('provider path reached'); },
     });
  assert.equal((await invoke('ordinary-user')).status, 403);
  assert.equal((await invoke('mock-service-role','http://localhost:5173')).status, 403);
  assert.equal(reads, 0);
  const accepted = await invoke('mock-service-role');
  assert.deepEqual(await accepted.json(), { model: contract.model, revision: 2, readiness: 'verified' });
  assert.equal(reads, 1);
});
