/* Turn a photo URI into an executorch ImageBuffer (raw RGB pixels, HWC).
   The AI library gives no photo loader, so we downscale the photo to a small
   PNG and decode it to pixels in JS. Kept small (max 384px) so JS decode is
   fast. Everything is wrapped by the caller; on any failure we throw and the
   chat falls back to text-only. */

function b64ToBytes(b64) {
  const bin = global.atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function toSmallPngBase64(uri) {
  const IM = require('expo-image-manipulator');
  const fmt = (IM.SaveFormat && IM.SaveFormat.PNG) || 'png';
  // New (SDK 52+) context API first, then legacy manipulateAsync.
  try {
    if (IM.ImageManipulator && IM.ImageManipulator.manipulate) {
      const ctx = IM.ImageManipulator.manipulate(uri);
      ctx.resize({ width: 384 });
      const rendered = await ctx.renderAsync();
      const saved = await rendered.saveAsync({ format: fmt, base64: true });
      return saved.base64;
    }
  } catch (e) { /* fall through to legacy */ }
  const res = await IM.manipulateAsync(uri, [{ resize: { width: 384 } }], { format: fmt, base64: true });
  return res.base64;
}

export async function uriToImageBuffer(uri) {
  const b64 = await toSmallPngBase64(uri);
  if (!b64) throw new Error('no image data');
  const bytes = b64ToBytes(b64);
  const UPNG = require('upng-js');
  const img = UPNG.decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const frames = UPNG.toRGBA8(img);
  const rgba = new Uint8Array(frames[0]);
  const w = img.width, h = img.height;
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0, k = 0, j = 0; i < w * h; i++) {
    rgb[j++] = rgba[k++]; rgb[j++] = rgba[k++]; rgb[j++] = rgba[k++]; k++; // drop alpha
  }
  return { data: rgb, width: w, height: h, format: 'rgb', layout: 'hwc' };
}
