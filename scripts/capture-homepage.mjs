import puppeteer from 'puppeteer';
import { execSync, exec } from 'child_process';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRAMES_DIR = join(__dirname, '../.capture-frames');
const OUT_GIF = join(__dirname, '../homepage-mentioned.gif');
const OUT_MP4 = join(__dirname, '../homepage-mentioned.mp4');

// X-optimal dimensions: 1280x720 (16:9)
const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 20;
const DURATION_S = 7; // seconds to capture
const TOTAL_FRAMES = FPS * DURATION_S;

async function main() {
  // Clean up frames dir
  if (existsSync(FRAMES_DIR)) rmSync(FRAMES_DIR, { recursive: true });
  mkdirSync(FRAMES_DIR, { recursive: true });

  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      `--window-size=${WIDTH},${HEIGHT}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });

  // Set cookie consent cookie so the banner never appears
  await page.setCookie({
    name: 'mentioned_cookie_consent',
    value: 'accepted',
    domain: 'localhost',
    path: '/',
  });

  console.log('Navigating to homepage...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0', timeout: 30000 });

  // Wait for page to fully render and animations to start
  await new Promise(r => setTimeout(r, 1000));

  console.log(`Capturing ${TOTAL_FRAMES} frames at ${FPS}fps over ${DURATION_S}s...`);

  for (let i = 0; i < TOTAL_FRAMES; i++) {
    const framePath = join(FRAMES_DIR, `frame-${String(i).padStart(4, '0')}.png`);
    await page.screenshot({ path: framePath, type: 'png' });
    // Wait the inter-frame interval
    await new Promise(r => setTimeout(r, 1000 / FPS));
    if (i % 20 === 0) process.stdout.write(`  frame ${i}/${TOTAL_FRAMES}\n`);
  }

  await browser.close();
  console.log('Frames captured. Generating GIF with ffmpeg...');

  // Build palette for high-quality GIF
  const paletteFile = join(FRAMES_DIR, 'palette.png');
  execSync(
    `ffmpeg -y -framerate ${FPS} -i "${FRAMES_DIR}/frame-%04d.png" ` +
    `-vf "fps=${FPS},scale=${WIDTH}:-1:flags=lanczos,palettegen=stats_mode=diff" ` +
    `"${paletteFile}"`,
    { stdio: 'inherit' }
  );

  execSync(
    `ffmpeg -y -framerate ${FPS} -i "${FRAMES_DIR}/frame-%04d.png" -i "${paletteFile}" ` +
    `-lavfi "fps=${FPS},scale=${WIDTH}:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" ` +
    `"${OUT_GIF}"`,
    { stdio: 'inherit' }
  );

  // Also produce an MP4 (X actually handles MP4 better than GIF - no 15MB limit)
  execSync(
    `ffmpeg -y -framerate ${FPS} -i "${FRAMES_DIR}/frame-%04d.png" ` +
    `-c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart ` +
    `"${OUT_MP4}"`,
    { stdio: 'inherit' }
  );

  // Clean up frames
  rmSync(FRAMES_DIR, { recursive: true });

  const { statSync } = await import('fs');
  const gifSize = (statSync(OUT_GIF).size / 1024 / 1024).toFixed(1);
  const mp4Size = (statSync(OUT_MP4).size / 1024 / 1024).toFixed(1);

  console.log(`\nDone!`);
  console.log(`  GIF: ${OUT_GIF} (${gifSize}MB)`);
  console.log(`  MP4: ${OUT_MP4} (${mp4Size}MB)`);
  console.log(`\nNote: X handles MP4 better (no 15MB limit, true 60fps). Use the .mp4 if GIF is > 15MB.`);
}

main().catch(err => { console.error(err); process.exit(1); });
