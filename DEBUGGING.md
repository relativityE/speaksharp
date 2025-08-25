# Debugging Guide

This document provides guidance for debugging common issues in the SpeakSharp application.

## AssemblyAI Cloud Transcription Issues

A common and frustrating issue is the failure of the cloud-based transcription. This can manifest in a few different ways, but the root cause is usually related to authentication or environment setup.

### The Golden Rule: Check the Browser Console First!

Before you do anything else, open your browser's developer tools (F12), go to the **Console** tab, and try to start a cloud transcription session. The log messages there are the key to diagnosing the problem.

---

### Scenario 1: The "User not authenticated" Error

This is the most common failure mode discovered during recent debugging.

**Symptom:** The browser console shows the error `Error: User not authenticated.` originating from `CloudAssemblyAI.js`.

**Cause:** This error means that the application does not have the user's session information at the moment it tries to generate the AssemblyAI token. This happens even if the user is logged in, and it's caused by the session information not being correctly passed through the React component tree to the transcription service.

**Solution:** The fix is to "prop drill" the `session` object from the highest level where it's available (`SessionPage.jsx`) all the way down to the `CloudAssemblyAI.js` service.

1.  **`src/pages/SessionPage.jsx`**: Get the `session` from the `useAuth()` hook and pass it to `useSpeechRecognition`.
    ```javascript
    const { session } = useAuth();
    const speechRecognition = useSpeechRecognition({ ..., session });
    ```

2.  **`src/hooks/useSpeechRecognition.js`**: Accept the `session` prop and pass it down to the `TranscriptionService` constructor.
    ```javascript
    export const useSpeechRecognition = ({ ..., session }) => {
      // ...
      const service = new TranscriptionService(mode, { ..., session });
      // ...
    }
    ```

3.  **`src/services/transcription/TranscriptionService.js`**: The constructor and `_instantiate` method must pass the session to the provider.
    ```javascript
    constructor({ ..., session }) {
      this.session = session;
    }
    async _instantiate() {
      const providerConfig = { ..., session: this.session };
      this.instance = new CloudAssemblyAI(providerConfig);
    }
    ```

4.  **`src/services/transcription/modes/CloudAssemblyAI.js`**: The constructor receives the session, and `_getTemporaryToken` uses it.
    ```javascript
    constructor({ ..., session }) {
      this.session = session;
    }
    async _getTemporaryToken() {
      const session = this.session; // Use the passed-in session
      if (!session) {
        throw new Error('User not authenticated.');
      }
      // ... proceed to call Supabase function
    }
    ```

---

### Scenario 2: Secure Developer Testing

**Symptom:** As a developer, you want to test the cloud transcription flow without needing to log in as a "pro" user. The production authentication flow, which requires a valid login, gets in the way.

**Cause:** The production flow is intentionally secure. It requires a valid, authenticated user session to generate an AssemblyAI token via the `assemblyai-token` Supabase function. This protects the main AssemblyAI API key.

**Solution:** A secure "Developer Mode" has been implemented. This mode uses a shared secret to allow the client to request a token from the Supabase function, bypassing the normal user login and "pro" plan checks.

This requires setting up secrets in two places:

1.  **For the Supabase Function (Backend):**
    *   Navigate to your Supabase project dashboard.
    *   Go to **Settings -> Secrets**.
    *   Create a **new secret** with the exact name `DEV_SECRET_KEY`.
    *   Set its value to a strong, random string (e.g., `dev-secret-12345`). This secret proves to your function that a developer is making the request.
    *   After setting the secret, you **must** redeploy your Supabase functions for the change to take effect:
        ```bash
        npx supabase functions deploy
        ```

2.  **For the React App (Client):**
    *   In your local `.env.local` file, add a new line for the client-side secret. The name must be prefixed with `VITE_`.
        ```
        VITE_DEV_SECRET_KEY=dev-secret-12345
        ```
    *   The value of `VITE_DEV_SECRET_KEY` must be **exactly the same** as the value of `DEV_SECRET_KEY` in your Supabase secrets.
    *   **Important:** You must **restart your development server** (stop and restart `pnpm run dev`) after changing this file.

**How It Works:**

-   The client-side code in `CloudAssemblyAI.js` checks if `import.meta.env.VITE_DEV_SECRET_KEY` exists.
-   If it exists, it creates an `Authorization` header with the value of the secret (e.g., `Authorization: Bearer dev-secret-12345`).
-   It then calls the `assemblyai-token` Supabase function with this header.
-   The Supabase function receives the request. It reads its own `DEV_SECRET_KEY` environment variable and compares it to the `Authorization` header from the client.
-   If they match, the function bypasses all the normal user authentication checks, proceeding directly to generate and return a temporary AssemblyAI token.

This keeps the main `ASSEMBLYAI_API_KEY` secure on the backend while providing a streamlined and secure workflow for local development.

---

### Scenario 3: Backend & Environment Issues

**Symptom:** You have a valid session, but you still get an error like `Failed to get AssemblyAI token...`. The browser network tab might show a `4xx` or `5xx` error for the `assemblyai-token` function call.

**Cause:** The issue is likely on the backend or in the deployment environment.

**Solution:**

1.  **Check Supabase Function Logs:** Go to your Supabase project dashboard, navigate to Edge Functions -> `assemblyai-token`, and check the logs. Look for the diagnostic logs: `ASSEMBLYAI_API_KEY exists: ...`.
    *   If `exists: false`, your Supabase secret is not set correctly or the function was not redeployed after the secret was set.
    *   **Fix:** Go to **Settings -> Secrets**, ensure `ASSEMBLYAI_API_KEY` has the correct value, and then redeploy the functions from your terminal:
        ```bash
        npx supabase functions deploy
        ```
2.  **Check for 401/403 Errors:** If the backend function is being called but you get an authorization error, it means the backend function is rejecting your user. Ensure your user has the correct `subscription_status` in the `user_profiles` table if you are testing the "pro" user flow.
