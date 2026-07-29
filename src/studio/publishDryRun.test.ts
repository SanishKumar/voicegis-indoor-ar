import { describe, expect, it } from 'vitest';
import catalogJson from '../../public/venues/catalog.json';
import { calculatePackageContentHash } from '../data/packageLifecycle';
import { parseVenueVersionCatalog } from '../data/venueVersionCatalog';
import { ASTERION_PACKAGE } from '../test/venueFixtures';
import { createVenuePackageArtifact } from './venuePackageArtifact';
import { PublishDryRunError, createPublishDryRun } from './publishDryRun';

const catalog = parseVenueVersionCatalog(catalogJson);
const options = {
  packageBaseUrl: 'https://venues.example/releases',
  catalogUrl: 'https://venues.example/catalog.json',
  status: 'preview' as const,
  publishedAt: '2026-07-29T08:30:00.000Z',
  notes: 'Reviewable Studio release candidate.',
};

async function createUncatalogedPackage() {
  const buildingPackage = structuredClone(ASTERION_PACKAGE);
  buildingPackage.building.name = 'Asterion University Medical Center vNext';
  buildingPackage.manifest.contentHash = await calculatePackageContentHash(buildingPackage);
  return buildingPackage;
}

describe('Studio publishing dry run', () => {
  it('creates a deterministic, non-executing publish plan', async () => {
    const buildingPackage = await createUncatalogedPackage();
    const artifact = await createVenuePackageArtifact(buildingPackage);
    const first = await createPublishDryRun(buildingPackage, artifact, catalog, options);
    const second = await createPublishDryRun(buildingPackage, artifact, catalog, options);

    expect(first.text).toBe(second.text);
    expect(first.planHash).toBe(second.planHash);
    expect(first.plan.catalogProposal).toMatchObject({
      action: 'append-release',
      currentDefaultReleaseId: catalog.venues[0].defaultReleaseId,
      nextDefaultReleaseId: catalog.venues[0].defaultReleaseId,
    });
    expect(first.plan.release).toMatchObject({
      contentHash: buildingPackage.manifest.contentHash,
      packageVersion: buildingPackage.packageVersion,
      compilerVersion: buildingPackage.compilerVersion,
      sourceSchemaVersion: buildingPackage.sourceSchemaVersion,
    });
    expect(first.plan.operations).toEqual([
      expect.objectContaining({ sequence: 1, method: 'PUT', execute: false }),
      expect.objectContaining({ sequence: 2, method: 'PATCH', execute: false }),
    ]);
    expect(first.plan.safety).toEqual({
      networkRequests: 0,
      catalogWrites: 0,
      credentialsUsed: false,
      runtimeActivation: false,
    });
  });

  it('marks an already cataloged content hash as an idempotent no-op', async () => {
    const artifact = await createVenuePackageArtifact(ASTERION_PACKAGE);
    const result = await createPublishDryRun(ASTERION_PACKAGE, artifact, catalog, options);

    expect(result.plan.catalogProposal.action).toBe('no-op');
  });

  it('rejects non-HTTPS or credential-bearing targets', async () => {
    const artifact = await createVenuePackageArtifact(ASTERION_PACKAGE);

    await expect(
      createPublishDryRun(ASTERION_PACKAGE, artifact, catalog, {
        ...options,
        packageBaseUrl: 'http://venues.example/releases',
      }),
    ).rejects.toBeInstanceOf(PublishDryRunError);
    await expect(
      createPublishDryRun(ASTERION_PACKAGE, artifact, catalog, {
        ...options,
        catalogUrl: 'https://user:secret@venues.example/catalog.json',
      }),
    ).rejects.toBeInstanceOf(PublishDryRunError);
  });

  it('rejects an archived status for a new release', async () => {
    const artifact = await createVenuePackageArtifact(ASTERION_PACKAGE);

    await expect(
      createPublishDryRun(ASTERION_PACKAGE, artifact, catalog, {
        ...options,
        status: 'archived' as never,
      }),
    ).rejects.toThrow('must use preview or stable status');
  });

  it('rejects a staged artifact that differs from verified compiler output', async () => {
    const artifact = await createVenuePackageArtifact(ASTERION_PACKAGE);
    const mismatched = { ...artifact, text: `${artifact.text}\n` };

    await expect(
      createPublishDryRun(ASTERION_PACKAGE, mismatched, catalog, options),
    ).rejects.toThrow('does not match the verified compiler output');
  });

  it('does not create new catalog venues implicitly', async () => {
    const buildingPackage = structuredClone(ASTERION_PACKAGE);
    buildingPackage.building.id = 'uncataloged-venue';
    buildingPackage.manifest.contentHash = await calculatePackageContentHash(buildingPackage);
    const artifact = await createVenuePackageArtifact(buildingPackage);

    await expect(createPublishDryRun(buildingPackage, artifact, catalog, options)).rejects.toThrow(
      'Creating new catalog venues is outside Publishing v0',
    );
  });
});
