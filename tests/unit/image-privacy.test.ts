import { expect, it } from 'vitest';
import { imageType } from '../../src/shared/image';
import { privateImage } from '../../src/shared/image-privacy';
import { images } from '../fixtures/images';
import { animatedImages } from '../fixtures/animated-images';
it('ASSET-03：JPEG 接受附加資料，上傳移除 EXIF／GPS 與尾端而保留壓縮像素', () => {
  const exif = new TextEncoder().encode('Exif\0\0GPS-location');
  const input = new Uint8Array(images.jpeg.length + exif.length + 4 + 5);
  input.set(images.jpeg.subarray(0, 2)); input.set([255, 225, 0, exif.length + 2], 2); input.set(exif, 6); input.set(images.jpeg.subarray(2), 6 + exif.length); input.set([1,2,3,4,5], input.length - 5);
  expect(imageType(input)).toBe('image/jpeg');
  expect(privateImage(input, 'image/jpeg')).toEqual(images.jpeg);
});
it('ASSET-03：既有各格式與動畫保留容器及像素', () => {
  for (const [mime, bytes] of [['image/png', images.png], ['image/jpeg', images.jpeg], ['image/webp', images.webp], ['image/gif', images.gif], ['image/webp', animatedImages.webp], ['image/gif', animatedImages.gif]] as const) {
    expect(privateImage(bytes, mime)).toEqual(bytes); expect(imageType(privateImage(bytes, mime))).toBe(mime);
  }
});

it('ASSET-03：PNG／WebP 移除 EXIF、XMP，容器仍可解析', () => {
  const metadata = new TextEncoder().encode('GPS-location');
  const pngChunk = new Uint8Array(12 + metadata.length);
  const pngView = new DataView(pngChunk.buffer);
  pngView.setUint32(0, metadata.length); pngChunk.set(new TextEncoder().encode('eXIf'), 4); pngChunk.set(metadata, 8);
  let crc = 0xffffffff;
  for (const byte of pngChunk.subarray(4, -4)) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  pngView.setUint32(pngChunk.length - 4, (crc ^ 0xffffffff) >>> 0);
  const png = new Uint8Array(images.png.length + pngChunk.length);
  png.set(images.png.subarray(0, -12)); png.set(pngChunk, images.png.length - 12); png.set(images.png.subarray(-12), png.length - 12);
  expect(imageType(png)).toBe('image/png'); expect(privateImage(png, 'image/png')).toEqual(images.png);
  const chunk = new Uint8Array(8 + metadata.length);
  chunk.set(new TextEncoder().encode('EXIF')); new DataView(chunk.buffer).setUint32(4, metadata.length, true); chunk.set(metadata, 8);
  const webp = new Uint8Array(images.webp.length + chunk.length);
  webp.set(images.webp); webp.set(chunk, images.webp.length); new DataView(webp.buffer).setUint32(4, webp.length - 8, true);
  expect(imageType(webp)).toBe('image/webp'); expect(privateImage(webp, 'image/webp')).toEqual(images.webp);
});

it('ASSET-03：只保留安全顯示方向，GPS 與其他 EXIF 不會留下', () => {
  const tiff = new Uint8Array([73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);
  const secret = new TextEncoder().encode('GPS-location');
  const segment = new Uint8Array(10 + tiff.length + secret.length);
  segment.set([255,225,0,segment.length - 2,69,120,105,102,0,0]); segment.set(tiff, 10); segment.set(secret, 10 + tiff.length);
  const input = new Uint8Array(images.jpeg.length + segment.length);
  input.set(images.jpeg.subarray(0, 2)); input.set(segment, 2); input.set(images.jpeg.subarray(2), 2 + segment.length);
  const output = privateImage(input, 'image/jpeg');
  expect(imageType(output)).toBe('image/jpeg');
  expect(output.subarray(12, 12 + tiff.length)).toEqual(tiff);
  expect(new TextDecoder().decode(output)).not.toContain('GPS-location');
  expect(output.subarray(12 + tiff.length)).toEqual(images.jpeg.subarray(2));
});
