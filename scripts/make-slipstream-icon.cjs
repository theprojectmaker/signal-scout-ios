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

const UPPER = [[0.085, 0.365], [0.33, 0.42], [0.50, 0.465], [0.67, 0.42], [0.72, 0.395]];
const LOWER = [[0.085, 0.635], [0.33, 0.58], [0.50, 0.535], [0.67, 0.58], [0.72, 0.605]];

// The white stream mark (two faint draft lines + bold lead line + arrowhead). posts=true adds the dark wall.
function mark({ posts = false } = {}) {
  const half = F(0.075) / 2;
  const wall = posts ? `
    <rect x="${F(0.50) - half}" y="${F(0.11)}" width="${F(0.075)}" height="${F(0.40) - F(0.11)}" rx="${F(0.0375)}" fill="#0B1222" fill-opacity="0.92"/>
    <rect x="${F(0.50) - half}" y="${F(0.60)}" width="${F(0.075)}" height="${F(0.89) - F(0.60)}" rx="${F(0.0375)}" fill="#0B1222" fill-opacity="0.92"/>` : '';
  const upper = `<path d="${spline(UPPER)}" fill="none" stroke="#FFFFFF" stroke-opacity="0.70" stroke-width="${F(0.040)}" stroke-linecap="round"/>`;
  const lower = `<path d="${spline(LOWER)}" fill="none" stroke="#FFFFFF" stroke-opacity="0.70" stroke-width="${F(0.040)}" stroke-linecap="round"/>`;
  const lead = `<line x1="${F(0.10)}" y1="${F(0.50)}" x2="${F(0.72)}" y2="${F(0.50)}" stroke="#FFFFFF" stroke-width="${F(0.075)}" stroke-linecap="round"/>`;
  const arrow = `<polygon points="${F(0.88)},${F(0.50)} ${F(0.70)},${F(0.415)} ${F(0.70)},${F(0.585)}" fill="#FFFFFF"/>`;
  return `${wall}${upper}${lower}${lead}${arrow}`;
}

const iconSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="${S}" y2="${S}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#2456FF"/><stop offset="1" stop-color="#19D3E3"/></linearGradient></defs>
  <rect width="${S}" height="${S}" fill="url(#bg)"/>
  ${mark({ posts: true })}
</svg>`;

// mark alone on transparent, scaled about the centre (splash / adaptive / notification)
const markSVG = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <g transform="translate(${S / 2} ${S / 2}) scale(${scale}) translate(${-S / 2} ${-S / 2})">${mark({ posts: false })}</g></svg>`;

(async () => {
  const out = path.join(path.resolve(__dirname, '..'), 'assets', 'images');
  // iOS/App Store icon: full-bleed, NO alpha channel.
  await sharp(Buffer.from(iconSVG)).resize(S, S).flatten({ background: '#1E48D8' }).png().toFile(path.join(out, 'icon.png'));
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
