// src/mocks/handlers.ts
import { http, HttpResponse } from 'msw';

export const handlers = [
  // Mock for user sign-in
  http.post('*/auth/v1/token', () => {
    return HttpResponse.json({
      access_token: 'mock-access-token',
      refresh_token: 'mock-refresh-token',
      user: {
        id: 'test-user-id',
        email: 'test@example.com',
      },
    });
  }),

  // Mock for fetching a user profile
  http.get('*/rest/v1/user_profiles', ({ request }) => {
    const url = new URL(request.url);
    const userId = url.searchParams.get('id')?.replace('eq.', '');

    if (userId === 'test-user-id') {
      return HttpResponse.json([
        {
          id: userId,
          name: 'Test User',
          email: 'test@example.com',
          subscription_status: 'free',
        },
      ]);
    }
    // Return an empty array for any other user to avoid test errors
    return HttpResponse.json([]);
  }),
];