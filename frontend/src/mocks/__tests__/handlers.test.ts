import { describe, it, expect, afterEach, afterAll, beforeAll } from 'vitest';
import { setupServer } from 'msw/node';
import { handlers } from '../handlers';

// Create a test server with our handlers
const server = setupServer(...handlers);

describe('MSW Handlers', () => {
    beforeAll(() => {
        server.listen({ onUnhandledRequest: 'bypass' });
    });

    afterEach(() => {
        server.resetHandlers();
        vi.clearAllMocks();
    });

    afterAll(() => {
        server.close();
    });

    describe('GET /auth/v1/user', () => {
        it('should return a mock user', async () => {
            const response = await fetch('https://mock.supabase.co/auth/v1/user');
            const data = await response.json();

            expect(response.ok).toBe(true);
            expect(data).toHaveProperty('id', 'test-user-123');
            expect(data).toHaveProperty('email', 'test@example.com');
        });
    });

    describe('POST /auth/v1/signup', () => {
        it('should return a mock session', async () => {
            const response = await fetch('https://mock.supabase.co/auth/v1/signup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: 'new@example.com', password: 'password123' }),
            });
            const data = await response.json();

            expect(response.ok).toBe(true);
            expect(data).toHaveProperty('access_token');
            expect(data).toHaveProperty('user');
            expect(data.user).toHaveProperty('id', 'test-user-123');
        });
    });

    describe('POST /auth/v1/token', () => {
        it('should return a mock session for token exchange', async () => {
            const response = await fetch('https://mock.supabase.co/auth/v1/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ grant_type: 'password' }),
            });
            const data = await response.json();

            expect(response.ok).toBe(true);
            expect(data).toHaveProperty('access_token');
            expect(data).toHaveProperty('refresh_token');
        });
    });

    describe('GET /rest/v1/user_profiles', () => {
        it('should return a single profile object when Accept header requests it', async () => {
            const response = await fetch('https://mock.supabase.co/rest/v1/user_profiles', {
                headers: {
                    'Accept': 'application/vnd.pgrst.object+json',
                },
            });
            const data = await response.json();

            expect(response.ok).toBe(true);
            expect(data).toHaveProperty('id', 'test-user-123');
            expect(data).toHaveProperty('subscription_status', 'pro');
            expect(Array.isArray(data)).toBe(false);
        });

        it('should return an array of profiles by default', async () => {
            const response = await fetch('https://mock.supabase.co/rest/v1/user_profiles');
            const data = await response.json();

            expect(response.ok).toBe(true);
            expect(Array.isArray(data)).toBe(true);
            expect(data.length).toBe(1);
            expect(data[0]).toHaveProperty('id', 'test-user-123');
        });
    });

    describe('GET /rest/v1/sessions', () => {
        it('should return mock session history by default', async () => {
            const response = await fetch('https://mock.supabase.co/rest/v1/sessions');
            const data = await response.json();

            expect(response.ok).toBe(true);
            expect(Array.isArray(data)).toBe(true);
            // Now returns 5 sessions showing improvement trend
            expect(data.length).toBe(5);
            expect(data[0]).toHaveProperty('id', 'session-1');
            // First session has low clarity (beginner)
            expect(data[0]).toHaveProperty('clarity_score', 72.5);
            // Last session has high clarity (improved)
            expect(data[4]).toHaveProperty('clarity_score', 95.8);
        });

        it('should return empty array when x-e2e-empty-sessions header is set', async () => {
            const response = await fetch('https://mock.supabase.co/rest/v1/sessions', {
                headers: {
                    'x-e2e-empty-sessions': 'true',
                },
            });
            const data = await response.json();

            expect(response.ok).toBe(true);
            expect(Array.isArray(data)).toBe(true);
            expect(data.length).toBe(0);
        });

        it('should include filler words data in sessions', async () => {
            const response = await fetch('https://mock.supabase.co/rest/v1/sessions');
            const data = await response.json();

            expect(data[0].filler_words).toHaveProperty('um');
            expect(data[0].filler_words).toHaveProperty('uh');
            expect(data[0].filler_words).toHaveProperty('total');
            // First session (beginner) has 20 fillers, last session has 1
            expect(data[0].filler_words.total.count).toBe(20);
            expect(data[4].filler_words.total.count).toBe(1);
        });

        it('should return sessions with valid dates', async () => {
            const response = await fetch('https://mock.supabase.co/rest/v1/sessions');
            const data = await response.json();

            // Sessions should have valid ISO date strings
            const date1 = new Date(data[0].created_at);
            const date5 = new Date(data[4].created_at);

            expect(date1.getTime()).not.toBeNaN();
            expect(date5.getTime()).not.toBeNaN();
            // Session 1 is oldest (7 days ago), Session 5 is most recent (today)
            expect(date5.getTime()).toBeGreaterThan(date1.getTime());
        });
    });
});
