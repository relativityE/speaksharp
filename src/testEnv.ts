// src/testEnv.ts
// Hardened test environment shims for Playwright E2E

// Only apply if Vite is running in test mode
const isTest = import.meta.env.MODE === "test";

if (isTest) {
  // --- Stripe ---
  // Prevent loadStripe from fetching external script
  // and prevent redirectToCheckout from breaking tests
  (globalThis as any).loadStripe = async () => ({
    redirectToCheckout: async () => {
      console.warn("[testEnv] Stripe.redirectToCheckout called — stubbed");
      return { error: null };
    }
  });

  // --- PostHog ---
  (globalThis as any).posthog = {
    init: () => console.warn("[testEnv] PostHog.init stub"),
    capture: () => console.warn("[testEnv] PostHog.capture stub"),
    identify: () => {},
    people: { set: () => {} },
    reset: () => {}
  };

  // --- Sentry ---
  (globalThis as any).Sentry = {
    init: () => console.warn("[testEnv] Sentry.init stub"),
    captureException: () => {},
    captureMessage: () => {}
  };

  // --- AssemblyAI ---
  // No-op WebSocket so connection attempts don’t block render
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

export {}; // ensures this is treated as a module
