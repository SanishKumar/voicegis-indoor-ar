/** Documentation capture only. Not an entry point in either production build.
 * Synthetic camera, orientation and XR platform; unmodified application UI,
 * route rendering and floor-placement flow. Never use as field-test evidence. */
if (!import.meta.env.DEV) throw new Error('The showcase is development-only.');
const { Image, document, window, WebGLRenderingContext, WebGL2RenderingContext } = globalThis;

const background = new Image();
background.src = '/docs/media/hallway-simulation.png';
await background.decode();
const video = document.createElement('canvas');
video.width = 390;
video.height = 844;
const context = video.getContext('2d');
const paint = () => context.drawImage(background, 0, 0, video.width, video.height);
paint();
setInterval(paint, 100);
Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
  value: async () => video.captureStream(10),
});
Object.defineProperty(window, 'DeviceOrientationEvent', { value: class {} });
for (const type of ['deviceorientation', 'deviceorientationabsolute']) {
  window.addEventListener(
    type,
    (event) => {
      if (event.isTrusted) event.stopImmediatePropagation();
    },
    true,
  );
}
setInterval(() => {
  const event = new Event('deviceorientation');
  for (const [key, value] of Object.entries({
    alpha: 0,
    beta: 75,
    gamma: 0,
    absolute: false,
    timeStamp: performance.now(),
  })) {
    Object.defineProperty(event, key, { value });
  }
  window.dispatchEvent(event);
}, 50);

const style = document.createElement('style');
style.textContent = `
  .showcase-label { position: fixed; z-index: 2000; left: 50%; top: 46%; transform: translateX(-50%); padding: 5px 10px; border-radius: 20px; background: #17233ade; color: white; font: 11px sans-serif; letter-spacing: .06em; white-space: nowrap; pointer-events: none; }
  .camera-ar-overlay.is-active { background: url('/docs/media/hallway-simulation.png') center / 100% 100% !important; }
  .camera-ar-overlay > canvas.showcase-xr { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 0; pointer-events: none; }
  .camera-ar-overlay > :not(canvas) { position: relative; z-index: 1; }
`;
document.head.append(style);
const label = document.createElement('div');
label.className = 'showcase-label';
label.textContent = 'SIMULATED SCENE · PRODUCT INTERFACE';
document.body.append(label);

for (const prototype of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
  Object.defineProperty(prototype, 'makeXRCompatible', {
    value: async () => {},
    configurable: true,
  });
}
Object.defineProperty(window, 'XRWebGLBinding', { value: undefined, configurable: true });
Object.defineProperty(window, 'XRRay', { value: class {}, configurable: true });
Object.defineProperty(window, 'XRWebGLLayer', {
  value: class {
    framebuffer = null;
    framebufferWidth = 390;
    framebufferHeight = 844;
    ignoreDepthValues = true;
    constructor(session, gl) {
      gl.canvas.width = this.framebufferWidth;
      gl.canvas.height = this.framebufferHeight;
      gl.canvas.className = 'showcase-xr';
      session.overlay.prepend(gl.canvas);
    }
    getViewport() {
      return { x: 0, y: 0, width: 390, height: 844 };
    }
  },
  configurable: true,
});
const angle = Math.PI / 12;
const c = Math.cos(angle),
  s = Math.sin(angle);
const matrix = new Float32Array([1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 1.4, 0, 1]);
const focal = 1 / Math.tan((55 * Math.PI) / 360);
const projection = new Float32Array([
  (focal * 844) / 390,
  0,
  0,
  0,
  0,
  focal,
  0,
  0,
  0,
  0,
  -1.002,
  -1,
  0,
  0,
  -0.2,
  0,
]);
const surface = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -2, 1]);
class Session extends EventTarget {
  environmentBlendMode = 'alpha-blend';
  renderState = {};
  ended = false;
  reference = new EventTarget();
  constructor(overlay) {
    super();
    this.overlay = overlay;
  }
  updateRenderState(update) {
    Object.assign(this.renderState, update);
  }
  async requestReferenceSpace() {
    return this.reference;
  }
  async requestHitTestSource() {
    return { cancel() {} };
  }
  requestAnimationFrame(callback) {
    return window.requestAnimationFrame((time) => {
      if (this.ended) return;
      callback(time, {
        getViewerPose: () => ({
          transform: { matrix },
          emulatedPosition: false,
          views: [{ transform: { matrix }, projectionMatrix: projection }],
        }),
        getHitTestResults: () => [{ getPose: () => ({ transform: { matrix: surface } }) }],
      });
    });
  }
  cancelAnimationFrame(id) {
    window.cancelAnimationFrame(id);
  }
  async end() {
    this.ended = true;
    this.overlay.querySelector('.showcase-xr')?.remove();
    this.dispatchEvent(new Event('end'));
  }
}
Object.defineProperty(navigator, 'xr', {
  value: Object.assign(new EventTarget(), {
    isSessionSupported: async () => true,
    requestSession: async (_mode, options) => new Session(options.domOverlay.root),
  }),
  configurable: true,
});
await import('/src/main.jsx');
