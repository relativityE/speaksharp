// src/test/mocks/transformers.js
export const pipeline = vi.fn().mockImplementation(() => {
  return Promise.resolve({
    // Mock transcription result
    text: 'Mock transcription result'
  });
});

export default {
  pipeline
};
