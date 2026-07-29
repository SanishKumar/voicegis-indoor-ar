import { describe, expect, it } from 'vitest';
import catalogJson from '../../public/venues/catalog.json';
import { calculateTextSha256 } from '../data/contentDigest';
import { calculatePackageContentHash, stablePackageJson } from '../data/packageLifecycle';
import { parseVenueVersionCatalog } from '../data/venueVersionCatalog';
import { ASTERION_PACKAGE } from '../test/venueFixtures';
import {
  HttpPublishTransport,
  type HttpPublishAuthorizationContext,
  type HttpPublishRequest,
} from './httpPublishTransport';
import { createPublishDryRun } from './publishDryRun';
import {
  PublishConflictError,
  PublishTransportError,
  executePublishPlan,
} from './publishTransport';
import { createVenuePackageArtifact } from './venuePackageArtifact';

const catalog = parseVenueVersionCatalog(catalogJson);
const options = {
  packageBaseUrl: 'https://venues.example/releases',
  catalogUrl: 'https://venues.example/catalog.json',
  status: 'preview' as const,
  publishedAt: '2026-07-29T08:30:00.000Z',
  notes: 'Mocked HTTP transport candidate.',
};

async function createCandidate() {
  const buildingPackage = structuredClone(ASTERION_PACKAGE);
  buildingPackage.building.name = 'Asterion HTTP transport candidate';
  buildingPackage.manifest.contentHash = await calculatePackageContentHash(buildingPackage);
  const artifact = await createVenuePackageArtifact(buildingPackage);
  const dryRun = await createPublishDryRun(buildingPackage, artifact, catalog, options);
  return { artifact, dryRun };
}

describe('HTTP publishing transport', () => {
  it('executes the publish protocol through an injected request boundary', async () => {
    const { artifact, dryRun } = await createCandidate();
    const catalogRevision = await calculateTextSha256(stablePackageJson(catalog));
    const calls: Array<{
      url: string;
      method: string;
      headers: Headers;
      body: string | null;
      credentials: RequestCredentials | undefined;
      redirect: RequestRedirect | undefined;
    }> = [];
    const authorizationContexts: HttpPublishAuthorizationContext[] = [];
    const request: HttpPublishRequest = async (url, init) => {
      const method = init.method ?? 'GET';
      const body = typeof init.body === 'string' ? init.body : null;
      calls.push({
        url,
        method,
        headers: new Headers(init.headers),
        body,
        credentials: init.credentials,
        redirect: init.redirect,
      });
      if (method === 'GET') {
        return new Response(stablePackageJson(catalog), {
          status: 200,
          headers: { ETag: `"${catalogRevision}"` },
        });
      }
      if (method === 'PUT') {
        return new Response(null, {
          status: 201,
          headers: { ETag: `"${artifact.artifactHash}"` },
        });
      }
      const nextRevision = await calculateTextSha256(body!);
      return new Response(body, {
        status: 200,
        headers: { ETag: `"${nextRevision}"` },
      });
    };
    const transport = new HttpPublishTransport({
      request,
      authorization: (context) => {
        authorizationContexts.push(context);
        return { Authorization: 'Bearer mock-only-token' };
      },
    });

    const receipt = await executePublishPlan(dryRun, artifact, transport);

    expect(calls.map((call) => call.method)).toEqual(['GET', 'PUT', 'PATCH']);
    expect(authorizationContexts.map((context) => context.purpose)).toEqual([
      'catalog-read',
      'package-upload',
      'catalog-commit',
    ]);
    expect(calls.every((call) => call.credentials === 'omit')).toBe(true);
    expect(calls.every((call) => call.redirect === 'error')).toBe(true);
    expect(
      calls.every((call) => call.headers.get('authorization') === 'Bearer mock-only-token'),
    ).toBe(true);
    expect(calls[1].headers.get('if-none-match')).toBe('*');
    expect(calls[1].headers.get('x-voicegis-artifact-sha256')).toBe(artifact.artifactHash);
    expect(calls[2].headers.get('if-match')).toBe(`"${catalogRevision}"`);
    expect(receipt).toMatchObject({
      status: 'published',
      visibility: 'catalog-committed',
      transport: {
        kind: 'http',
        simulated: false,
        credentialsUsed: true,
      },
    });
  });

  it('fails closed when a catalog response lacks a deterministic strong ETag', async () => {
    const catalogRevision = await calculateTextSha256(stablePackageJson(catalog));
    const transport = new HttpPublishTransport({
      request: async () =>
        new Response(stablePackageJson(catalog), {
          status: 200,
          headers: { ETag: `W/"${catalogRevision}"` },
        }),
    });

    await expect(transport.readCatalog(options.catalogUrl)).rejects.toBeInstanceOf(
      PublishTransportError,
    );
  });

  it('treats an immutable precondition response with the same digest as idempotent', async () => {
    const artifact = await createVenuePackageArtifact(ASTERION_PACKAGE);
    const requestHeaders: Headers[] = [];
    const transport = new HttpPublishTransport({
      request: async (_url, init) => {
        requestHeaders.push(new Headers(init.headers));
        return new Response(null, {
          status: 412,
          headers: { ETag: `"${artifact.artifactHash}"` },
        });
      },
    });

    const result = await transport.putPackage({
      url: 'https://venues.example/releases/asterion.package.json',
      mediaType: artifact.mediaType,
      text: artifact.text,
      byteLength: artifact.byteLength,
      artifactHash: artifact.artifactHash,
    });

    expect(result).toEqual({ created: false, artifactHash: artifact.artifactHash });
    expect(requestHeaders[0].get('if-none-match')).toBe('*');
  });

  it('surfaces compare-and-swap conflicts with the server revision', async () => {
    const expectedRevision = await calculateTextSha256(stablePackageJson(catalog));
    const actualRevision = 'a'.repeat(64);
    const transport = new HttpPublishTransport({
      request: async () =>
        new Response(null, {
          status: 412,
          headers: { ETag: `"${actualRevision}"` },
        }),
    });

    await expect(
      transport.compareAndSwapCatalog(options.catalogUrl, expectedRevision, catalog),
    ).rejects.toMatchObject({
      name: 'PublishConflictError',
      expectedRevision,
      actualRevision,
      stage: 'catalog-commit',
      packageStored: true,
    } satisfies Partial<PublishConflictError>);
  });
});
