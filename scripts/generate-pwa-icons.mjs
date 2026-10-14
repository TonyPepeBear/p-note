// 無外部相依的 PNG 圖示產生器；筆記本圖形完整落在遮罩安全區。
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';

function chunk(type, data) {
  const payload = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length); payload.copy(result, 4);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}

await mkdir('public/icons', { recursive: true });
for (const [name, size] of [['icon-192', 192], ['icon-512', 512], ['maskable-512', 512], ['apple-touch-icon', 180]]) {
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x / size, py = y / size;
    let color = [233, 233, 231];
    if (px >= .30 && px <= .70 && py >= .25 && py <= .75) color = [255, 255, 255];
    if (px >= .35 && px <= .37 && py >= .25 && py <= .75) color = [111, 110, 105];
    if (px >= .43 && px <= .63 && ((py >= .39 && py <= .415) || (py >= .49 && py <= .515) || (py >= .59 && py <= .615))) color = [55, 53, 47];
    const offset = y * (1 + size * 3) + 1 + x * 3;
    raw.set(color, offset);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  await writeFile(`public/icons/${name}.png`, Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
