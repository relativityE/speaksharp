// src/testEnv.ts
if (import.meta.env.MODE === "test") {
  console.warn("[testEnv] Initializing runtime shims");

  // PostHog stub
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).posthog = {
    capture: (...args: unknown[]) =>
      console.warn("[testEnv] posthog.capture", args),
    identify: () => {},
    reset: () => {},
  };

  // Sentry stub
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Sentry = {
    init: () => console.warn("[testEnv] Sentry.init stubbed"),
    captureException: (e: unknown) =>
      console.warn("[testEnv] Sentry.captureException", e),
  };

  // AssemblyAI WebSocket stub
  const RealWS = globalThis.WebSocket;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).WebSocket = class extends RealWS {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(url: string, ...args: any[]) {
      if (url.includes("assemblyai.com")) {
        console.warn("[testEnv] Blocking AssemblyAI WebSocket:", url);
        super("ws://localhost:9", ...args); // dead socket
      } else {
        super(url, ...args);
      }
    }
  };
}
