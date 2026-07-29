import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import { stablePackageJson } from '../data/packageLifecycle';
import { verifyVenuePackage } from '../data/venuePackageContract';
import { calculateTextSha256, utf8ByteLength } from '../data/contentDigest';

export interface VenuePackageArtifact {
  fileName: string;
  mediaType: 'application/json';
  text: string;
  byteLength: number;
  buildingId: string;
  buildingName: string;
  contentHash: string;
  artifactHash: string;
  packageVersion: string;
  compilerVersion: string;
  counts: {
    floors: number;
    spaces: number;
    portals: number;
    connectors: number;
    pois: number;
    anchors: number;
    routingNodes: number;
    routingEdges: number;
  };
}

function safeArtifactId(buildingId: string) {
  const value = buildingId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return value || 'venue';
}

export async function createVenuePackageArtifact(
  buildingPackage: CompiledBuildingPackage,
): Promise<VenuePackageArtifact> {
  const verifiedPackage = await verifyVenuePackage(buildingPackage);
  const text = stablePackageJson(verifiedPackage);
  const contentHash = verifiedPackage.manifest.contentHash;
  const artifactHash = await calculateTextSha256(text);
  return {
    fileName: `${safeArtifactId(verifiedPackage.building.id)}.${contentHash.slice(0, 12)}.venue-package.json`,
    mediaType: 'application/json',
    text,
    byteLength: utf8ByteLength(text),
    buildingId: verifiedPackage.building.id,
    buildingName: verifiedPackage.building.name,
    contentHash,
    artifactHash,
    packageVersion: verifiedPackage.packageVersion,
    compilerVersion: verifiedPackage.compilerVersion,
    counts: {
      floors: verifiedPackage.floors.length,
      spaces: verifiedPackage.spaces.length,
      portals: verifiedPackage.portals.length,
      connectors: verifiedPackage.verticalConnectors.length,
      pois: verifiedPackage.pois.length,
      anchors: verifiedPackage.localizationAnchors.length,
      routingNodes: verifiedPackage.routing.nodes.length,
      routingEdges: verifiedPackage.routing.edges.length,
    },
  };
}

export function formatArtifactSize(byteLength: number) {
  if (byteLength < 1024) return `${byteLength} B`;
  if (byteLength < 1024 * 1024) return `${(byteLength / 1024).toFixed(1)} KB`;
  return `${(byteLength / (1024 * 1024)).toFixed(1)} MB`;
}
