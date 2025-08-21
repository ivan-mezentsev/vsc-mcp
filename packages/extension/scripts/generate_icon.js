// Generates a 128x128 PNG icon with text "VSC" and "MCP" stacked, using an SVG rendered via sharp.
// Usage: node scripts/generate_icon.js
// Output: packages/extension/icon.png

/* eslint-disable no-console */
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

async function main() {
  const size = 128;
  const outputPath = path.resolve(__dirname, '..', 'icon.png');

  // Colors and styles
  const bgColor = '#4b6bfb'; // calm blue
  const textColor = '#ffffff';
  const corner = 20;
  const fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica, Arial, sans-serif';

  // Centered layout for two lines of text
  const center = size / 2;
  const fontSize = 30; // px
  const lineGap = 6; // px visual gap between lines
  const halfLine = (fontSize + lineGap) / 2;
  const yTop = Math.round(center - halfLine);
  const yBottom = Math.round(center + halfLine);

  // SVG with rounded rect background and centered stacked text
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity="0.18"/>
    </filter>
  </defs>
  <g filter="url(#shadow)">
    <rect x="4" y="4" width="${size - 8}" height="${size - 8}" rx="${corner}" ry="${corner}" fill="${bgColor}"/>
  </g>
  <g fill="${textColor}" font-family="${fontFamily}" text-anchor="middle" dominant-baseline="middle">
    <text x="${center}" y="${yTop}" font-size="${fontSize}" font-weight="700" letter-spacing="1">VSC</text>
    <text x="${center}" y="${yBottom}" font-size="${fontSize}" font-weight="700" letter-spacing="1">MCP</text>
  </g>
</svg>`;

  try {
    const buffer = Buffer.from(svg);
    const png = await sharp(buffer)
      .resize(size, size)
      .png({ compressionLevel: 9 })
      .toBuffer();

    fs.writeFileSync(outputPath, png);
    console.log(`Icon generated: ${outputPath}`);
  } catch (err) {
    console.error('Failed to generate icon:', err);
    process.exitCode = 1;
  }
}

main();
