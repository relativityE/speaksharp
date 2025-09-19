// This is a mock file to prevent the actual @xenova/transformers library from loading.
// It must be a plain TypeScript module with no dependencies on Vitest (like `vi`).

type PipelineResult = {
  text: string;
};

type PipelineFunction = () => Promise<PipelineResult>;

export const pipeline = async (task: string, model: string): Promise<PipelineFunction> => {
  console.log(`[Mock] Pipeline called for task: ${task}, model: ${model}`);
  // Return a function that simulates the behavior of a real pipeline
  return () => {
    return Promise.resolve({
      text: "Mocked transcription result.",
    });
  };
};
