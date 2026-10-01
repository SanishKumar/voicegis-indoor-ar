// @ts-check
/*
 * Draws the cloud layer that sits behind the interface and writes it to
 * src/styles/sky-clouds.webp.
 *
 * The clouds are generated, not photographed: layered value noise, thresholded
 * into soft masses that thicken towards the horizon and lit from above. The
 * image is white cloud on a transparent ground, so the sky's own colours come
 * from the CSS gradient under it and can change without redrawing this.
 *
 * It is deterministic - the same seed gives the same file - and it is run by
 * hand when the look changes:  node scripts/renderSkyClouds.mjs
 */

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'src', 'styles', 'sky-clouds.webp');

const WIDTH = 1280;
const HEIGHT = 960;
const SEED = 20261001;
const QUALITY = 0.72;

/** Runs in the page. @param {{width: number, height: number, seed: number, quality: number}} options */
function draw({ width, height, seed, quality }) {
  // A small seeded generator, so the picture is the same every time.
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const SIZE = 256;
  const lattice = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < lattice.length; i += 1) lattice[i] = random();
  const at = (x, y) => lattice[(y & (SIZE - 1)) * SIZE + (x & (SIZE - 1))];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const noise = (x, y) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = fade(x - x0);
    const fy = fade(y - y0);
    const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
    const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
    return top + (bottom - top) * fy;
  };
  const layered = (x, y, octaves) => {
    let total = 0;
    let amplitude = 0.5;
    let frequency = 1;
    let range = 0;
    for (let octave = 0; octave < octaves; octave += 1) {
      total += amplitude * noise(x * frequency, y * frequency);
      range += amplitude;
      amplitude *= 0.5;
      frequency *= 2.02;
    }
    return total / range;
  };
  const smooth = (edge0, edge1, value) => {
    const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  };

  // Clouds are wider than they are tall, and warped so they do not look tiled.
  const density = (u, v) => {
    const warpX = layered(u * 1.3 + 11.3, v * 1.3 + 4.1, 3) - 0.5;
    const warpY = layered(u * 1.3 + 2.7, v * 1.3 + 17.9, 3) - 0.5;
    return layered(u * 1.5 + warpX * 1.2, v * 3.1 + warpY * 1.2, 5);
  };

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const image = context.createImageData(width, height);
  const aspect = width / height;

  for (let py = 0; py < height; py += 1) {
    const v = py / height;
    // Thin wisps high up, banks of cloud low down.
    const cover = 0.16 + 0.62 * smooth(0.28, 0.96, v);
    const threshold = 0.74 - cover * 0.46;
    for (let px = 0; px < width; px += 1) {
      const u = (px / width) * aspect;
      const here = density(u, v);
      const body = smooth(threshold, threshold + 0.26, here);
      if (body <= 0.002) continue;
      // Lit from above and a little to the left: the side facing the light is
      // the side where the cloud thins out in that direction.
      const towardsLight = density(u - 0.012, v - 0.03);
      const lit = Math.min(1, Math.max(0, 0.62 + (here - towardsLight) * 9));
      // Undersides are a cool grey-blue high up and pick up the horizon's warmth low down.
      const warmth = smooth(0.55, 1, v);
      const shadeR = 150 + 78 * warmth;
      const shadeG = 176 + 22 * warmth;
      const shadeB = 214 - 30 * warmth;
      const index = (py * width + px) * 4;
      image.data[index] = shadeR + (255 - shadeR) * lit;
      image.data[index + 1] = shadeG + (255 - shadeG) * lit;
      image.data[index + 2] = shadeB + (255 - shadeB) * lit;
      image.data[index + 3] = 255 * Math.min(0.86, body * (0.5 + 0.5 * smooth(0.0, 0.5, v)));
    }
  }
  context.putImageData(image, 0, 0);

  // A light blur takes the noise's grain off the edges.
  const soft = document.createElement('canvas');
  soft.width = width;
  soft.height = height;
  const softContext = soft.getContext('2d');
  softContext.filter = 'blur(7px)';
  softContext.drawImage(canvas, 0, 0);
  return soft.toDataURL('image/webp', quality);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const dataUrl = await page.evaluate(draw, {
    width: WIDTH,
    height: HEIGHT,
    seed: SEED,
    quality: QUALITY,
  });
  const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  await writeFile(output, bytes);
  console.log(`${path.relative(root, output)}  ${(bytes.length / 1024).toFixed(1)} KiB`);
} finally {
  await browser.close();
}
