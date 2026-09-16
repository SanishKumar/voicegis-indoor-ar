import { describe, expect, it } from 'vitest';
import { ASTERION_PACKAGE, ASTERION_RUNTIME } from '../test/venueFixtures';
import { calculateCompiledRoute } from '../engine/compiledRoutePolicy';
import { prepareDiagnosticSession } from './prepareDiagnosticSession';
import liftClosure from '../../buildings/asterion-medical-center/operations/all-public-lifts-closed.overlay.json';
import type { OperationalOverlay } from '../engine/operationalOverlay';

function input() {
  return {
    buildingPackage: structuredClone(ASTERION_PACKAGE),
    route: calculateCompiledRoute(ASTERION_RUNTIME, 'poi:poi-main-entrance', 'poi:poi-cardiology', {
      profile: 'wheelchair',
    }),
    policy: { profile: 'wheelchair' as const },
    sessionId: 'operator-test',
    routeRevision: 1,
  };
}

describe('operator route/session preparation', () => {
  it('verifies the package and reflects canonical route/anchor geometry into filter space', async () => {
    const prepared = await prepareDiagnosticSession(input());
    expect(prepared.identity.packageHash).toBe(ASTERION_PACKAGE.manifest.contentHash);
    const original = ASTERION_PACKAGE.localizationAnchors[0];
    const anchor = prepared.anchors.find((entry) => entry.id === original.id)!;
    expect(anchor.position).toEqual([original.position[0], -original.position[1]]);
    expect(prepared.routeSegments.length).toBeGreaterThan(0);
    expect(
      prepared.routeSegments.every(
        (segment) =>
          segment.lengthMeters ===
          Math.hypot(segment.to[0] - segment.from[0], segment.to[1] - segment.from[1]),
      ),
    ).toBe(true);
  });

  it('rejects tampered package bytes before creating a session', async () => {
    const options = input();
    options.buildingPackage.localizationAnchors[0].position[0] += 1;
    await expect(prepareDiagnosticSession(options)).rejects.toThrow('SHA-256');
  });

  it.each(['package', 'profile', 'path', 'overlay'] as const)(
    'rejects a stale %s binding',
    async (kind) => {
      const options = input();
      if (kind === 'package') options.route.receipt.packageHash = 'foreign';
      if (kind === 'profile') options.route.receipt.profile = 'standard';
      if (kind === 'path' && options.route.found) options.route.pathIds.reverse();
      if (kind === 'overlay') options.route.receipt.operationalOverlayId = 'old-policy';
      await expect(prepareDiagnosticSession(options)).rejects.toThrow('current route policy');
    },
  );

  it('uses canonical nodes rather than trusting copied display coordinates', async () => {
    const options = input();
    if (!options.route.found) throw new Error('fixture route');
    options.route.path[0] = { ...options.route.path[0], x: 99_999, y: 99_999 };
    const prepared = await prepareDiagnosticSession(options);
    expect(prepared.routeSegments[0].from).toEqual([
      options.buildingPackage.routing.nodes.find((node) => node.id === 'poi:poi-main-entrance')!
        .position[0],
      -options.buildingPackage.routing.nodes.find((node) => node.id === 'poi:poi-main-entrance')!
        .position[1],
    ]);
  });

  it('never draws a same-floor line across a vertical connector', async () => {
    const prepared = await prepareDiagnosticSession(input());
    expect(new Set(prepared.routeSegments.map((segment) => segment.floorId)).size).toBeGreaterThan(
      1,
    );
    for (const segment of prepared.routeSegments) {
      expect(segment.id).not.toContain('vertical');
      const edgeId = segment.id.slice(segment.id.indexOf(':') + 1);
      expect(ASTERION_PACKAGE.routing.edges.find((edge) => edge.id === edgeId)?.kind).toBe(
        'within-space',
      );
    }
  });

  it('snapshots inputs before the asynchronous integrity check', async () => {
    const options = input();
    const pending = prepareDiagnosticSession(options);
    options.route.receipt.packageHash = 'changed';
    options.buildingPackage.localizationAnchors[0].position[0] = 99_999;
    const prepared = await pending;
    expect(prepared.identity.packageHash).toBe(ASTERION_PACKAGE.manifest.contentHash);
    expect(prepared.anchors[0].position[0]).not.toBe(99_999);
  });

  it('refuses an unsuccessful route', async () => {
    const options = input();
    options.route = {
      found: false,
      error: 'none',
      receipt: { ...options.route.receipt, status: 'unroutable' },
    };
    await expect(prepareDiagnosticSession(options)).rejects.toThrow('successful');
  });

  it('refuses a formerly valid step-free route when the current overlay closes its lifts', async () => {
    const options = input();
    await expect(
      prepareDiagnosticSession({
        ...options,
        policy: {
          ...options.policy,
          operationalOverlay: liftClosure as OperationalOverlay,
          evaluatedAt: '2026-07-22T12:00:00.000Z',
        },
      }),
    ).rejects.toThrow('current route policy');
  });
});
