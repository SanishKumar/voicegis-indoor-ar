// Rebuild with: node scripts/prepareClinicalFurniture.mjs <neutralize Hospital GLB>
// Bake the selected assemblies into compact unit meshes for floor instancing.
import fs from 'node:fs';
import jpeg from 'jpeg-js';
import { Box3, Matrix4, Vector3 } from 'three';
import { MeshoptSimplifier } from 'meshoptimizer';

const file = fs.readFileSync(process.argv[2]);
const jsonEnd = 20 + file.readUInt32LE(12);
const scene = JSON.parse(file.subarray(20, jsonEnd));
if (
  !scene.asset.extras?.source?.endsWith('9e77947654e24a73b6221ef2a878f766') ||
  scene.nodes.length !== 31366
) {
  throw new Error('Expected the supplied Hospital GLB by neutralize.');
}
const componentTypes = { 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
function readAccessor(id) {
  const a = scene.accessors[id],
    view = scene.bufferViews[a.bufferView];
  const Type = componentTypes[a.componentType];
  const width = { VEC3: 3, VEC2: 2, SCALAR: 1 }[a.type];
  if (!Type || !width || (view.byteStride && view.byteStride !== width * Type.BYTES_PER_ELEMENT)) {
    throw new Error('Unexpected furniture accessor layout');
  }
  return new Type(
    file.buffer,
    file.byteOffset + jsonEnd + 8 + (view.byteOffset || 0) + (a.byteOffset || 0),
    a.count * width,
  );
}
const matrix = (n) => (n.matrix ? new Matrix4().fromArray(n.matrix) : new Matrix4());
const root = scene.nodes.slice(0, 5).reduce((world, n) => world.multiply(matrix(n)), new Matrix4());
const encode = (array) =>
  Buffer.from(array.buffer, array.byteOffset, array.byteLength).toString('base64');
const textures = new Map();
function textureFor(index) {
  if (!textures.has(index)) {
    const image = scene.images[scene.textures[index].source];
    if (image.mimeType !== 'image/jpeg') throw new Error('Expected a JPEG colour texture.');
    const view = scene.bufferViews[image.bufferView];
    const start = jsonEnd + 8 + (view.byteOffset || 0);
    textures.set(
      index,
      jpeg.decode(file.subarray(start, start + view.byteLength), { useTArray: true }),
    );
  }
  return textures.get(index);
}
// glTF base-colour factors and Three vertex colours are linear; image pixels are sRGB.
const linear = Array.from({ length: 256 }, (_, i) => {
  const s = i / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
});
function extract(id, yaw, targetFaces) {
  const positions = [],
    colors = [],
    indices = [],
    vertices = new Map();
  const bounds = new Box3();
  function walk(i, parent) {
    const node = scene.nodes[i],
      world = parent.clone().multiply(matrix(node));
    for (const primitive of scene.meshes[node.mesh]?.primitives ?? []) {
      const pos = readAccessor(primitive.attributes.POSITION),
        faces = readAccessor(primitive.indices);
      const material = scene.materials[primitive.material].pbrMetallicRoughness;
      const factor = (material.baseColorFactor ?? [1, 1, 1]).slice(0, 3);
      const image = material.baseColorTexture ? textureFor(material.baseColorTexture.index) : null;
      const uv = image ? readAccessor(primitive.attributes.TEXCOORD_0) : null;
      const remap = [];
      for (let v = 0; v < pos.length; v += 3) {
        const point = new Vector3().fromArray(pos, v).applyMatrix4(world);
        let rgb = factor.map((c) => Math.round(c * 255));
        if (image && uv) {
          const index = (v / 3) * 2;
          const x = Math.floor((uv[index] - Math.floor(uv[index])) * image.width);
          const y = Math.floor((uv[index + 1] - Math.floor(uv[index + 1])) * image.height);
          const pixel = 4 * (y * image.width + x);
          rgb = factor.map((c, k) => Math.round(c * linear[image.data[pixel + k]] * 255));
        }
        const key = [...point.toArray().map((x) => Math.round(x * 100000)), ...rgb].join(',');
        if (!vertices.has(key)) {
          vertices.set(key, positions.length / 3);
          positions.push(...point.toArray());
          colors.push(...rgb);
          bounds.expandByPoint(point);
        }
        remap.push(vertices.get(key));
      }
      const mirrored = world.determinant() < 0;
      for (let t = 0; t < faces.length; t += 3) {
        indices.push(
          remap[faces[t]],
          remap[faces[t + (mirrored ? 2 : 1)]],
          remap[faces[t + (mirrored ? 1 : 2)]],
        );
      }
    }
    for (const child of node.children ?? []) walk(child, world);
  }
  walk(id, new Matrix4().makeRotationY(yaw).multiply(root));
  const center = bounds.getCenter(new Vector3()).toArray(),
    size = bounds.getSize(new Vector3()).toArray();
  const [simplified] = MeshoptSimplifier.simplifyWithAttributes(
    new Uint32Array(indices),
    new Float32Array(positions),
    3,
    Float32Array.from(colors, (c) => c / 255),
    3,
    [0.08, 0.08, 0.08],
    null,
    Math.min(indices.length, targetFaces * 3),
    0.055,
    ['Permissive', 'Prune'],
  );
  const [remap, count] = MeshoptSimplifier.compactMesh(simplified);
  const xyz = new Int16Array(count * 3),
    rgb = new Uint8Array(count * 3);
  for (let v = 0; v < remap.length; v++) {
    if (remap[v] === 0xffffffff) continue;
    for (let k = 0; k < 3; k++) {
      xyz[remap[v] * 3 + k] = Math.round((32766 * (positions[v * 3 + k] - center[k])) / size[k]);
      rgb[remap[v] * 3 + k] = colors[v * 3 + k];
    }
  }
  return { xyz: encode(xyz), rgb: encode(rgb), faces: encode(Uint16Array.from(simplified)) };
}
await MeshoptSimplifier.ready;
const library = Object.fromEntries(
  [
    ['hospitalBed', 9, Math.PI / 2, 800],
    ['waitingSeats', 6967, 0, 340],
    ['wheelchair', 2537, Math.PI / 2, 700],
    ['taskChair', 17117, 0, 320],
    ['instrumentCart', 11155, Math.PI / 2, 260],
    ['ivStand', 13097, 0, 240],
    ['workDesk', 16157, 0, 260],
    ['deskMonitor', 16997, 0, 160],
    ['canteenTable', 18683, 0, 360],
    ['wasteBin', 10995, 0, 140],
  ].map(([name, id, yaw, budget]) => [name, extract(id, yaw, budget)]),
);
fs.writeFileSync(
  new URL('../src/map/clinicalFurniture.json', import.meta.url),
  JSON.stringify(library, null, 2) + '\n',
);
