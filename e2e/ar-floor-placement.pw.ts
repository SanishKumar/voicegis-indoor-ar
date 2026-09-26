import {
  expect,
  expectCenterHitTarget,
  expectInsideViewport,
  openPharmacyRoute,
  test,
} from './support';

/**
 * Synthetic platform poses/hits, real production app and Three renderer. This
 * proves the placement controls and state transitions, not handset accuracy,
 * camera compositing or the appearance of a target on a physical floor.
 */
for (const { surfaceDetection, manualAlignment } of [
  { surfaceDetection: true, manualAlignment: true },
  { surfaceDetection: true, manualAlignment: false },
  { surfaceDetection: false, manualAlignment: false },
]) {
  test(`AR floor placement stays explicit and escapable (surface detection: ${surfaceDetection}, manual alignment: ${manualAlignment})`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript(
      ({ surfaceDetection, manualAlignment }) => {
        const state = { hits: false, pose: true };
        Object.defineProperty(window, 'floorTest', { value: state });
        Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
          value: async () => new MediaStream(),
        });
        if (manualAlignment) {
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
            Object.entries({
              alpha: 0,
              beta: 60,
              gamma: 0,
              absolute: false,
              timeStamp: performance.now(),
            }).forEach(([key, value]) => Object.defineProperty(event, key, { value }));
            window.dispatchEvent(event);
          }, 50);
        }
        for (const prototype of [
          WebGLRenderingContext.prototype,
          WebGL2RenderingContext.prototype,
        ]) {
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
            framebufferWidth = 320;
            framebufferHeight = 700;
            ignoreDepthValues = true;
            getViewport() {
              return { x: 0, y: 0, width: 320, height: 700 };
            }
          },
          configurable: true,
        });
        const c = Math.SQRT1_2;
        const matrix = new Float32Array([1, 0, 0, 0, 0, c, -c, 0, 0, c, c, 0, 0, 1.4, 0, 1]);
        const projection = new Float32Array([
          3, 0, 0, 0, 0, 2, 0, 0, 0, 0, -1.002, -1, 0, 0, -0.2, 0,
        ]);
        const surface = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -1.4, 1]);
        class Session extends EventTarget {
          environmentBlendMode = 'alpha-blend';
          renderState = {};
          ended = false;
          reference = new EventTarget();
          constructor(private overlay: HTMLElement) {
            super();
            // WebXR promotes its DOM overlay above the page. Emulate that with
            // the browser's top layer, rather than letting operator navigation
            // cover controls that are isolated by the real XR compositor.
            overlay.setAttribute('popover', 'manual');
            Object.assign(overlay.style, {
              margin: '0',
              width: '100vw',
              height: '100dvh',
              maxWidth: 'none',
              maxHeight: 'none',
              border: '0',
              background: '#000609',
              color: 'inherit',
            });
            overlay.showPopover();
          }
          updateRenderState(update: object) {
            Object.assign(this.renderState, update);
          }
          async requestReferenceSpace() {
            return this.reference;
          }
          async requestHitTestSource() {
            if (!surfaceDetection) throw new DOMException('No hit testing', 'NotSupportedError');
            return { cancel() {} };
          }
          requestAnimationFrame(callback: (time: number, frame: unknown) => void) {
            return window.requestAnimationFrame((time) => {
              if (this.ended) return;
              callback(time, {
                getViewerPose: () =>
                  state.pose
                    ? {
                        transform: { matrix },
                        emulatedPosition: false,
                        views: [{ transform: { matrix }, projectionMatrix: projection }],
                      }
                    : null,
                getHitTestResults: () =>
                  state.hits ? [{ getPose: () => ({ transform: { matrix: surface } }) }] : [],
              });
            });
          }
          cancelAnimationFrame(id: number) {
            window.cancelAnimationFrame(id);
          }
          async end() {
            this.ended = true;
            this.overlay.hidePopover();
            this.overlay.removeAttribute('popover');
            this.overlay.removeAttribute('style');
            this.dispatchEvent(new Event('end'));
          }
        }
        Object.defineProperty(navigator, 'xr', {
          value: Object.assign(new EventTarget(), {
            isSessionSupported: async () => true,
            requestSession: async (_mode: string, options: { domOverlay: { root: HTMLElement } }) =>
              new Session(options.domOverlay.root),
          }),
          configurable: true,
        });
      },
      { surfaceDetection, manualAlignment },
    );

    await openPharmacyRoute(page);
    await page.locator('.checkin-toast').getByRole('button', { name: 'Dismiss' }).click();
    await page.getByRole('button', { name: 'Camera view' }).click();
    if (manualAlignment) {
      await page.getByRole('button', { name: 'I’m facing the corridor' }).click();
    }
    await page.getByRole('button', { name: 'Start AR' }).click();
    const overlay = page.locator('.camera-ar-overlay');
    await expect(overlay).toHaveAttribute(
      'data-ar-prompt',
      surfaceDetection ? 'floor' : 'floor-unavailable',
    );
    await page.setViewportSize({ width: 320, height: 700 });
    const leave = overlay.getByRole('button', { name: 'Leave AR' });
    await expectCenterHitTarget(leave);
    await expectInsideViewport(overlay.locator('.camera-ar-overlay-note'));
    await expect(overlay.getByRole('button', { name: 'This is the floor' })).toHaveCount(0);

    if (surfaceDetection) {
      await page.evaluate(() => {
        (window as unknown as { floorTest: { hits: boolean } }).floorTest.hits = true;
      });
      await expect(overlay).toHaveAttribute('data-ar-prompt', 'floor-confirm');
      const confirm = overlay.getByRole('button', { name: 'This is the floor' });
      await expectCenterHitTarget(confirm);
      await expectInsideViewport(confirm);
      await page.screenshot({ path: testInfo.outputPath('confirm-floor-320.png') });
      await confirm.click();
      await expect(overlay).toHaveAttribute(
        'data-ar-prompt',
        manualAlignment ? 'guiding' : 'heading',
      );
      if (!manualAlignment) {
        await expect(overlay).toContainText('building direction is not aligned');
        await expectCenterHitTarget(leave);
        await expectInsideViewport(overlay.locator('.camera-ar-overlay-note'));
        await page.screenshot({ path: testInfo.outputPath('heading-unavailable-320.png') });
      } else {
        await page.evaluate(() => {
          (window as unknown as { floorTest: { pose: boolean } }).floorTest.pose = false;
        });
        await expect(overlay).toHaveAttribute('data-ar-prompt', 'pose-lost');
        await page.evaluate(() => {
          Object.assign((window as unknown as { floorTest: object }).floorTest, {
            pose: true,
            hits: false,
          });
        });
        await overlay.getByRole('button', { name: 'Re-align', exact: true }).click();
        await expect(overlay).toHaveAttribute('data-ar-prompt', 'floor');
        await expect(confirm).toHaveCount(0);
      }
    } else {
      await expect(overlay).toContainText('Surface detection is unavailable');
      await page.screenshot({ path: testInfo.outputPath('floor-unavailable-320.png') });
    }
    await leave.click();
    await page.getByRole('button', { name: 'Exit to plan' }).click();
    await expect(page.locator('.compiled-map-canvas')).toHaveAttribute(
      'data-route-progress',
      '0.00',
    );
  });
}
