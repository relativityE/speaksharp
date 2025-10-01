import { http, HttpResponse } from 'msw';

export const handlers = [
  http.post("https://*.supabase.co/auth/v1/token", async ({ request }) => {
    const body = await request.json() as { grant_type: string, email?: string };

    if (body.grant_type === "password") {
      const role = body.email?.endsWith("@pro.com") ? "pro" : "free";
      return HttpResponse.json({
          access_token: `${role}-token`,
          user: { id: "123", email: body.email, role },
        });
    }

    if (body.grant_type === "refresh_token") {
      return HttpResponse.json({
          access_token: "refreshed-token",
          user: { id: "123", role: "pro" },
        });
    }

    return HttpResponse.json({ error: `Unsupported grant_type: ${body.grant_type}` }, { status: 400 });
  }),

  // The other handlers were simple and already correct.
  http.get('https://*.supabase.co/rest/v1/user_profiles', () => {
    return HttpResponse.json([]);
  }),
  http.get('https://*.supabase.co/rest/v1/sessions', () => {
    return HttpResponse.json([]);
  }),
];