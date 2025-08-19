// __mocks__/sharp.js
export default function sharp() {
  return {
    resize: () => sharp(),
    toBuffer: async () => Buffer.from([]),
    toFile: async () => ({}),
    jpeg: () => sharp(),
    png: () => sharp(),
    webp: () => sharp(),
  };
}
