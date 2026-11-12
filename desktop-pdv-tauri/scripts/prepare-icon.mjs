import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

// Temporary original icon for the prototype; official branding must be approved.
const size = 32;
const pixels = Buffer.alloc(size * size * 4);
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const i = (y * size + x) * 4;
  const border = x < 2 || y < 2 || x >= size - 2 || y >= size - 2;
  pixels[i] = border ? 22 : 18;
  pixels[i + 1] = border ? 46 : 112;
  pixels[i + 2] = border ? 69 : 154;
  pixels[i + 3] = 255;
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(name, data) {
  const n = Buffer.from(name);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc(Buffer.concat([n, data])));
  return Buffer.concat([len, n, data, checksum]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8; ihdr[9] = 6;
const scanlines = Buffer.concat(Array.from({ length: size }, (_, y) =>
  Buffer.concat([Buffer.from([0]), pixels.subarray(y * size * 4, (y + 1) * size * 4)])
));
const png = Buffer.concat([
  Buffer.from([137,80,78,71,13,10,26,10]),
  chunk('IHDR', ihdr), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))
]);
const folder = resolve('src-tauri/icons');
await mkdir(folder, { recursive: true });
await writeFile(resolve(folder, 'icon.png'), png);
const icoHeader = Buffer.from([0, 0, 1, 0, 1, 0, 32, 32, 0, 0, 1, 0, 32, 0]);
const sizeBytes = Buffer.alloc(4); sizeBytes.writeUInt32LE(png.length);
const offsetBytes = Buffer.alloc(4); offsetBytes.writeUInt32LE(22);
await writeFile(resolve(folder, 'icon.ico'), Buffer.concat([icoHeader, sizeBytes, offsetBytes, png]));
console.log('Generated prototype icon:', png.length, 'bytes');
