import { performance } from 'node:perf_hooks';
import type { Page, Request } from 'playwright';

export type AssetTransfer = {
  requestCount: number;
  failedRequests: number;
  responseBodyBytes: number;
  requestWindowMs: number | null;
  cacheDisabled: true;
};

/** Measures the uncached model-asset HTTP request window, not model parsing or initialization. */
export class AssetTransferRecorder {
  private readonly started = new Map<Request, number>();
  private readonly pending: Promise<void>[] = [];
  private first: number | null = null;
  private last: number | null = null;
  private count = 0;
  private failed = 0;
  private bytes = 0;

  async attach(page: Page): Promise<void> {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    const isModelAsset = (request: Request): boolean => {
      const url = request.url();
      return url.includes('/models/') || url.includes('/resolve/') ||
        url.includes('download.moonshine.ai/model/');
    };
    // BrowserContext sees dedicated-worker requests as well as document requests. Page request
    // events alone miss the large ONNX weight fetches made inside the v4 worker.
    const context = page.context();
    context.on('request', (request) => {
      if (!isModelAsset(request)) return;
      const now = performance.now();
      this.started.set(request, now);
      this.first = this.first === null ? now : Math.min(this.first, now);
      this.count += 1;
    });
    context.on('requestfinished', (request) => {
      if (!this.started.has(request)) return;
      this.last = performance.now();
      this.started.delete(request);
      this.pending.push(request.sizes().then((sizes) => {
        this.bytes += sizes.responseBodySize;
      }).catch(() => { this.failed += 1; }));
    });
    context.on('requestfailed', (request) => {
      if (!this.started.has(request)) return;
      this.last = performance.now();
      this.started.delete(request);
      this.failed += 1;
    });
  }

  async snapshot(): Promise<AssetTransfer> {
    await Promise.all(this.pending);
    return {
      requestCount: this.count,
      failedRequests: this.failed,
      responseBodyBytes: this.bytes,
      requestWindowMs: this.first === null || this.last === null ? null : this.last - this.first,
      cacheDisabled: true,
    };
  }
}
