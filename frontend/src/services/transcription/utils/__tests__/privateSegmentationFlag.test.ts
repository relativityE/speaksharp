// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isPrivateSegmentationEnabled } from '../privateSegmentationFlag';

const WIN = window as unknown as { __PRIVATE_SEGMENTATION__?: boolean };
const originalLocation = window.location;

/** Stub only `window.location.search` (the established flag-test pattern; see privateVadFlag.test.ts). */
function setSearch(search: string): void {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { search } as unknown as Location,
  });
}

describe('isPrivateSegmentationEnabled — Item 5 production URL-param hard gate (#891)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete WIN.__PRIVATE_SEGMENTATION__;
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  it('PRODUCTION: the public ?privateSeg=1 URL param is IGNORED — a real user cannot enable segmentation by URL', () => {
    vi.stubEnv('MODE', 'production');
    setSearch('?privateSeg=1');
    expect(isPrivateSegmentationEnabled()).toBe(false);
  });

  it('PRODUCTION: the internal window flag STILL enables it (operator diagnostic path preserved for the prod 5-min take)', () => {
    vi.stubEnv('MODE', 'production');
    WIN.__PRIVATE_SEGMENTATION__ = true;
    expect(isPrivateSegmentationEnabled()).toBe(true);
  });

  it('DEV: ?privateSeg=1 is honored (developer convenience outside public production)', () => {
    vi.stubEnv('MODE', 'development');
    setSearch('?privateSeg=1');
    expect(isPrivateSegmentationEnabled()).toBe(true);
  });

  it('TEST: ?privateSeg=1 is honored (non-production)', () => {
    vi.stubEnv('MODE', 'test');
    setSearch('?privateSeg=1');
    expect(isPrivateSegmentationEnabled()).toBe(true);
  });

  it('the internal window flag works in every non-production environment too', () => {
    for (const mode of ['development', 'test', 'preview']) {
      vi.stubEnv('MODE', mode);
      WIN.__PRIVATE_SEGMENTATION__ = true;
      expect(isPrivateSegmentationEnabled()).toBe(true);
      delete WIN.__PRIVATE_SEGMENTATION__;
      vi.unstubAllEnvs();
    }
  });

  it('default OFF: no flag + no/non-1 param → false in every environment', () => {
    for (const mode of ['production', 'development', 'test']) {
      vi.stubEnv('MODE', mode);
      setSearch('?privateSeg=0');
      expect(isPrivateSegmentationEnabled()).toBe(false);
      setSearch('');
      expect(isPrivateSegmentationEnabled()).toBe(false);
      vi.unstubAllEnvs();
    }
  });
});
