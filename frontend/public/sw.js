/**
 * ============================================================================
 * SERVICE WORKER: Whisper Model Cache Interceptor
 * ============================================================================
 * 
 * PURPOSE:
 * --------
 * This service worker dramatically improves load times for the On-Device 
 * Whisper transcription mode by caching the 30MB Whisper model locally.
 * 
 * WITHOUT THIS SERVICE WORKER:
 *   - Every session: Downloads 30MB model from CDN (~30+ seconds)
 *   - Poor user experience for offline or slow connections
 * 
 * WITH THIS SERVICE WORKER:
 *   - First load: Downloads from CDN (one-time cost)
 *   - Subsequent loads: Serves from local cache (<1 second!)
 * 
 * HOW IT WORKS:
 * -------------
 * 1. INSTALL & ACTIVATE:
 *    - Service worker is registered when user visits the app
 *    - `skipWaiting()` ensures immediate activation
 *    - `clients.claim()` takes control of all open tabs
 * 
 * 2. REQUEST INTERCEPTION:
 *    - Intercepts fetch requests for Whisper model URLs
 *    - Maps remote CDN URLs to local paths (see URL_MAPPINGS)
 *    - Serves cached files from /models/ directory
 * 
 * 3. FALLBACK STRATEGY:
 *    - If local file fails to load, falls back to original CDN URL
 *    - Ensures robustness even if cache is corrupted
 * 
 * URL MAPPINGS:
 * -------------
 * | Remote URL (CDN)                                  | Local Path              |
 * |--------------------------------------------------|-------------------------|
 * | https://rmbl.us/whisper-turbo/tiny-q8g16.bin    | /models/tiny-q8g16.bin  |
 * | https://huggingface.co/.../tokenizer.json       | /models/tokenizer.json  |
 * 
 * CACHE STRATEGY:
 * ---------------
 * - Cache-First: Always attempt local file first
 * - Network Fallback: Fall back to CDN if local fails
 * - No expiration: Models are immutable (version bumps invalidate cache)
 * 
 * SETUP INSTRUCTIONS:
 * -------------------
 * 1. Download model files:
 *    $ scripts/download-whisper-model.sh
 * 
 * 2. Service worker auto-registers in public/index.html:
 *    <script>
 *      if ('serviceWorker' in navigator) {
 *        navigator.serviceWorker.register('/sw.js');
 *      }
 *    </script>
 * 
 * 3. Verify in DevTools:
 *    - Application tab > Service Workers
 *    - Should show status: "Activated and running"
 * 
 * TESTING:
 * --------
 * 1. Clear cache: DevTools > Application > Clear site data
 * 2. Open app, go to Session page, select "On-Device" mode
 * 3. First load: Check Network tab, should see CDN request (~30s)
 * 4. Refresh page, try On-Device again
 * 5. Second load: Network tab shows 0 bytes transferred, instant load!
 * 
 * VERSIONING:
 * -----------
 * - Bump MODEL_CACHE_NAME version when updating model files
 * - Example: 'whisper-models-v2' forces cache invalidation
 * 
 * BROWSER SUPPORT:
 * ----------------
 * - Chrome 45+, Firefox 44+, Safari 11.1+, Edge 17+
 * - Gracefully degrades: If SW unsupported, downloads from CDN as usual
 * 
 * PERFORMANCE IMPACT:
 * -------------------
 * - First Load: No change (still downloads from CDN)
 * - Subsequent Loads: 30x faster (30s → <1s)
 * - Network Usage: Reduced by 30MB per session after first load
 * 
 * RELATED FILES:
 * --------------
 * - scripts/download-whisper-model.sh: Downloads models to /public/models/
 * - scripts/check-whisper-update.sh: Checks for model updates from CDN
 * - frontend/src/services/transcription/modes/OnDeviceWhisper.ts: Uses the cached models
 * - frontend/src/hooks/useSpeechRecognition/index.ts: Manages loading state
 * 
 * E2E TESTS:
 * ----------
 * - tests/e2e/ondevice-stt.e2e.spec.ts: UX flow, caching, P1 regression
 * 
 * DOCUMENTATION:
 * --------------
 * See docs/ARCHITECTURE.md > "On-Device STT (Whisper) & Service Worker Caching"
 * 
 * ============================================================================
 */

const MODEL_CACHE_NAME = 'whisper-models-v1';

// Map remote URLs to local paths
const URL_MAPPINGS = {
    'https://rmbl.us/whisper-turbo/tiny-q8g16.bin': '/models/tiny-q8g16.bin',
    'https://huggingface.co/openai/whisper-large-v2/raw/main/tokenizer.json': '/models/tokenizer.json',
};

self.addEventListener('install', (event) => {
    self.skipWaiting();
    console.log('[ServiceWorker] Installed');
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
    console.log('[ServiceWorker] Activated');
});

self.addEventListener('fetch', (event) => {
    const url = event.request.url;

    // Check if the URL matches any of our mapped remote URLs
    if (URL_MAPPINGS[url]) {
        const localPath = URL_MAPPINGS[url];
        console.log(`[ServiceWorker] Intercepting ${url} -> Checking cache / fallback to local: ${localPath}`);

        event.respondWith(
            caches.open(MODEL_CACHE_NAME).then((cache) => {
                // 1. Check cache for the ORIGINAL request (Remote URL)
                return cache.match(event.request).then((cachedResponse) => {
                    if (cachedResponse) {
                        console.log(`[ServiceWorker] Serving from cache: ${url}`);
                        return cachedResponse;
                    }

                    // 2. If miss, fetch from LOCAL path (bundled assets)
                    console.log(`[ServiceWorker] Cache miss. Fetching local asset: ${localPath}`);
                    return fetch(localPath).then((response) => {
                        if (!response.ok) {
                            console.warn(`[ServiceWorker] Local asset missing: ${localPath}. Falling back to network.`);
                            // 3. Fallback: Fetch original remote URL
                            return fetch(event.request);
                        }

                        // 4. Store the response in cache under the ORIGINAL request key
                        cache.put(event.request, response.clone());
                        return response;
                    }).catch((err) => {
                        console.error(`[ServiceWorker] Error fetching local asset: ${err}`);
                        return fetch(event.request);
                    });
                });
            })
        );
    }
});
