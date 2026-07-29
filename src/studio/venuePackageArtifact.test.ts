import { describe, expect, it } from 'vitest';
import asterionPackage from '../../buildings/asterion-medical-center/compiled/building.package.json';
import { VenuePackageVerificationError } from '../data/venuePackageContract';
import { createVenuePackageArtifact, formatArtifactSize } from './venuePackageArtifact';

describe('Venue Studio package artifact', () => {
  it('creates a canonical, runtime-verified download artifact', async () => {
    const artifact = await createVenuePackageArtifact(asterionPackage as never);
    const parsed = JSON.parse(artifact.text);

    expect(artifact.fileName).toBe(
      `asterion-medical-center.${asterionPackage.manifest.contentHash.slice(0, 12)}.venue-package.json`,
    );
    expect(artifact.contentHash).toBe(asterionPackage.manifest.contentHash);
    expect(artifact.artifactHash).toMatch(/^[a-f0-9]{64}$/);
    expect(artifact.byteLength).toBe(new TextEncoder().encode(artifact.text).byteLength);
    expect(artifact.counts).toMatchObject({
      floors: asterionPackage.floors.length,
      routingNodes: asterionPackage.routing.nodes.length,
      routingEdges: asterionPackage.routing.edges.length,
    });
    expect(parsed.manifest).toEqual(asterionPackage.manifest);
    expect(artifact.text.endsWith('\n')).toBe(true);
  });

  it('is byte-for-byte deterministic for equivalent packages', async () => {
    const first = await createVenuePackageArtifact(asterionPackage as never);
    const second = await createVenuePackageArtifact(structuredClone(asterionPackage) as never);

    expect(second.fileName).toBe(first.fileName);
    expect(second.text).toBe(first.text);
    expect(second.byteLength).toBe(first.byteLength);
    expect(second.artifactHash).toBe(first.artifactHash);
  });

  it('refuses to package tampered compiler output', async () => {
    const tampered = structuredClone(asterionPackage);
    tampered.building.name = 'Tampered venue';

    await expect(createVenuePackageArtifact(tampered as never)).rejects.toBeInstanceOf(
      VenuePackageVerificationError,
    );
  });

  it('formats artifact sizes for review', () => {
    expect(formatArtifactSize(512)).toBe('512 B');
    expect(formatArtifactSize(2048)).toBe('2.0 KB');
  });
});
