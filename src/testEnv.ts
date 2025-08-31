// src/testEnv.ts
if (import.meta.env.MODE === "test") {
  console.warn("[testEnv] Initializing runtime shims");

  // Stripe stub
  (globalThis as any).Stripe = function StripeStub() {
    console.warn("[testEnv] Stripe called");
    return {
      redirectToCheckout: async () => {
        console.warn("[testEnv] redirectToCheckout stubbed");
        return { error: null };
      },
    };
  };

  // PostHog stub
  (globalThis as any).posthog = {
    capture: (...args: any[]) =>
      console.warn("[testEnv] posthog.capture", args),
    identify: () => {},
    reset: () => {},
  };

  // Sentry stub
  (globalThis as any).Sentry = {
    init: () => console.warn("[testEnv] Sentry.init stubbed"),
    captureException: (e: any) =>
      console.warn("[testEnv] Sentry.captureException", e),
  };

  // AssemblyAI WebSocket stub
  const RealWS = globalThis.WebSocket;
  (globalThis as any).WebSocket = class extends RealWS {
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
