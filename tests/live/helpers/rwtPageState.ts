/**
 * Content-free reads of a deployed page's recording state, shared by the supplemental RWT specs (R2/R3). Only published
 * DOM state and the run's own microphone counter are read: the runtime-state attribute, the recorder bar, live tracks.
 */
import type { Page } from '@playwright/test';
import { RECORDER_BAR } from '../../helpers/micControls';
import { liveMicTracks } from './rwtJourney';
import { CLOUD_STT_REQUEST, type TabState } from './rwtAbandonTakeover';

export async function tabState(page: Page): Promise<TabState> {
    return {
        runtimeState: await page.locator('html').getAttribute('data-runtime-state').catch(() => null),
        recorderVisible: await page.getByTestId(RECORDER_BAR).count().then((n) => n > 0).catch(() => false),
        liveTracks: await liveMicTracks(page).catch(() => 0),
    };
}

/** Receipt evidence is flat scalars: one tab's state under a prefix. */
export const flatTabState = (prefix: string, s: TabState) => ({
    [`${prefix}RuntimeState`]: s.runtimeState, [`${prefix}RecorderVisible`]: s.recorderVisible, [`${prefix}LiveTracks`]: s.liveTracks,
});

/** Recording, as the page shows it: RECORDING published and the recorder bar on the page. */
export const isRecording = (page: Page, timeout: number): Promise<boolean> => page.waitForFunction(
    (bar) => document.documentElement.getAttribute('data-runtime-state') === 'RECORDING' && document.querySelector(`[data-testid="${bar}"]`) !== null,
    RECORDER_BAR, { timeout }).then(() => true).catch(() => false);

export const persistedId = (page: Page): Promise<string | null> =>
    page.evaluate(() => document.documentElement.getAttribute('data-session-persisted-id'));

/** Count Cloud STT requests and sockets from this page (URLs only, never bodies). */
export function observeCloudStt(page: Page, cloud: { requests: number }): void {
    page.on('request', (r) => { if (CLOUD_STT_REQUEST.test(r.url())) cloud.requests += 1; });
    page.on('websocket', (ws) => { if (CLOUD_STT_REQUEST.test(ws.url())) cloud.requests += 1; });
}
