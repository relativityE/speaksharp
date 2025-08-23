# Debugging Guide

This document provides guidance for debugging common issues in the SpeakSharp application.

## AssemblyAI API Key Issues

A common and frustrating issue is the failure of the cloud-based transcription, which often presents as the following error message in the application:

**"Failed to get AssemblyAI token. Please ensure the server is configured with an API key."**

This error indicates a problem somewhere in the chain of operations that fetches a temporary token for the AssemblyAI service. Here is a step-by-step guide to diagnose and resolve the root cause.

### Root Cause Analysis Flowchart

The problem can be in the frontend (the browser application) or the backend (the Supabase Edge Function). The key is to determine how far the request gets before it fails.

1.  **Is the frontend trying to get the token?**
2.  **Is the backend function being called successfully?**
3.  **Is the backend function authenticated?**
4.  **Is the backend function able to access the API key?**

### Debugging Steps

Follow these steps in order.

#### 1. Check the Browser's Developer Console

This is the first and most important step. It tells you if the frontend code is even attempting to make the call to the backend.

1.  Open your browser's developer tools (usually by pressing **F12** or right-clicking and selecting **"Inspect"**).
2.  Go to the **"Console"** tab.
3.  In the SpeakSharp application, navigate to the "Session" page and try to start a recording in "Cloud" mode.
4.  Look for the following log message in the console:

    ```
    [CloudAssemblyAI] Attempting to get temporary token...
    ```

*   **If this log message is MISSING:**
    *   **Problem:** The frontend is not even trying to call the backend function.
    *   **Cause:** This is likely a bug in the frontend logic that controls the transcription mode. The application might be "stuck" on a different mode (`local` or `native`) and not correctly switching to `cloud`.
    *   **Solution:** Investigate the `useSpeechRecognition.js` hook. A bug was previously fixed where the `TranscriptionService` was not being updated when the `mode` prop changed. Ensure that a `useEffect` is present to handle mode changes, like this:
        ```javascript
        useEffect(() => {
            if (transcriptionServiceRef.current && mode !== currentMode) {
                transcriptionServiceRef.current.setMode(mode)
                    .then(() => setCurrentMode(mode))
                    .catch(setError);
            }
        }, [mode, currentMode]);
        ```

*   **If this log message is PRESENT:**
    *   **Good news:** The frontend is working as expected. The problem lies in the communication with the backend or in the backend function itself. Proceed to the next step.

#### 2. Check the Network Request Status

If the `[CloudAssemblyAI]` log is present, the next thing to check in the browser's developer console is the network request itself.

1.  Switch to the **"Network"** tab in the developer tools.
2.  Trigger the call again (click "Start Recording" in the app).
3.  Look for a request to `assemblyai-token`.
4.  Check the **Status** of this request.

*   **If the status is `401 Unauthorized`:**
    *   **Problem:** The request is reaching the backend, but the backend function does not recognize the user as being logged in.
    *   **Cause:** The user's authentication token (JWT) is not being correctly sent with the request. The Supabase client library should do this automatically, but sometimes it can fail.
    *   **Solution:** Modify the `_getTemporaryToken` function in `src/services/transcription/modes/CloudAssemblyAI.js` to explicitly fetch the user's session and include the access token in the `Authorization` header.
        ```javascript
        async _getTemporaryToken() {
          try {
            // Explicitly get the user's session
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
              throw new Error('User not authenticated.');
            }

            // Manually set the Authorization header
            const { data, error } = await supabase.functions.invoke('assemblyai-token', {
              headers: {
                'Authorization': `Bearer ${session.access_token}`
              }
            });

            if (error) { throw error; }
            // ...
          } catch (error) { /* ... */ }
        }
        ```

#### 3. Check the Supabase Function Logs

If the network request is being made but is failing with a status other than `401` (e.g., `500 Internal Server Error`), or if you want to confirm the backend is receiving the request, you need to check the logs for the Edge Function itself.

1.  Go to your **Supabase project dashboard**.
2.  In the left sidebar, click on the **Edge Functions** icon (**λ**).
3.  Select the **`assemblyai-token`** function from the list.
4.  Review the logs in the "Logs" section.
5.  Look for the diagnostic logs that were added to the function:
    ```
    ASSEMBLYAI_API_KEY exists: ...
    ASSEMBLYAI_API_KEY starts with: ...
    ```

*   **If these log messages are MISSING (after you've triggered the function from the app):**
    *   **Problem:** The function is not being executed at all, despite the frontend making a request. This could be a configuration issue with the function itself (e.g., wrong name). Double-check the function name in the `supabase.functions.invoke` call.

*   **If the log says `ASSEMBLYAI_API_KEY exists: false`:**
    *   **Problem:** The `ASSEMBLYAI_API_KEY` is not available to the function's environment.
    *   **Cause:** The secret was not set correctly in the Supabase project settings, or the function was not redeployed after the secret was set.
    *   **Solution:**
        1.  In the Supabase dashboard, go to **Settings -> Secrets** and ensure a secret named `ASSEMBLYAI_API_KEY` exists and has the correct value.
        2.  Redeploy the function from your local machine using the Supabase CLI to ensure it picks up the latest secrets:
            ```bash
            npx supabase functions deploy
            ```

By following these steps, you should be able to systematically diagnose and resolve any issues related to the AssemblyAI token fetching process.
