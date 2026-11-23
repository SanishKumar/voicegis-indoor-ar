import {
  Box3,
  Color,
  DirectionalLight,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  NeutralToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  Texture,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import floorUrl from './assets/hospital-interior.glb?url';

export interface FloorModelControls {
  fit(): void;
  zoom(inward: boolean): void;
  dispose(): void;
}

// The packer batches mirrored copies together. Three selects the culling
// direction once per draw from the mesh transform, so put the shared
// reflection there and leave every instance in the same world position.
export function orientFloorInstances(mesh: InstancedMesh) {
  const instance = new Matrix4();
  mesh.getMatrixAt(0, instance);
  if (instance.determinant() >= 0) return;
  const reflection = new Matrix4().makeScale(-1, 1, 1);
  mesh.scale.x *= -1;
  for (let index = 0; index < mesh.count; index++) {
    mesh.getMatrixAt(index, instance);
    mesh.setMatrixAt(index, instance.premultiply(reflection));
  }
  mesh.instanceMatrix.needsUpdate = true;
}

// The floor shares geometry, materials and texture sources across assemblies.
function disposeFloor(root: Object3D) {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  const images = new Set<ImageBitmap>();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    if (object instanceof InstancedMesh) object.dispose();
    geometries.add(object.geometry);
    for (const material of [object.material].flat()) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value instanceof Texture) textures.add(value);
    }
    material.dispose();
  }
  for (const texture of textures) {
    if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) {
      images.add(texture.image);
    }
    texture.dispose();
  }
  for (const image of images) image.close();
}

