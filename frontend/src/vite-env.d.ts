/// <reference types="vite/client" />

// Release id is exposed at runtime as window.__APP_RELEASE__ (injected into index.html), not a build
// `define` — see frontend/vite.config.mjs (release-inject plugin) and config/appRuntimeConfig.ts.
