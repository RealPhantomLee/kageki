const fs = require('fs');
const path = require('path');

// Create SVG phantom logo
const createPhantomSVG = (size) => {
  const padding = size * 0.1;
  const innerSize = size - padding * 2;
  const centerX = size / 2;
  const centerY = size / 2;
  const radius = innerSize / 2;

  // SVG with purple circle and stylized P/phantom symbol
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="purpleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#a78bfa;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#7c3aed;stop-opacity:1" />
    </linearGradient>
  </defs>
  <!-- Background circle -->
  <circle cx="${centerX}" cy="${centerY}" r="${radius}" fill="url(#purpleGrad)"/>
  <!-- Phantom symbol: stylized P -->
  <g transform="translate(${centerX},${centerY})">
    <!-- Vertical stem -->
    <rect x="${-radius * 0.15}" y="${-radius * 0.6}" width="${radius * 0.3}" height="${radius * 1.2}" fill="white" rx="${radius * 0.05}"/>
    <!-- Upper bulge (P shape) -->
    <circle cx="${radius * 0.15}" cy="${-radius * 0.3}" r="${radius * 0.35}" fill="none" stroke="white" stroke-width="${radius * 0.08}"/>
    <!-- Horizontal line accent -->
    <line x1="${-radius * 0.5}" y1="0" x2="${radius * 0.5}" y2="0" stroke="white" stroke-width="${radius * 0.06}" opacity="0.6"/>
  </g>
</svg>`;
};

// Write SVG files and convert using a library if available
const writeSVG = (size) => {
  const svg = createPhantomSVG(size);
  const filePath = path.join(__dirname, 'public', `icon-${size}.svg`);
  fs.writeFileSync(filePath, svg);
  console.log(`Created ${filePath}`);
};

writeSVG(192);
writeSVG(512);

console.log('SVG icons generated. Now install dependencies to convert to PNG.');
