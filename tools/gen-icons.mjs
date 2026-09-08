// 生成扩展图标。手写 PNG 编码器（Node 内置 zlib），避免引入任何依赖。
// 用法：node tools/gen-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'icons');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter: none
    rgba.copy(raw, rowStart + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const lerp = (a, b, t) => a + (b - a) * t;

// 以 SS 倍超采样绘制再降采样，得到边缘抗锯齿。
function drawIcon(size) {
  const SS = size <= 32 ? 6 : size <= 48 ? 4 : 3;
  const S = size * SS;
  const buf = Buffer.alloc(S * S * 4);
  const c = S / 2;
  const radius = S * 0.22;
  const armLen = S * 0.3;
  const armThick = Math.max(1, S * 0.055);
  const ringR = S * 0.2;
  const ringThick = Math.max(1.2, S * 0.05);
  const dotR = S * 0.055;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = x + 0.5 - c;
      const py = y + 0.5 - c;

      // 圆角矩形 signed distance
      const dx = Math.abs(px) - (c - radius);
      const dy = Math.abs(py) - (c - radius);
      const sd = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
      if (sd > 0) continue; // 保持 alpha 0

      const t = y / S;
      let r = lerp(0x4f, 0x7b, t);
      let g = lerp(0x7c, 0x4f, t);
      let b = 0xff;

      const dist = Math.hypot(px, py);
      const gap = ringR * 0.55;
      const onHArm =
        Math.abs(py) <= armThick / 2 && Math.abs(px) <= armLen && Math.abs(px) >= gap;
      const onVArm =
        Math.abs(px) <= armThick / 2 && Math.abs(py) <= armLen && Math.abs(py) >= gap;
      const onRing = Math.abs(dist - ringR) <= ringThick / 2;
      const onDot = dist <= dotR;

      if (onHArm || onVArm || onRing || onDot) {
        r = 255;
        g = 255;
        b = 255;
      }

      const i = (y * S + x) * 4;
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = 255;
    }
  }

  const out = Buffer.alloc(size * size * 4);
  const n = SS * SS;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const j = ((y * SS + sy) * S + (x * SS + sx)) * 4;
          r += buf[j];
          g += buf[j + 1];
          b += buf[j + 2];
          a += buf[j + 3];
        }
      }
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return encodePng(size, size, out);
}

mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const file = join(outDir, `icon${size}.png`);
  writeFileSync(file, drawIcon(size));
  console.log(`wrote ${file}`);
}
