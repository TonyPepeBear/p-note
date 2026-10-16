// 白名單只保留顯示方向，避免去除 GPS 時讓手機直拍照片旋轉；其他 EXIF 一律不複製。
function orientation(data: Uint8Array): Uint8Array | undefined {
  try {
    if (String.fromCharCode(...data.subarray(0, 6)) === 'Exif\0\0') data = data.subarray(6);
    const little = data[0] === 0x49 && data[1] === 0x49;
    if (!little && !(data[0] === 0x4d && data[1] === 0x4d)) return;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (view.getUint16(2, little) !== 42) return;
    const start = view.getUint32(4, little), count = view.getUint16(start, little);
    for (let i = 0; i < count; i++) {
      const at = start + 2 + i * 12;
      if (view.getUint16(at, little) !== 0x112 || view.getUint16(at + 2, little) !== 3 || view.getUint32(at + 4, little) !== 1) continue;
      const value = view.getUint16(at + 8, little);
      if (value < 2 || value > 8) return;
      const result = new Uint8Array([73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,value,0,0,0,0,0,0,0]);
      return result;
    }
  } catch { /* 損毀的 metadata 直接移除，不影響已驗證的像素。 */ }
}
function pngExif(data: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length + 12), view = new DataView(result.buffer);
  view.setUint32(0, data.length); result.set([101,88,73,102], 4); result.set(data, 8);
  let crc = 0xffffffff;
  for (const byte of result.subarray(4, -4)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  view.setUint32(result.length - 4, (crc ^ 0xffffffff) >>> 0);
  return result;
}

// 保留壓縮影像及動畫資料，只移除可能帶有 EXIF／GPS 的 metadata。
export function privateImage(bytes: Uint8Array, mime: string): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number, size: number) => String.fromCharCode(...bytes.subarray(at, at + size));
  const chunks: Uint8Array[] = [];
  if (mime === 'image/jpeg') {
    chunks.push(bytes.subarray(0, 2));
    let at = 2;
    while (at < bytes.length) {
      const start = at;
      while (bytes[at] === 0xff) at++;
      const marker = bytes[at++];
      if (marker === 0xd9) { chunks.push(bytes.subarray(start, at)); break; }
      const size = view.getUint16(at);
      if (marker === 0xe1) {
        const safe = orientation(bytes.subarray(at + 2, at + size));
        if (safe) {
          const chunk = new Uint8Array(safe.length + 10);
          chunk.set([255,225,0,safe.length + 8,69,120,105,102,0,0]); chunk.set(safe, 10); chunks.push(chunk);
        }
      }
      at += size;
      if (marker === 0xda) {
        while (at < bytes.length) {
          if (bytes[at] !== 0xff) { at++; continue; }
          const next = bytes[at + 1];
          if (next === 0 || (next >= 0xd0 && next <= 0xd7)) { at += 2; continue; }
          if (next === 0xff) { at++; continue; }
          break;
        }
      }
      if (marker !== 0xe1 && marker !== 0xed && marker !== 0xfe) chunks.push(bytes.subarray(start, at));
    }
  } else if (mime === 'image/png') {
    chunks.push(bytes.subarray(0, 8));
    for (let at = 8; at < bytes.length;) {
      const end = at + 12 + view.getUint32(at);
      const type = text(at + 4, 4);
      if (type === 'eXIf') { const safe = orientation(bytes.subarray(at + 8, end - 4)); if (safe) chunks.push(pngExif(safe)); }
      else if (!['iTXt', 'tEXt', 'zTXt'].includes(type)) chunks.push(bytes.subarray(at, end));
      at = end;
    }
  } else if (mime === 'image/webp') {
    chunks.push(bytes.slice(0, 12));
    let safe: Uint8Array | undefined;
    for (let at = 12; at < bytes.length;) {
      const size = view.getUint32(at + 4, true);
      if (text(at, 4) === 'EXIF') safe ??= orientation(bytes.subarray(at + 8, at + 8 + size));
      at += 8 + size + size % 2;
    }
    for (let at = 12; at < bytes.length;) {
      const type = text(at, 4), size = view.getUint32(at + 4, true), end = at + 8 + size + size % 2;
      if (!['EXIF', 'XMP '].includes(type)) {
        const chunk = bytes.slice(at, end);
        if (type === 'VP8X') chunk[8] = (chunk[8] & ~(0x08 | 0x04)) | (safe ? 0x08 : 0);
        chunks.push(chunk);
      }
      at = end;
    }
    if (safe) {
      const chunk = new Uint8Array(8 + safe.length);
      chunk.set([69,88,73,70]); new DataView(chunk.buffer).setUint32(4, safe.length, true); chunk.set(safe, 8); chunks.push(chunk);
    }
  } else return bytes;
  const result = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) { result.set(chunk, at); at += chunk.length; }
  if (mime === 'image/webp') new DataView(result.buffer).setUint32(4, result.length - 8, true);
  return result;
}
