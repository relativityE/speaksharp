// This is a mock file to prevent the actual @xenova/transformers library from loading.
// It must be a plain JavaScript module with no dependencies on Vitest (like `vi`).

const pipeline = async (task, model) => {
  console.log(`[Mock] Pipeline called for task: ${task}, model: ${model}`);
  // Return a function that simulates the behavior of a real pipeline
  return () => {
    return Promise.resolve({
      text: "Mocked transcription result.",
    });
  };
};

// Use CJS exports for maximum compatibility with Node/Vite config
module.exports = {
  pipeline,
};
