import {
  BoxGeometry,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';

/** A single frame for the documentation camera. Dimensions below are in metres. */
export function renderCorridor(width, height, cameraHeight, downwardTilt, verticalFov) {
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setSize(width, height, false);
  const scene = new Scene();
  scene.background = new Color('#e9e8df');
  scene.fog = new Fog('#e7e8de', 13, 31);
  scene.add(new HemisphereLight(0xfff7ea, 0xd6dcd7, 2.2));
  const daylight = new DirectionalLight(0xfff5dc, 2.2);
  daylight.position.set(-3, 6, -4);
  scene.add(daylight);

  const camera = new PerspectiveCamera(verticalFov, width / height, 0.05, 48);
  camera.position.set(0, cameraHeight, 0);
  camera.rotation.x = -downwardTilt;
  const block = new BoxGeometry();
  const materials = new Map();
  const add = (x, y, z, w, h, d, color) => {
    if (!materials.has(color)) materials.set(color, new MeshStandardMaterial({ color }));
    const mesh = new Mesh(block, materials.get(color));
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    scene.add(mesh);
  };

  add(0, -0.05, -13, 4.2, 0.1, 30, '#c5c5ba');
  add(0, 3.15, -13, 4.2, 0.1, 30, '#f4f3ed');
  add(0, 1.55, -27.9, 4.2, 3.1, 0.2, '#e4e4d9');
  for (let z = 1; z > -28; z -= 1.2) add(0, 0.001, z, 4.2, 0.002, 0.006, '#b5b6ac');
  for (const x of [-1.8, -0.6, 0.6, 1.8]) add(x, 0.001, -13, 0.006, 0.002, 30, '#b5b6ac');
  for (const side of [-1, 1]) {
    add(2.09 * side, 1.55, -13, 0.14, 3.1, 30, '#edeae0');
    add(2.01 * side, 0.48, -13, 0.04, 0.96, 30, '#bdcac3');
    add(1.99 * side, 0.075, -13, 0.055, 0.15, 30, '#7d8984');
    for (let z = -2.5; z >= -27; z -= 4.5) {
      const doorZ = z + (side === 1 ? 0.8 : 0);
      add(1.99 * side, 1.1, doorZ, 0.09, 2.2, 1.25, '#7e8177');
      add(1.93 * side, 1.06, doorZ, 0.04, 2.12, 1.12, '#b89875');
      add(1.9 * side, 1.53, doorZ, 0.025, 0.42, 0.26, '#637e80');
      add(1.86 * side, 0.95, doorZ + 0.34, 0.09, 0.035, 0.16, '#788282');
      add(1.965 * side, 1.53, doorZ - 0.84, 0.06, 0.2, 0.28, '#446865');
      add(1.94 * side, 0.9, doorZ - 2.24, 0.105, 0.09, 2.85, '#a98c6c');
    }
  }
  for (let z = -1; z > -28; z -= 3) {
    add(0, 3.08, z, 0.48, 0.06, 1.55, '#b8bcb4');
    add(0, 3.04, z, 0.44, 0.02, 1.49, '#ffffff');
  }
  add(0, 1.13, -27.7, 2, 2.26, 0.12, '#698786');
  add(0, 1.44, -27.62, 1.8, 1, 0.04, '#adcfd6');
  add(0, 1.13, -27.58, 0.045, 2.26, 0.04, '#546765');

  try {
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/jpeg', 0.92);
  } finally {
    block.dispose();
    for (const material of materials.values()) material.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
