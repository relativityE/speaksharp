import { handler } from './index.ts';
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { verify } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

Deno.test('generate-dev-jwt edge function', async (t) => {
  const originalDevKey = Deno.env.get("DEV_SECRET_KEY");
  const originalJwtSecret = Deno.env.get("SUPABASE_JWT_SECRET");

  Deno.env.set("DEV_SECRET_KEY", "my-secret-dev-key");
  Deno.env.set("SUPABASE_JWT_SECRET", "super-secret-jwt-secret-for-testing");
  Deno.env.set("UUID_DEV_USER", "e9e0a6a0-0e0a-4e0a-a0e0-a0e0a0e0a0e0");

  await t.step('should return 401 if dev key is missing', async () => {
    const req = new Request('http://localhost/generate-dev-jwt', { method: 'POST' });
    const res = await handler(req);
    assertEquals(res.status, 401);
    const json = await res.json();
    assertEquals(json.error, 'Invalid developer key.');
  });

  await t.step('should return 401 if dev key is incorrect', async () => {
    const req = new Request('http://localhost/generate-dev-jwt', {
      method: 'POST',
      headers: { 'X-Dev-Secret-Key': 'wrong-key' }
    });
    const res = await handler(req);
    assertEquals(res.status, 401);
  });

  await t.step('should return a valid JWT if correct dev key is provided', async () => {
    const req = new Request('http://localhost/generate-dev-jwt', {
      method: 'POST',
      headers: { 'X-Dev-Secret-Key': 'my-secret-dev-key' }
    });
    const res = await handler(req);
    assertEquals(res.status, 200);
    const json = await res.json();
    assertExists(json.token);

    // Verify the JWT
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(Deno.env.get("SUPABASE_JWT_SECRET")),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"],
    );
    const payload = await verify(json.token, key);
    assertExists(payload);
    assertEquals(payload.role, 'authenticated');
    assertEquals(payload.sub, 'e9e0a6a0-0e0a-4e0a-a0e0-a0e0a0e0a0e0');
  });

  // Restore original environment variables
  if (originalDevKey) Deno.env.set("DEV_SECRET_KEY", originalDevKey);
  else Deno.env.delete("DEV_SECRET_KEY");
  if (originalJwtSecret) Deno.env.set("SUPABASE_JWT_SECRET", originalJwtSecret);
  else Deno.env.delete("SUPABASE_JWT_SECRET");
});
