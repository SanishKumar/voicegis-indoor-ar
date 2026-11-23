// Rebuild the locally explorable floor from the supplied neutralize Hospital GLB.
import fs from 'node:fs';
import { pack } from 'gltfpack';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

const model = 'https://sketchfab.com/3d-models/hospital-9e77947654e24a73b6221ef2a878f766';
const sourcePath = process.argv[2];
if (!sourcePath) throw new Error('Usage: node scripts/prepareHospitalModel.mjs <Hospital.glb>');

function readGlb(data) {
  if (data.toString('ascii', 0, 4) !== 'glTF' || data.readUInt32LE(4) !== 2) {
    throw new Error('Expected a glTF 2.0 binary file.');
  }
  const jsonEnd = 20 + data.readUInt32LE(12);
  return { json: JSON.parse(data.subarray(20, jsonEnd)), binary: data.subarray(jsonEnd + 8) };
}

const input = fs.readFileSync(sourcePath);
if (readGlb(input).json.asset.extras?.source !== model) throw new Error('Unexpected source model.');

// The instancing pass retains repeated equipment and partitions at their source
// transforms. Keep full-precision positions so thin rails and handles survive.
let packed;
await pack(
  [
    '-i',
    'source.glb',
    '-o',
    'floor.glb',
    '-si',
    '0.15',
    '-se',
    '0.002',
    '-mi',
    '-ke',
    '-noq',
  ],
  {
    read: (name) => {
      if (name !== 'source.glb') throw new Error('Expected a self-contained model.');
      return input;
    },
    write: (name, bytes) => {
      if (name !== 'floor.glb') throw new Error('Unexpected external output.');
      packed = Buffer.from(bytes);
    },
  },
);

// Box-filter the source images in premultiplied alpha, retaining transparent
// edges on signs and glass. The original axial proportions and UVs are kept.
function resizeImage(image) {
  const scale = Math.min(1, 384 / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  if (scale === 1) return image;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor((y * image.height) / height);
    const y1 = Math.floor(((y + 1) * image.height) / height);
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor((x * image.width) / width);
      const x1 = Math.floor(((x + 1) * image.width) / width);
      let red = 0,
        green = 0,
        blue = 0,
        alpha = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const offset = 4 * (sy * image.width + sx);
          const a = image.data[offset + 3];
          red += image.data[offset] * a;
          green += image.data[offset + 1] * a;
          blue += image.data[offset + 2] * a;
          alpha += a;
        }
      }
      const dest = 4 * (y * width + x);
      if (alpha > 0) {
        data[dest] = Math.round(red / alpha);
        data[dest + 1] = Math.round(green / alpha);
        data[dest + 2] = Math.round(blue / alpha);
      }
      data[dest + 3] = Math.round(alpha / ((y1 - y0) * (x1 - x0)));
    }
  }
  return { data, width, height };
}

const { json, binary } = readGlb(packed);
const images = new Map(json.images.map((image) => [image.bufferView, image]));
const parts = [];
let binaryLength = 0;
function pad4(length) {
  return (4 - (length % 4)) % 4;
}
for (const [index, view] of json.bufferViews.entries()) {
  const start = view.byteOffset ?? 0;
  let bytes = binary.subarray(start, start + view.byteLength);
  const image = images.get(index);
  if (image) {
    const png = image.mimeType === 'image/png';
    if (!png && image.mimeType !== 'image/jpeg')
      throw new Error('Unexpected source texture format.');
    const decoded = png ? PNG.sync.read(bytes) : jpeg.decode(bytes, { useTArray: true });
    const resized = resizeImage(decoded);
    const encoded = png ? PNG.sync.write(resized) : jpeg.encode(resized, 82).data;
    if (resized !== decoded || encoded.length < bytes.length) bytes = encoded;
  }
  view.byteOffset = binaryLength;
  view.byteLength = bytes.length;
  const padding = Buffer.alloc(pad4(bytes.length));
  parts.push(bytes, padding);
  binaryLength += bytes.length + padding.length;
}
json.buffers[0].byteLength = binaryLength;
const metadata = Buffer.from(JSON.stringify(json));
const jsonLength = metadata.length + pad4(metadata.length);
const header = Buffer.alloc(20);
header.write('glTF', 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(28 + jsonLength + binaryLength, 8);
header.writeUInt32LE(jsonLength, 12);
header.write('JSON', 16);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(binaryLength, 0);
binHeader.write('BIN', 4);
const folder = new URL('../src/map/assets/', import.meta.url);
fs.mkdirSync(folder, { recursive: true });
const result = Buffer.concat([
  header,
  metadata,
  Buffer.alloc(pad4(metadata.length), 0x20),
  binHeader,
  ...parts,
]);
fs.writeFileSync(new URL('hospital-interior.glb', folder), result);
console.log(`Prepared hospital-interior.glb (${result.length.toLocaleString('en-US')} bytes)`);
