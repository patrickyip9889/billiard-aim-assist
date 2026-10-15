import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function crc32(buf) {
  if (!crc32.table) {
    crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc32.table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crc32.table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePNG(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
  );
}

function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

function sdSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const t = Math.max(
    0,
    Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby))
  );
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

function drawIcon(S) {
  const rgba = Buffer.alloc(S * S * 4);
  const bg = [16, 21, 28];
  const green = [19, 101, 52];
  const amber = [255, 213, 74];
  const white = [242, 242, 234];
  const red = [210, 50, 44];
  const u = S / 512;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let col = bg;
      let alpha = 1;
      const dOuter = sdRoundRect(x, y, 256 * u, 256 * u, 256 * u, 256 * u, 96 * u);
      if (dOuter > 0.5 * u) {
        alpha = 0;
      } else {
        const dInner = sdRoundRect(x, y, 256 * u, 256 * u, 200 * u, 200 * u, 48 * u);
        if (dInner < 0) {
          col = green;
          const dBall = sdCircle(x, y, 160 * u, 330 * u, 66 * u);
          const dTarget = sdCircle(x, y, 404 * u, 122 * u, 52 * u);
          const dLine = sdSegment(x, y, 160 * u, 330 * u, 330 * u, 180 * u);
          if (dLine < 11 * u && dBall >= 0 && dTarget >= 0) col = amber;
          if (Math.abs(sdCircle(x, y, 330 * u, 180 * u, 66 * u)) < 7 * u) col = amber;
          if (dBall < 0) {
            col = sdCircle(x, y, 136 * u, 308 * u, 20 * u) < 0 ? [255, 255, 255] : white;
          }
          if (dTarget < 0) {
            col =
              sdCircle(x, y, 386 * u, 106 * u, 15 * u) < 0
                ? [235, 130, 127]
                : red;
          }
        }
      }
      const i = (y * S + x) * 4;
      rgba[i] = col[0];
      rgba[i + 1] = col[1];
      rgba[i + 2] = col[2];
      rgba[i + 3] = Math.round(alpha * 255);
    }
  }
  return encodePNG(S, S, rgba);
}

mkdirSync(join(root, 'icons'), { recursive: true });
writeFileSync(join(root, 'icons', 'icon-512.png'), drawIcon(512));
writeFileSync(join(root, 'icons', 'icon-192.png'), drawIcon(192));
writeFileSync(join(root, 'icons', 'apple-touch-icon.png'), drawIcon(180));
console.log('icons written: icon-512.png, icon-192.png, apple-touch-icon.png');
