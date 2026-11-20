#!/usr/bin/env node
/* Slipstream app icon + splash art -> PNG (assets/images/).
   The mark: three white "slipstream" currents travel left -> right, pinch through one narrow gap in a dark
   central wall, then fan out behind a forward arrowhead — "slips past the firewall, streams your desktop."
   Geometry is the judged design spec (fractions of 1024). Dev tool only: borrows ../remote-control's sharp.
   Run: node scripts/make-slipstream-icon.cjs */
const fs = require('fs');
const path = require('path');
const sharp = require(path.resolve(__dirname, '..', '..', 'remote-control', 'node_modules', 'sharp'));

const S = 1024;
const F = (f) => +(f * S).toFixed(2);               // fraction of the canvas -> px

// Catmull-Rom spline through points [[fx,fy]...] -> a smooth cubic-bezier path `d`.
function spline(pts) {
  const p = pts.map(([x, y]) => ({ x: F(x), y: F(y) }));
  let d = `M${p[0].x} ${p[0].y}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[0], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p[p.length - 1];
    const c1x = +(p1.x + (p2.x - p0.x) / 6).toFixed(2), c1y = +(p1.y + (p2.y - p0.y) / 6).toFixed(2);
    const c2x = +(p2.x - (p3.x - p1.x) / 6).toFixed(2), c2y = +(p2.y - (p3.y - p1.y) / 6).toFixed(2);
    d += `C${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`;
  }
  return d;
}

// Clean remote-desktop mark: a white rounded monitor with a play glyph (the indigo showing through) and a
// stand — "stream / control your computer." `grad` true = cut the play from the gradient (for the full icon),
// false = cut it in a flat indigo (for transparent marks). Reads clearly even at home-screen size.
function mark({ grad = false } = {}) {
  const sx = F(0.17), sy = F(0.235), sw = F(0.66), sh = F(0.44), sr = F(0.075);   // screen rect
  const cut = grad ? 'url(#bg)' : '#4759E6';
  // play triangle centred in the screen
  const cxP = F(0.50), cyP = sy + sh / 2, pw = F(0.085), ph = F(0.11);
  const play = `<polygon points="${cxP - pw * 0.55},${cyP - ph} ${cxP - pw * 0.55},${cyP + ph} ${cxP + pw},${cyP}" fill="${cut}"/>`;
  const screen = `<rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="${sr}" fill="#FFFFFF"/>`;
  const neck = `<rect x="${F(0.50) - F(0.035)}" y="${sy + sh}" width="${F(0.07)}" height="${F(0.055)}" fill="#FFFFFF"/>`;
  const base = `<rect x="${F(0.335)}" y="${F(0.75)}" width="${F(0.33)}" height="${F(0.055)}" rx="${F(0.0275)}" fill="#FFFFFF"/>`;
  return `${screen}${play}${neck}${base}`;
}

const iconSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="${S}" y2="${S}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#6D7BFF"/><stop offset="1" stop-color="#3A3AE0"/></linearGradient></defs>
  <rect width="${S}" height="${S}" fill="url(#bg)"/>
  ${mark({ grad: true })}
</svg>`;

// mark alone on transparent, scaled about the centre (splash / adaptive / notification)
const markSVG = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <g transform="translate(${S / 2} ${S / 2}) scale(${scale}) translate(${-S / 2} ${-S / 2})">${mark({ posts: false })}</g></svg>`;

(async () => {
  const out = path.join(path.resolve(__dirname, '..'), 'assets', 'images');
  // iOS/App Store icon: full-bleed, NO alpha channel.
  await sharp(Buffer.from(iconSVG)).resize(S, S).flatten({ background: '#4040E0' }).png().toFile(path.join(out, 'icon.png'));
  // Splash: the mark alone on transparent (app.json paints the navy behind it).
  await sharp(Buffer.from(markSVG(0.86))).resize(S, S).png().toFile(path.join(out, 'splash-icon.png'));
  // Android adaptive foreground: mark in the safe zone on transparent.
  await sharp(Buffer.from(markSVG(0.60))).resize(S, S).png().toFile(path.join(out, 'adaptive-icon.png'));
  // Android notification: white silhouette on transparent.
  await sharp(Buffer.from(markSVG(0.92))).resize(96, 96).png().toFile(path.join(out, 'notification-icon.png'));
  // Web favicon: tiny full icon.
  await sharp(Buffer.from(iconSVG)).resize(48, 48).flatten({ background: '#1E48D8' }).png().toFile(path.join(out, 'favicon.png'));

  for (const f of ['icon.png', 'splash-icon.png', 'adaptive-icon.png', 'notification-icon.png', 'favicon.png']) {
    const m = await sharp(path.join(out, f)).metadata();
    console.log(`${f.padEnd(22)} ${m.width}x${m.height}  alpha=${m.hasAlpha}  ${fs.statSync(path.join(out, f)).size} bytes`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
