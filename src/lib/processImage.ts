// Patched by Jules to fix type error
import { Jimp } from 'jimp';

/**
 * Resizes an image buffer and returns a PNG buffer.
 * This mimics the sharp-style API for easy swapping.
 */
export async function processImage(
  imageBuffer: Buffer,
  width: number,
  height: number
): Promise<Buffer> {
  const image = await Jimp.read(imageBuffer);
  const resized = await image.resize({ w: width, h: height }).getBuffer(Jimp.MIME_PNG);
  return resized;
}
