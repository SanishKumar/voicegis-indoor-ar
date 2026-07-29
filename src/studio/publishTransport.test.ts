import { describe, expect, it } from 'vitest';
import catalogJson from '../../public/venues/catalog.json';
import { calculatePackageContentHash } from '../data/packageLifecycle';
import { parseVenueVersionCatalog } from '../data/venueVersionCatalog';
import { ASTERION_PACKAGE } from '../test/venueFixtures';
import { createPublishDryRun } from './publishDryRun';
import {
  InMemoryPublishTransport,
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
  notes: 'Provider-neutral transport candidate.',
};

async function createCandidate() {
  const buildingPackage = structuredClone(ASTERION_PACKAGE);
  buildingPackage.building.name = 'Asterion University Medical Center transport candidate';
  buildingPackage.manifest.contentHash = await calculatePackageContentHash(buildingPackage);
  const artifact = await createVenuePackageArtifact(buildingPackage);
  const dryRun = await createPublishDryRun(buildingPackage, artifact, catalog, options);
  return { buildingPackage, artifact, dryRun };
}

describe('provider-neutral publishing transport', () => {
  it('uploads immutable bytes before atomically exposing the release in catalog', async () => {
    const { artifact, dryRun } = await createCandidate();
    const transport = await InMemoryPublishTransport.create(catalog);
    const receipt = await executePublishPlan(dryRun, artifact, transport);
    const snapshot = await transport.readCatalog(options.catalogUrl);
    const venue = snapshot.catalog.venues.find(
      (candidate) => candidate.id === ASTERION_PACKAGE.building.id,
    )!;

    expect(receipt).toMatchObject({
      status: 'published',
      visibility: 'catalog-committed',
      package: { created: true, artifactHash: artifact.artifactHash },
      catalog: { changed: true, defaultReleaseChanged: false },
      transport: { kind: 'memory-simulator', simulated: true, credentialsUsed: false },
    });
    expect(venue.releases.some((release) => release.contentHash === artifact.contentHash)).toBe(
      true,
    );
    expect(venue.defaultReleaseId).toBe(catalog.venues[0].defaultReleaseId);
    expect(transport.getStats()).toMatchObject({
      packageWrites: 1,
      catalogWrites: 1,
      storedPackages: 1,
    });
  });

  it('treats an existing catalog release as an idempotent catalog no-op', async () => {
    const artifact = await createVenuePackageArtifact(ASTERION_PACKAGE);
    const dryRun = await createPublishDryRun(ASTERION_PACKAGE, artifact, catalog, options);
    const transport = await InMemoryPublishTransport.create(catalog);
    const receipt = await executePublishPlan(dryRun, artifact, transport);

    expect(receipt.status).toBe('already-published');
    expect(receipt.catalog.changed).toBe(false);
    expect(transport.getStats()).toMatchObject({ packageWrites: 1, catalogWrites: 0 });
  });

  it('rejects a stale catalog revision before uploading package bytes', async () => {
    const { artifact, dryRun } = await createCandidate();
    const transport = await InMemoryPublishTransport.create(catalog);
    await transport.simulateConcurrentCatalogUpdate();

    await expect(executePublishPlan(dryRun, artifact, transport)).rejects.toMatchObject({
      name: 'PublishConflictError',
      stage: 'preflight',
      packageStored: false,
    });
    expect(transport.getStats()).toMatchObject({
      packageWrites: 0,
      catalogWrites: 0,
      storedPackages: 0,
    });
  });

  it('allows only one of two concurrent publishers to commit the catalog revision', async () => {
    const { artifact, dryRun } = await createCandidate();
    const transport = await InMemoryPublishTransport.create(catalog);
    const results = await Promise.allSettled([
      executePublishPlan(dryRun, artifact, transport),
      executePublishPlan(dryRun, artifact, transport),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected?.reason).toBeInstanceOf(PublishConflictError);
    expect(transport.getStats()).toMatchObject({
      packageWrites: 1,
      catalogWrites: 1,
      storedPackages: 1,
    });
  });

  it('rejects modified package bytes before invoking the transport', async () => {
    const { artifact, dryRun } = await createCandidate();
    const transport = await InMemoryPublishTransport.create(catalog);
    const tampered = { ...artifact, text: `${artifact.text}\n` };

    await expect(executePublishPlan(dryRun, tampered, transport)).rejects.toBeInstanceOf(
      PublishTransportError,
    );
    expect(transport.getStats()).toMatchObject({ packageWrites: 0, catalogWrites: 0 });
  });
});
