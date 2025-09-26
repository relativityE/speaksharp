import { loadImage, createCanvas } from './canvas';

/**
 * Resizes an image buffer and returns a PNG buffer using the node-canvas API.
 * This is a more stable replacement for Jimp in test environments.
 */
export async function processImage(
  imageBuffer: Buffer,
  width: number,
  height: number
): Promise<Buffer> {
  // Load the image from the buffer
  const image = await loadImage(imageBuffer);

  // Create a new canvas with the target dimensions
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Draw the loaded image onto the canvas, resizing it in the process
  ctx.drawImage(image, 0, 0, width, height);

  // Return the result as a PNG buffer
  return canvas.toBuffer('image/png');
}