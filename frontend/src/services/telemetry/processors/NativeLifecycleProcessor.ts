import type { MetricProcessor, MetricsSnapshot, TelemetryEvent } from '../contracts';

/**
 * Phase 5.2 — NativeLifecycleProcessor.
 *
 * Owns the `engine` slice: result/final/interim/error/restart counts and lifecycle timing. Native
 * restarts arrive as a fresh `webspeech.lifecycle: 'start'` (the reactive onend restart); Private/Cloud
 * restarts arrive as `engine.lifecycle: 'restart'`. A given mode emits only one of these, so counting
 * both is safe. starvationMs = the largest gap between speech being detected and the next result.
 */
export class NativeLifecycleProcessor implements MetricProcessor {
  readonly name = 'native-lifecycle';
  private finalCount = 0;
  private interimCount = 0;
  private errorCount = 0;
  private restartCount = 0;
  private firstStartT: number | null = null;
  private firstTextT: number | null = null;
  private lastResultT: number | null = null;
  private pendingSpeechStartT: number | null = null;
  private maxStarvationMs = 0;

  onEvent(event: TelemetryEvent): void {
    switch (event.type) {
      case 'webspeech.lifecycle':
        if (event.event === 'start') {
          if (this.firstStartT === null) this.firstStartT = event.t;
          else this.restartCount += 1; // a 'start' after the first is a restart
        } else if (event.event === 'speechStart') {
          this.pendingSpeechStartT = event.t;
        }
        break;
      case 'engine.lifecycle':
        if (event.event === 'restart') this.restartCount += 1;
        else if (event.event === 'start' && this.firstStartT === null) this.firstStartT = event.t;
        break;
      case 'engine.error':
        this.errorCount += 1;
        break;
      case 'transcript.final':
      case 'transcript.partial': {
        if (event.type === 'transcript.final') this.finalCount += 1;
        else this.interimCount += 1;
        if (this.firstTextT === null) this.firstTextT = event.t;
        if (this.pendingSpeechStartT !== null) {
          this.maxStarvationMs = Math.max(this.maxStarvationMs, event.t - this.pendingSpeechStartT);
          this.pendingSpeechStartT = null;
        }
        this.lastResultT = event.t;
        break;
      }
    }
  }

  getSnapshot(): Partial<MetricsSnapshot> {
    return {
      engine: {
        resultCount: this.finalCount + this.interimCount,
        finalCount: this.finalCount,
        interimCount: this.interimCount,
        errorCount: this.errorCount,
        restartCount: this.restartCount,
        firstTextMs:
          this.firstStartT !== null && this.firstTextT !== null
            ? Math.max(0, this.firstTextT - this.firstStartT)
            : undefined,
        lastResultMs: this.lastResultT ?? undefined,
        starvationMs: this.maxStarvationMs || undefined,
      },
    };
  }

  reset(): void {
    this.finalCount = 0;
    this.interimCount = 0;
    this.errorCount = 0;
    this.restartCount = 0;
    this.firstStartT = null;
    this.firstTextT = null;
    this.lastResultT = null;
    this.pendingSpeechStartT = null;
    this.maxStarvationMs = 0;
  }
}
