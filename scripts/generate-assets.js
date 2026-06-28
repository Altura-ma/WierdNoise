#!/usr/bin/env node
/* =========================================================
   generate-assets.js
   Generates the app icon + splash source images for
   @capacitor/assets, with no native image dependency.
   Pure Node (zlib) PNG encoder. Run: node scripts/generate-assets.js
   ========================================================= */
'use strict';

var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

// ---------- tiny PNG encoder ----------
var CRC_TABLE = (function () {
  var t = new Uint32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  var c = 0xffffffff;
  for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  var len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  var typeBuf = Buffer.from(type, 'ascii');
  var body = Buffer.concat([typeBuf, data]);
  var crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  var sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // filtered scanlines (filter type 0)
  var stride = width * 4;
  var raw = Buffer.alloc((stride + 1) * height);
  for (var y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  var idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---------- simple canvas ----------
function Canvas(w, h) {
  this.w = w; this.h = h;
  this.buf = Buffer.alloc(w * h * 4);
}
Canvas.prototype.set = function (x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
  var i = (y * this.w + x) * 4;
  if (a === undefined) a = 255;
  if (a >= 255) {
    this.buf[i] = r; this.buf[i + 1] = g; this.buf[i + 2] = b; this.buf[i + 3] = 255;
  } else {
    var af = a / 255, ia = 1 - af;
    this.buf[i]     = Math.round(r * af + this.buf[i] * ia);
    this.buf[i + 1] = Math.round(g * af + this.buf[i + 1] * ia);
    this.buf[i + 2] = Math.round(b * af + this.buf[i + 2] * ia);
    this.buf[i + 3] = 255;
  }
};
Canvas.prototype.rect = function (x0, y0, x1, y1, r, g, b, a) {
  for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) this.set(x, y, r, g, b, a);
};

// Draw the "Écoute Moteur" oscilloscope mark centered, scaled to `size`.
function drawMark(c, cx, cy, size) {
  var w = c.w, h = c.h;
  // background: vertical gradient #05080c -> #0a1620
  for (var y = 0; y < h; y++) {
    var t = y / h;
    var r = Math.round(5 + t * 5);
    var g = Math.round(8 + t * 14);
    var b = Math.round(12 + t * 22);
    c.rect(0, y, w, y + 1, r, g, b, 255);
  }

  // subtle grid
  var grid = Math.round(size * 0.12);
  for (var gx = cx - size; gx <= cx + size; gx += grid) {
    if (gx > 0 && gx < w) c.rect(gx, cy - size, gx + 1, cy + size, 20, 36, 48, 90);
  }
  for (var gy = cy - size; gy <= cy + size; gy += grid) {
    if (gy > 0 && gy < h) c.rect(cx - size, gy, cx + size, gy + 1, 20, 36, 48, 90);
  }

  // spectrum bars (cyan->green) under the waveform
  var bars = 13;
  var bw = (size * 1.7) / bars;
  var heights = [0.25, 0.45, 0.7, 0.5, 0.85, 0.6, 1.0, 0.62, 0.88, 0.5, 0.72, 0.42, 0.28];
  for (var bi = 0; bi < bars; bi++) {
    var bx = Math.round(cx - size * 0.85 + bi * bw);
    var bh = Math.round(heights[bi] * size * 0.82);
    var by = cy + Math.round(size * 0.55) - bh;
    var mix = bi / (bars - 1);
    var rr = Math.round(0 + mix * 0);
    var gg = Math.round(224 - mix * 30);
    var bb = Math.round(164 + mix * 90);
    c.rect(bx, by, Math.round(bx + bw * 0.66), cy + Math.round(size * 0.55),
      rr, gg, bb, 200);
  }

  // glowing sine waveform across the center
  var amp = size * 0.42;
  var thick = Math.max(3, Math.round(size * 0.05));
  for (var px = cx - size; px <= cx + size; px++) {
    var phase = ((px - (cx - size)) / (2 * size)) * Math.PI * 4;
    var yy = cy - Math.round(Math.sin(phase) * amp * Math.exp(-Math.pow((px - cx) / size, 2) * 0.4));
    for (var tdy = -thick; tdy <= thick; tdy++) {
      var aa = Math.round(255 * (1 - Math.abs(tdy) / (thick + 1)));
      c.set(px, yy + tdy, 0, 224, 164, aa);
    }
  }
}

function writePNG(file, canvas) {
  var png = encodePNG(canvas.w, canvas.h, canvas.buf);
  fs.writeFileSync(file, png);
  console.log('wrote', path.relative(process.cwd(), file), '(' + canvas.w + 'x' + canvas.h + ', ' +
    (png.length / 1024).toFixed(0) + ' KB)');
}

// ---------- generate ----------
var outDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// Icon: full-bleed 1024 (iOS applies its own corner mask)
var icon = new Canvas(1024, 1024);
drawMark(icon, 512, 512, 360);
writePNG(path.join(outDir, 'icon.png'), icon);
writePNG(path.join(outDir, 'icon-foreground.png'), icon); // Android adaptive (harmless extra)

// Splash 2732: dark with smaller centered mark
function makeSplash() {
  var s = new Canvas(2732, 2732);
  drawMark(s, 1366, 1366, 520);
  return s;
}
var splash = makeSplash();
writePNG(path.join(outDir, 'splash.png'), splash);
writePNG(path.join(outDir, 'splash-dark.png'), splash);

console.log('Done. Run: npx @capacitor/assets generate --ios');
