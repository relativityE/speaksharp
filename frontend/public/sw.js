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
        console.log(`[ServiceWorker] Intercepting ${url} -> Serving local: ${localPath}`);

        event.respondWith(
            fetch(localPath).then((response) => {
                if (!response.ok) {
                    console.error(`[ServiceWorker] Failed to fetch local asset: ${localPath}`);
                    // Fallback to original request if local fails
                    return fetch(event.request);
                }
                return response;
            }).catch((err) => {
                console.error(`[ServiceWorker] Error serving local asset: ${err}`);
                return fetch(event.request);
            })
        );
    }
});
