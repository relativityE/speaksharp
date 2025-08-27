# Known Issues

This document tracks known, unresolved issues in the SpeakSharp application.

## 1. AssemblyAI API Call Fails with `400 Bad Request`

**Last Updated:** 2025-08-27

### Symptoms

When a user attempts to start a cloud-based transcription session, the request to the `/functions/v1/assemblyai-token` Supabase function fails. The browser console shows a `400 Bad Request` error for this endpoint. The frontend application correctly catches this error and, if not in "Force Cloud" mode, falls back to the native browser speech recognition.

### Debugging Steps Taken

This issue has been the subject of an extensive and exhaustive debugging process. The following potential causes have been systematically investigated and **ruled out**:

1.  **CORS Policy:** The issue is not a CORS preflight (`OPTIONS`) failure. Logs confirm the function handler executes, meaning the preflight request is succeeding. A shared CORS module (`_shared/cors.ts`) was also implemented to ensure consistency.
2.  **Server Runtime:** The function was migrated from the `std/http` `serve` to the modern `Deno.serve` to rule out runtime inconsistencies.
3.  **Supabase Function Configuration:** The project's `config.toml` was audited and cleaned of any dangling configurations for deleted functions.
4.  **User Authentication (JWT):** The function correctly receives the user's JWT. A server-side log, `Successfully authenticated user: <user-id>`, confirms that the Supabase Admin client successfully validates the token before the AssemblyAI API call is made.
5.  **AssemblyAI `expires_in` Parameter:** The `createTemporaryToken` call was updated to use a value of `600`, which is confirmed by the AssemblyAI documentation to be valid.
6.  **AssemblyAI `model` Parameter:** The call was attempted both with and without the `model: 'universal'` parameter. The error persists in both cases.
7.  **AssemblyAI API Key:** The user regenerated a new API key from their AssemblyAI dashboard and updated it in the Supabase project secrets. The error persisted, ruling out an expired or typo-ed key.
8.  **AssemblyAI Account Tier:** The user is on the "Free Plan". We hypothesized that the `universal` model was a paid feature, but removing it did not solve the problem. The `400` error occurs even when requesting a token for the default model.

### Final Hypothesis

After ruling out all of the above, the only remaining conclusion is that the issue lies within the AssemblyAI SDK or its backend service, in a way that is not clearly documented. The failure occurs inside this specific line of code in the `assemblyai-token` function:

```typescript
const tempToken = await assemblyai.realtime.createTemporaryToken({ expires_in: 600 });
```

The AssemblyAI SDK (`assemblyai@4.15.0`) throws an error which our function's `catch` block correctly reports as a `400 Bad Request`. Without visibility into the AssemblyAI SDK's internal network requests or a more descriptive error message from their API, it is impossible to debug this further from our end.

**Next Steps:**
- The issue should be escalated to AssemblyAI support.
- The investigation should include providing them with the exact details of the request environment (Supabase Edge Function, Deno v2.1.4) and the SDK version being used.
- It may be necessary to bypass the SDK and make a direct `curl` or `fetch` request to the `https://streaming.assemblyai.com/v3/token` endpoint from within the Supabase function to see if a more detailed error response can be obtained.
