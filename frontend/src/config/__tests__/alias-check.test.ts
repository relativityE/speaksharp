import { describe, it, expect } from 'vitest';
import { ENV } from '@/config/TestFlags';

describe('Vitest Alias Resolution (Industrial Fix)', () => {
  it('should correctly resolve the @/ alias to the project source', () => {
    // If the resolver is working, ENV will be defined and have our bridge properties.
    expect(ENV).toBeDefined();
    expect(ENV.isTest).toBe(true);
    console.info('✅ Alias resolution verified: @/config/TestFlags ->', typeof ENV);
  });
});
