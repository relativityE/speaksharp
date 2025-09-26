import { createCanvas, loadImage } from 'canvas';

/**
 * Resizes an image buffer and returns a PNG buffer using the canvas API.
 * This mimics the sharp-style API for easy swapping.
 */
export async function processImage(
  imageBuffer: Buffer,
  width: number,
  height: number
): Promise<Buffer> {
  const image = await loadImage(imageBuffer);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, width, height);
  return canvas.toBuffer('image/png');
}