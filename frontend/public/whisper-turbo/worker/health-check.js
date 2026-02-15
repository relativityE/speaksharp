// 🛡️ [System Integrity] Worker Bootstrap Watchdog
// Inject this at the TOP of session.worker.js or wrap the initialization.

const BOOT_TIMEOUT_MS = 10000;
let bootCompleted = false;

const bootTimer = setTimeout(() => {
    if (!bootCompleted) {
        self.postMessage({
            type: 'BOOT_FAILURE',
            error: 'Worker failed to initialize within 10s',
            possibleCauses: [
                'WASM file not found or failed to compile (/whisper-turbo/ pathing)',
                'Model files missing or 404',
                'Import statement failed (check /whisper-turbo/db/ compatibility)'
            ]
        });
    }
}, BOOT_TIMEOUT_MS);

/**
 * Signals to the main thread that the worker has successfully initialized.
 */
function markBootComplete() {
    bootCompleted = true;
    clearTimeout(bootTimer);
    self.postMessage({ type: 'BOOT_SUCCESS' });
    console.log('[Worker] Bootstrap complete ✅');
}

// Expose globally for the bundled worker logic to call if possible, 
// or for use in the wrapper.
self.markBootComplete = markBootComplete;
