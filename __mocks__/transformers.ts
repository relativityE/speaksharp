import { vi } from 'vitest';

export const pipeline = vi.fn().mockResolvedValue(vi.fn().mockResolvedValue({ text: 'mocked transcript' }));
