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

### Scenario 2: Developer Testing & Anonymous Usage

**Symptom:** As a developer, you want to test the cloud transcription flow without needing to log in as a "pro" user. The production authentication flow gets in the way.

**Cause:** The production flow is designed to be secure and requires a valid, authenticated user session to generate a token. This is intentional.

**Solution:** A special "Developer Mode" has been implemented.

1.  **Create a `.env.local` file** in the root of your project if you don't have one.
2.  **Add your AssemblyAI API key** to this file. The key name must be `VITE_ASSEMBLYAI_API_KEY`.
    ```
    VITE_ASSEMBLYAI_API_KEY=your_assemblyai_api_key_here
    ```
3.  **Run the app in dev mode** (`pnpm run dev`).

When the application is in dev mode (`import.meta.env.DEV` is true) and it finds the `VITE_ASSEMBLYAI_API_KEY`, it will bypass the Supabase function entirely and generate a temporary token directly in the browser. This allows for full testing of the cloud transcription pipeline without any authentication.

#### How `import.meta.env.DEV` Works

`import.meta.env.DEV` is a special variable provided by **Vite**, the build tool used for this project. It is not something you set manually. Vite automatically sets its value based on how the application is running:

-   **`true`**: When you run the development server (e.g., `pnpm run dev`).
-   **`false`**: When you build the application for production (e.g., `pnpm run build`).

This allows the code to have different behaviors in development and production environments, which is exactly how "Developer Mode" is enabled.

The code for this logic is in `src/services/transcription/modes/CloudAssemblyAI.js`:
```javascript
async _getTemporaryToken() {
  // Dev mode: get token directly from local env var
  if (import.meta.env.DEV && import.meta.env.VITE_ASSEMBLYAI_API_KEY) {
      console.log('[CloudAssemblyAI] Dev mode: creating temporary token directly.');
      const assemblyai = new AssemblyAI({ apiKey: import.meta.env.VITE_ASSEMBLYAI_API_KEY });
      const token = await assemblyai.realtime.createTemporaryToken({ expires_in: 3600 });
      return token;
  }
  // ... production logic follows
}
```

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