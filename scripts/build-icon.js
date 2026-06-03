// Build the app icon by diagonally splitting the WhatsApp and Claude
// system icons. Run with: node scripts/build-icon.js
// Outputs build/icon.png (1024x1024).

const sharp = require('sharp');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SIZE = 1024;
const OUT_DIR = path.resolve(__dirname, '..', 'build');
const OUT_PNG = path.join(OUT_DIR, 'icon.png');

const WA_ICNS = '/Applications/WhatsApp.app/Contents/Resources/AppIcon.icns';
const CLAUDE_ICNS = '/Applications/Claude.app/Contents/Resources/electron.icns';
const TMP_WA = '/tmp/wa-source.png';
const TMP_CLAUDE = '/tmp/claude-source.png';

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Extract PNGs from each .icns via macOS sips.
  execSync(`sips -s format png "${WA_ICNS}" --out "${TMP_WA}"`, { stdio: 'pipe' });
  execSync(`sips -s format png "${CLAUDE_ICNS}" --out "${TMP_CLAUDE}"`, { stdio: 'pipe' });

  // Resize both to the target output size.
  const wa = await sharp(TMP_WA).resize(SIZE, SIZE).png().toBuffer();
  const claude = await sharp(TMP_CLAUDE).resize(SIZE, SIZE).png().toBuffer();

  // Triangle masks. Diagonal runs from top-left (0,0) to bottom-right (SIZE,SIZE).
  // Upper-right triangle: above the diagonal in image coords -> Claude.
  // Lower-left triangle: below the diagonal -> WhatsApp.
  const upperRight = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
       <polygon points="0,0 ${SIZE},0 ${SIZE},${SIZE}" fill="white"/>
     </svg>`,
  );
  const lowerLeft = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
       <polygon points="0,0 ${SIZE},${SIZE} 0,${SIZE}" fill="white"/>
     </svg>`,
  );

  // Mask each icon to its triangle.
  const claudeMasked = await sharp(claude)
    .composite([{ input: upperRight, blend: 'dest-in' }])
    .png()
    .toBuffer();
  const waMasked = await sharp(wa)
    .composite([{ input: lowerLeft, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // Combine on a transparent canvas.
  await sharp({
    create: {
      width: SIZE,
      height: SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: waMasked }, { input: claudeMasked }])
    .png()
    .toFile(OUT_PNG);

  console.log('wrote', OUT_PNG);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
