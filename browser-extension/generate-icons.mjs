// Eidos Memory — Icon Generator
// Run: node generate-icons.mjs
// Creates PNG icons for the Chrome extension.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { deflateSync } from 'zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Minimal PNG encoder (no dependencies)
function createPNG(width, height, pixels) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type (RGBA)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // IDAT chunk — raw pixel data with zlib
  const rawData = [];
  for (let y = 0; y < height; y++) {
    rawData.push(0); // filter byte (none)
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      rawData.push(pixels[idx], pixels[idx + 1], pixels[idx + 2], pixels[idx + 3]);
    }
  }

  const compressed = deflateSync(Buffer.from(rawData));

  // Build chunks
  function chunk(type, data) {
    const typeBuf = Buffer.from(type);
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const combined = Buffer.concat([typeBuf, data]);
    const crc = crc32(combined);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc >>> 0, 0);
    return Buffer.concat([lenBuf, combined, crcBuf]);
  }

  const idatChunk = chunk('IDAT', compressed);
  const iendChunk = chunk('IEND', Buffer.alloc(0));

  const ihdrChunk = chunk('IHDR', ihdr);

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// CRC32 implementation
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Draw a gradient circle icon
function drawIcon(size) {
  const pixels = new Uint8Array(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= r) {
        // Gradient from #667eea to #764ba2
        const t = (x + y) / (size * 2);
        const r1 = Math.round(102 + (118 - 102) * t);
        const g1 = Math.round(126 + (75 - 126) * t);
        const b1 = Math.round(234 + (162 - 234) * t);
        const a = dist <= r - 1 ? 255 : Math.round((r - dist) * 255); // anti-alias edge

        pixels[idx] = r1;
        pixels[idx + 1] = g1;
        pixels[idx + 2] = b1;
        pixels[idx + 3] = a;
      } else {
        pixels[idx] = 0;
        pixels[idx + 1] = 0;
        pixels[idx + 2] = 0;
        pixels[idx + 3] = 0;
      }
    }
  }

  // Draw inner circle (brain)
  const innerR = size * 0.3;
  const lineW = Math.max(1, size / 16);

  // Neural connection dots
  const dotR = Math.max(1.5, size / 20);
  for (let i = 0; i < 3; i++) {
    const angle = (i * Math.PI * 2) / 3 - Math.PI / 2;
    const dotX = Math.round(cx + innerR * Math.cos(angle));
    const dotY = Math.round(cy + innerR * Math.sin(angle));

    for (let dy = -Math.ceil(dotR); dy <= Math.ceil(dotR); dy++) {
      for (let dx = -Math.ceil(dotR); dx <= Math.ceil(dotR); dx++) {
        const px = dotX + dx;
        const py = dotY + dy;
        if (px >= 0 && px < size && py >= 0 && py < size) {
          if (dx * dx + dy * dy <= dotR * dotR) {
            const idx = (py * size + px) * 4;
            pixels[idx] = 255;
            pixels[idx + 1] = 255;
            pixels[idx + 2] = 255;
            pixels[idx + 3] = 255;
          }
        }
      }
    }
  }

  // Center dot
  const centerR = Math.max(1.5, size / 16);
  for (let dy = -Math.ceil(centerR); dy <= Math.ceil(centerR); dy++) {
    for (let dx = -Math.ceil(centerR); dx <= Math.ceil(centerR); dx++) {
      const px = Math.round(cx) + dx;
      const py = Math.round(cy) + dy;
      if (px >= 0 && px < size && py >= 0 && py < size) {
        if (dx * dx + dy * dy <= centerR * centerR) {
          const idx = (py * size + px) * 4;
          pixels[idx] = 255;
          pixels[idx + 1] = 255;
          pixels[idx + 2] = 255;
          pixels[idx + 3] = 255;
        }
      }
    }
  }

  // Inner ring
  for (let angle = 0; angle < Math.PI * 2; angle += 0.01) {
    const rx = Math.round(cx + innerR * Math.cos(angle));
    const ry = Math.round(cy + innerR * Math.sin(angle));
    for (let lw = -Math.ceil(lineW / 2); lw <= Math.ceil(lineW / 2); lw++) {
      const px = rx;
      const py = ry + lw;
      if (px >= 0 && px < size && py >= 0 && py < size) {
        const idx = (py * size + px) * 4;
        pixels[idx] = 255;
        pixels[idx + 1] = 255;
        pixels[idx + 2] = 255;
        pixels[idx + 3] = Math.round(230 * (1 - Math.abs(lw) / (lineW / 2)));
      }
    }
  }

  return pixels;
}

async function main() {
  const iconsDir = path.join(__dirname, 'icons');
  fs.mkdirSync(iconsDir, { recursive: true });

  for (const size of [16, 32, 48, 128]) {
    const pixels = drawIcon(size);
    const png = await createPNG(size, size, pixels);
    const outPath = path.join(iconsDir, `icon${size}.png`);
    fs.writeFileSync(outPath, png);
    console.log(`Created ${outPath} (${png.length} bytes)`);
  }

  console.log('\nDone! Icons created in browser-extension/icons/');
}

main().catch(console.error);