export function openFloorModel(
  canvas: HTMLCanvasElement,
  onStatus: (status: 'ready' | 'failed') => void,
): FloorModelControls {
  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
  renderer.toneMapping = NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  const scene = new Scene();
  scene.background = new Color(0xe9eae3);
  scene.add(new HemisphereLight(0xf2f5ff, 0xb9ae9c, 1.05));
  const sun = new DirectionalLight(0xfff4de, 2.1);
  sun.castShadow = true;
  const shadowResolution = canvas.clientWidth < 600 ? 1024 : 2048;
  sun.shadow.mapSize.setScalar(shadowResolution);
  scene.add(sun, sun.target);
  const camera = new PerspectiveCamera(40, 1, 0.01, 1000);
  const orbit = new OrbitControls(camera, canvas);
  orbit.maxPolarAngle = Math.PI * 0.485;
  orbit.zoomToCursor = true;
  const controller = new AbortController();
  const bounds = new Box3();
  const center = new Vector3();
  const size = new Vector3();
  let floor: Object3D | undefined;
  let frame = 0;
  let closed = false;
  let fitted = true;

  // Draw only when controls, model or viewport change.
  function draw() {
    frame = 0;
    if (!floor || closed) return;
    renderer.render(scene, camera);
  }
  function redraw() {
    if (!closed && !frame) frame = requestAnimationFrame(draw);
  }
  function fit() {
    if (!floor) return;
    const aspect = camera.aspect;
    // On a phone, aim along the longer axis so the floor uses the tall viewport.
    const alongX = size.x > size.z === aspect < 1;
    const back = new Vector3(alongX ? 1 : 0.35, 1.5, alongX ? 0.35 : 1).normalize();
    const right = new Vector3().crossVectors(camera.up, back).normalize();
    const up = new Vector3().crossVectors(back, right);
    const tanY = Math.tan((camera.fov * Math.PI) / 360);
    const offset = new Vector3();
    let distance = 0;
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          offset.set(x, y, z).sub(center);
          const halfWidth = Math.abs(offset.dot(right)) / (tanY * aspect);
          const halfHeight = Math.abs(offset.dot(up)) / tanY;
          distance = Math.max(distance, offset.dot(back) + Math.max(halfWidth, halfHeight));
        }
      }
    }
    orbit.maxDistance = distance * 3;
    orbit.target.copy(center);
    camera.position.copy(center).addScaledVector(back, distance * 1.08);
    camera.far = orbit.maxDistance + size.length() * 2;
    camera.updateProjectionMatrix();
    orbit.update();
    fitted = true;
    redraw();
  }
  function resize() {
    const width = canvas.clientWidth,
      height = canvas.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (fitted) fit();
    redraw();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  const moved = () => {
    fitted = false;
  };
  orbit.addEventListener('start', moved);
  orbit.addEventListener('change', redraw);
  function zoom(inward: boolean) {
    if (!floor) return;
    moved();
    if (inward) orbit.dollyIn(0.78);
    else orbit.dollyOut(0.78);
  }
  function keydown(event: KeyboardEvent) {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const step = Math.PI / 14;
    switch (event.key) {
      case 'ArrowLeft':
        if (event.shiftKey) orbit.pan(36, 0);
        else orbit.rotateLeft(step);
        break;
      case 'ArrowRight':
        if (event.shiftKey) orbit.pan(-36, 0);
        else orbit.rotateLeft(-step);
        break;
      case 'ArrowUp':
        if (event.shiftKey) orbit.pan(0, 36);
        else orbit.rotateUp(step);
        break;
      case 'ArrowDown':
        if (event.shiftKey) orbit.pan(0, -36);
        else orbit.rotateUp(-step);
        break;
      case '+':
      case '=':
        zoom(true);
        break;
      case '-':
        zoom(false);
        break;
      case 'Home':
        fit();
        break;
      default:
        return;
    }
    if (event.key !== 'Home') moved();
    event.preventDefault();
    event.stopPropagation();
  }
  canvas.addEventListener('keydown', keydown);
  const contextLost = (event: Event) => {
    event.preventDefault();
    if (!closed) onStatus('failed');
  };
  canvas.addEventListener('webglcontextlost', contextLost);
  resize();
  async function load() {
    const response = await fetch(floorUrl, { signal: controller.signal });
    if (!response.ok) throw Error('Floor asset unavailable');
    const bytes = await response.arrayBuffer();
    if (closed) return;
    const gltf = await new GLTFLoader().parseAsync(bytes, '');
    if (closed) {
      disposeFloor(gltf.scene);
      return;
    }
    floor = gltf.scene;
    floor.traverse((object) => {
      if (object instanceof InstancedMesh) orientFloorInstances(object);
      if (object instanceof Mesh) object.castShadow = object.receiveShadow = true;
    });
    bounds.setFromObject(floor);
    if (bounds.isEmpty()) throw Error('Empty floor model');
    bounds.getSize(size);
    bounds.getCenter(center);
    // A static shadow pass gives beds, walls and equipment depth at any zoom.
    const radius = size.length() / 2;
    sun.target.position.copy(center);
    sun.position
      .set(-0.5, 1, 0.55)
      .normalize()
      .multiplyScalar(2 * radius)
      .add(center);
    Object.assign(sun.shadow.camera, {
      left: -radius,
      right: radius,
      top: radius,
      bottom: -radius,
      near: radius * 0.8,
      far: radius * 3.2,
    });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.normalBias = size.length() * 0.00015;
    renderer.shadowMap.needsUpdate = true;
    orbit.minDistance = size.length() * 0.015;
    camera.near = Math.max(0.001, size.length() * 0.0001);
    scene.add(floor);
    resize();
    draw();
    if (!renderer.getContext().isContextLost()) onStatus('ready');
  }
  void load().catch(() => {
    if (!closed) onStatus('failed');
  });
  return {
    fit,
    zoom,
    dispose() {
      closed = true;
      controller.abort();
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      canvas.removeEventListener('keydown', keydown);
      canvas.removeEventListener('webglcontextlost', contextLost);
      orbit.removeEventListener('start', moved);
      orbit.removeEventListener('change', redraw);
      orbit.dispose();
      if (floor) disposeFloor(floor);
      sun.shadow.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
