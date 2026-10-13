export const IMAGE_LIMIT = 10 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const IMAGE_RULE = '僅支援完整 JPEG／PNG／WebP／GIF 圖片，每檔最多 10 MiB；SVG／HEIC 請先轉檔';

// shortcut: 驗證實際容器但不解碼像素；若需伺服器像素校驗，再接完整 codec。
export function imageType(bytes: Uint8Array): string | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number, size: number) => String.fromCharCode(...bytes.subarray(at, at + size));
  try {
    if (text(0, 8) === '\x89PNG\r\n\x1a\n') {
      let at = 8; let header = false; let pixels = false;
      while (at + 12 <= bytes.length) {
        const size = view.getUint32(at); const end = at + 12 + size; const type = text(at + 4, 4);
        if (end > bytes.length) return null;
        let crc = 0xffffffff;
        for (let i = at + 4; i < end - 4; i++) {
          crc ^= bytes[i]; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        }
        if (((crc ^ 0xffffffff) >>> 0) !== view.getUint32(end - 4)) return null;
        if (!header && (type !== 'IHDR' || size !== 13)) return null;
        if (type === 'IHDR') {
          if (header || !view.getUint32(at + 8) || !view.getUint32(at + 12)) return null;
          const depths: Record<number, number[]> = { 0: [1,2,4,8,16], 2: [8,16], 3: [1,2,4,8], 4: [8,16], 6: [8,16] };
          if (!depths[bytes[at + 17]]?.includes(bytes[at + 16]) || bytes[at + 18] || bytes[at + 19] || bytes[at + 20] > 1) return null;
          header = true;
        }
        if (type === 'IDAT' && size > 0) pixels = true;
        if (type === 'IEND') return header && pixels && size === 0 && end === bytes.length ? 'image/png' : null;
        at = end;
      }
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      let at = 2; let frame = false; let scan = false;
      while (at < bytes.length) {
        if (bytes[at++] !== 0xff) return null;
        while (bytes[at] === 0xff) at++;
        const marker = bytes[at++];
        if (marker === 0xd9) return frame && scan && at === bytes.length ? 'image/jpeg' : null;
        const size = view.getUint16(at); if (size < 2 || at + size > bytes.length) return null;
        if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
          if (size < 8 || !view.getUint16(at + 3) || !view.getUint16(at + 5)) return null;
          frame = true;
        }
        at += size;
        if (marker === 0xda) {
          if (!frame || size < 6) return null;
          const start = at;
          while (at < bytes.length) {
            if (bytes[at] === 0xff) {
              const next = bytes[at + 1];
              if (next === 0 || (next >= 0xd0 && next <= 0xd7)) { at += 2; continue; }
              if (next === 0xff) { at++; continue; }
              break;
            }
            at++;
          }
          if (at === start) return null;
          scan = true;
        }
      }
    }
    if (['GIF87a', 'GIF89a'].includes(text(0, 6))) {
      if (bytes.length < 14 || !view.getUint16(6, true) || !view.getUint16(8, true)) return null;
      let at = 13 + ((bytes[10] & 0x80) ? 3 * (2 << (bytes[10] & 7)) : 0); let pixels = false;
      const subblocks = () => {
        let total = 0;
        while (at < bytes.length) { const size = bytes[at++]; if (!size) return total; at += size; total += size; }
        throw new Error('圖片截斷');
      };
      while (at < bytes.length) {
        const marker = bytes[at++];
        if (marker === 0x3b) return pixels && at === bytes.length ? 'image/gif' : null;
        if (marker === 0x21) { at++; subblocks(); }
        else if (marker === 0x2c) {
          if (!view.getUint16(at + 4, true) || !view.getUint16(at + 6, true)) return null;
          const flags = bytes[at + 8]; at += 9 + ((flags & 0x80) ? 3 * (2 << (flags & 7)) : 0);
          const bits = bytes[at++]; if (bits < 2 || bits > 8 || subblocks() < 2) return null;
          pixels = true;
        } else return null;
      }
    }
    if (text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP' && view.getUint32(4, true) + 8 === bytes.length) {
      let pixels = false; let at = 12;
      while (at + 8 <= bytes.length) {
        const type = text(at, 4); const size = view.getUint32(at + 4, true); const start = at + 8;
        at = start + size + (size % 2); if (at > bytes.length) return null;
        if (type === 'VP8 ') {
          if (size < 11 || text(start + 3, 3) !== '\x9d\x01\x2a' || !(view.getUint16(start + 6, true) & 0x3fff) || !(view.getUint16(start + 8, true) & 0x3fff)) return null;
          pixels = true;
        }
        if (type === 'VP8L') { if (size < 6 || bytes[start] !== 0x2f || (bytes[start + 4] >> 5)) return null; pixels = true; }
        if (type === 'ANMF') {
          if (size < 24) return null;
          for (let chunk = start + 16; chunk < start + size;) {
            if (!['ALPH', 'VP8 ', 'VP8L'].includes(text(chunk, 4)) || chunk + 8 > start + size) return null;
            const length = view.getUint32(chunk + 4, true); chunk += 8 + length + (length % 2);
            if (chunk > start + size) return null;
          }
          const frame = new Uint8Array(size - 16 + 12); frame.set([82,73,70,70,0,0,0,0,87,69,66,80]);
          new DataView(frame.buffer).setUint32(4, frame.length - 8, true); frame.set(bytes.subarray(start + 16, start + size), 12);
          if (imageType(frame) !== 'image/webp') return null; pixels = true;
        }
      }
      if (pixels && at === bytes.length) return 'image/webp';
    }
  } catch { return null; }
  return null;
}
