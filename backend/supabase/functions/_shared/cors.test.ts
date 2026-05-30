import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { corsHeaders } from "./cors.ts";

Deno.test("shared CORS headers are request-aware", async (t) => {
  await t.step("echoes localhost origins for local development", () => {
    const headers = corsHeaders(new Request("http://localhost", {
      headers: { Origin: "http://localhost:5173" },
    }));

    assertEquals(headers["Access-Control-Allow-Origin"], "http://localhost:5173");
  });

  await t.step("echoes Vercel preview origins for release previews", () => {
    const headers = corsHeaders(new Request("http://localhost", {
      headers: { Origin: "https://speaksharp-public-git-main-team.vercel.app" },
    }));

    assertEquals(headers["Access-Control-Allow-Origin"], "https://speaksharp-public-git-main-team.vercel.app");
  });

  await t.step("does not echo untrusted origins", () => {
    const headers = corsHeaders(new Request("http://localhost", {
      headers: { Origin: "https://evil.example" },
    }));

    assertNotEquals(headers["Access-Control-Allow-Origin"], "https://evil.example");
  });

  await t.step("falls back to a single valid origin instead of a comma-separated list", () => {
    const headers = corsHeaders(new Request("http://localhost", {
      headers: { Origin: "https://evil.example" },
    }));

    assertNotEquals(headers["Access-Control-Allow-Origin"], "https://speaksharp.vercel.app,https://speaksharp-public.vercel.app");
  });
});
