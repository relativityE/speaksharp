export async function createMicStream(options = {}) {
  // Dynamic import the actual implementation only when called
  const { createMicStreamImpl } = await import('./audioUtils.impl.js');
  return createMicStreamImpl(options);
}
