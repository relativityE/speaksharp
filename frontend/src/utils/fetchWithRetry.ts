/**
 * Utility for retrying fetch operations with exponential backoff.
 * Handles transient failures common in serverless/CI environments.
 */
import logger from '../lib/logger';
export async function fetchWithRetry<T>(
    fetchFn: () => Promise<T>,
    retries = 3,
    delayMs = 100
): Promise<T> {
    let attempt = 0;
    while (attempt <= retries) {
        try {
            return await fetchFn();
        } catch (err) {
            attempt++;
            if (attempt > retries) throw err;
            logger.info({ attempt, delayMs: delayMs * 2 ** (attempt - 1) }, '[fetchWithRetry] Retrying failed fetch');
            await new Promise(res => setTimeout(res, delayMs * 2 ** (attempt - 1))); // exponential backoff
        }
    }
    throw new Error('Unreachable code in fetchWithRetry');
}
