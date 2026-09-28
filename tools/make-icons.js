/* 生成主屏图标（PNG，无依赖：自写 PNG 编码器）。
 * 图形：墨底 + 金色 ¥ 记号。不用渐变、不用霓虹。
 * 用法：node tools/make-icons.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'icons');
const BG = [26, 25, 24, 255];        // #1A1918 墨
const MARK = [201, 154, 90, 255];    // #C79A5A 金

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function writePng(file, width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;      // bit depth
  ihdr[9] = 6;      // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;   // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(file, png);
  return png.length;
}

/** 点到线段的距离（用来画粗线） */
function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

const STROKES = [
  // ¥ 的两撇
  [0.36, 0.28, 0.50, 0.47],
  [0.64, 0.28, 0.50, 0.47],
  // 竖
  [0.50, 0.47, 0.50, 0.745],
  // 两横
  [0.375, 0.535, 0.625, 0.535],
  [0.375, 0.625, 0.625, 0.625]
];

function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const strokeWidth = size * 0.058;
  const supersample = 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < supersample; sy++) {
        for (let sx = 0; sx < supersample; sx++) {
          const px = (x + (sx + 0.5) / supersample) / size;
          const py = (y + (sy + 0.5) / supersample) / size;
          let onMark = false;
          for (const [x1, y1, x2, y2] of STROKES) {
            if (distanceToSegment(px, py, x1, y1, x2, y2) * size <= strokeWidth / 2) { onMark = true; break; }
          }
          if (onMark) hits++;
        }
      }
      const total = supersample * supersample;
      const ratio = hits / total;
      const index = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) rgba[index + c] = Math.round(BG[c] * (1 - ratio) + MARK[c] * ratio);
      rgba[index + 3] = 255;
    }
  }
  return rgba;
}

fs.mkdirSync(OUT, { recursive: true });
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  const bytes = writePng(path.join(OUT, name), size, size, render(size));
  console.log(`✓ icons/${name}  ${size}×${size}  ${(bytes / 1024).toFixed(1)} KB`);
}
