import { Buffer } from 'node:buffer';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import catalogJson from '../../public/venues/catalog.json';
import { calculatePackageContentHash } from '../data/packageLifecycle';
import { parseVenueVersionCatalog } from '../data/venueVersionCatalog';
import { ASTERION_PACKAGE } from '../test/venueFixtures';
import { HttpPublishTransport, type HttpPublishRequest } from './httpPublishTransport';
import { createPublishDryRun } from './publishDryRun';
import { PublishConflictError, executePublishPlan } from './publishTransport';
import { ReferencePublishService } from './referencePublishService';
import { createVenuePackageArtifact } from './venuePackageArtifact';

const catalog = parseVenueVersionCatalog(catalogJson);
const publicOrigin = 'https://venues.example';
const authorizationValue = 'Bearer loopback-reference-grant';
const options = {
  packageBaseUrl: `${publicOrigin}/releases`,
  catalogUrl: `${publicOrigin}/catalog.json`,
  status: 'preview' as const,
  publishedAt: '2026-07-29T09:30:00.000Z',
  notes: 'Reference HTTP publishing service candidate.',
};

interface RunningReferenceServer {
  close(): Promise<void>;
  fetchPublic(url: string, init?: RequestInit): Promise<Response>;
  request: HttpPublishRequest;
  service: ReferencePublishService;
}

const runningServers: RunningReferenceServer[] = [];

async function requestBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : null;
}

function requestHeaders(request: IncomingMessage) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      value.forEach((entry) => headers.append(name, entry));
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

async function writeResponse(response: Response, target: ServerResponse) {
  response.headers.forEach((value, name) => target.setHeader(name, value));
  target.statusCode = response.status;
  target.end(Buffer.from(await response.arrayBuffer()));
}

async function startReferenceServer(): Promise<RunningReferenceServer> {
  const service = await ReferencePublishService.create(catalog, {
    publicOrigin,
    authorizeMutation: (request) => request.headers.get('authorization') === authorizationValue,
  });
  const server = createServer((incoming, outgoing) => {
    void (async () => {
      try {
        const method = incoming.method ?? 'GET';
        const body = await requestBody(incoming);
        const request = new Request(
          `http://${incoming.headers.host ?? '127.0.0.1'}${incoming.url ?? '/'}`,
          {
            method,
            headers: requestHeaders(incoming),
            body: method === 'GET' || method === 'HEAD' ? undefined : body,
          },
        );
        await writeResponse(await service.handle(request), outgoing);
      } catch {
        outgoing.statusCode = 500;
        outgoing.end();
      }
    })();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  const loopbackOrigin = `http://127.0.0.1:${address.port}`;
  const fetchPublic = (url: string, init?: RequestInit) => {
    const publicUrl = new URL(url);
    return fetch(`${loopbackOrigin}${publicUrl.pathname}`, init);
  };
  const running: RunningReferenceServer = {
    service,
    request: (url, init) => fetchPublic(url, init),
    fetchPublic,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
  runningServers.push(running);
  return running;
}

async function createCandidate() {
  const buildingPackage = structuredClone(ASTERION_PACKAGE);
  buildingPackage.building.name = 'Asterion reference service candidate';
  buildingPackage.manifest.contentHash = await calculatePackageContentHash(buildingPackage);
  const artifact = await createVenuePackageArtifact(buildingPackage);
  const dryRun = await createPublishDryRun(buildingPackage, artifact, catalog, options);
  return { artifact, buildingPackage, dryRun };
}

function authorizedTransport(server: RunningReferenceServer) {
  return new HttpPublishTransport({
    request: server.request,
    authorization: () => ({ Authorization: authorizationValue }),
  });
}

afterEach(async () => {
  await Promise.all(runningServers.splice(0).map((server) => server.close()));
});

describe('reference publishing service over loopback HTTP', () => {
  it('stores immutable bytes, commits one catalog release, and serves the artifact', async () => {
    const server = await startReferenceServer();
    const transport = authorizedTransport(server);
    const { artifact, dryRun } = await createCandidate();

    const receipt = await executePublishPlan(dryRun, artifact, transport);
    const snapshot = await transport.readCatalog(options.catalogUrl);
    const publishedRelease = snapshot.catalog.venues
      .flatMap((venue) => venue.releases)
      .find((release) => release.contentHash === artifact.contentHash);
    const artifactResponse = await server.fetchPublic(publishedRelease!.packageUrl);

    expect(receipt).toMatchObject({
      status: 'published',
      visibility: 'catalog-committed',
      transport: { kind: 'http', simulated: false, credentialsUsed: true },
    });
    expect(artifactResponse.status).toBe(200);
    expect(artifactResponse.headers.get('etag')).toBe(`"${artifact.artifactHash}"`);
    expect(await artifactResponse.text()).toBe(artifact.text);
    expect(server.service.getStats()).toMatchObject({
      catalogWrites: 1,
      packageWrites: 1,
      storedPackages: 1,
    });
  });

  it('replays a cataloged package as a fully idempotent publish', async () => {
    const server = await startReferenceServer();
    const transport = authorizedTransport(server);
    const { artifact, buildingPackage, dryRun } = await createCandidate();
    await executePublishPlan(dryRun, artifact, transport);
    const committed = await transport.readCatalog(options.catalogUrl);
    const idempotentPlan = await createPublishDryRun(
      buildingPackage,
      artifact,
      committed.catalog,
      options,
    );

    const receipt = await executePublishPlan(idempotentPlan, artifact, transport);

    expect(receipt).toMatchObject({
      status: 'already-published',
      package: { created: false },
      catalog: { changed: false },
      visibility: 'already-cataloged',
    });
    expect(server.service.getStats()).toMatchObject({
      catalogWrites: 1,
      packageWrites: 1,
      storedPackages: 1,
    });
  });

  it('allows only one concurrent publisher to commit a catalog revision', async () => {
    const server = await startReferenceServer();
    const transport = authorizedTransport(server);
    const { artifact, dryRun } = await createCandidate();

    const results = await Promise.allSettled([
      executePublishPlan(dryRun, artifact, transport),
      executePublishPlan(dryRun, artifact, transport),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected?.reason).toBeInstanceOf(PublishConflictError);
    expect(server.service.getStats()).toMatchObject({
      catalogWrites: 1,
      packageWrites: 1,
      storedPackages: 1,
    });
  });

  it('rejects mutations when no publishing authorization is supplied', async () => {
    const server = await startReferenceServer();
    const transport = new HttpPublishTransport({ request: server.request });
    const { artifact, dryRun } = await createCandidate();

    await expect(executePublishPlan(dryRun, artifact, transport)).rejects.toMatchObject({
      name: 'PublishTransportError',
      message: 'HTTP PUT failed with status 403.',
    });
    expect(server.service.getStats()).toMatchObject({
      catalogWrites: 0,
      packageWrites: 0,
      storedPackages: 0,
    });
  });
});
