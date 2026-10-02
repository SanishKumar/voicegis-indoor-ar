// @ts-check
/*
 * Points a venue's catalog release at the package that is actually published.
 *
 *   node scripts/refreshCatalogRelease.mjs meridian-park-campus
 *
 * A release is identified by its package's content hash, so recompiling a
 * venue leaves the catalog naming a package that no longer exists. This
 * rewrites the venue's default release - id, hash and counts - from
 * public/venues/<id>.package.json. Everything else about the entry, and every
 * other venue, is left as it is.
 *
 * It is for a venue still being drawn. Once a release has been handed to
 * anyone, a change is a new release added beside it, not this.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const venueId = process.argv[2];
if (!venueId) {
  console.error('usage: node scripts/refreshCatalogRelease.mjs <venue-id>');
  process.exit(1);
}

const catalogPath = path.join(root, 'public', 'venues', 'catalog.json');
const raw = readFileSync(catalogPath, 'utf8');
const catalog = JSON.parse(raw);
const venue = catalog.venues.find((candidate) => candidate.id === venueId);
if (!venue) {
  console.error(`The catalog has no venue "${venueId}".`);
  process.exit(1);
}
const release = venue.releases.find((candidate) => candidate.releaseId === venue.defaultReleaseId);
if (!release) {
  console.error(`Venue "${venueId}" has no release "${venue.defaultReleaseId}".`);
  process.exit(1);
}

const published = JSON.parse(
  readFileSync(path.join(root, 'public', 'venues', `${venueId}.package.json`), 'utf8'),
);
const hash = published.manifest.contentHash;
const releaseId = `${published.packageVersion}+${hash.slice(0, 12)}`;
if (release.contentHash === hash) {
  console.log(`${venueId} is already at ${releaseId}`);
  process.exit(0);
}

Object.assign(release, {
  releaseId,
  packageVersion: published.packageVersion,
  compilerVersion: published.compilerVersion,
  sourceSchemaVersion: published.sourceSchemaVersion,
  contentHash: hash,
  summary: {
    floors: published.floors.length,
    spaces: published.spaces.length,
    portals: published.portals.length,
    connectors: published.verticalConnectors.length,
    pois: published.pois.length,
    anchors: published.localizationAnchors.length,
  },
});
venue.defaultReleaseId = releaseId;

const text = `${JSON.stringify(catalog, null, 2)}\n`;
writeFileSync(catalogPath, raw.includes('\r\n') ? text.replace(/\n/g, '\r\n') : text);
console.log(`${venueId} -> ${releaseId}`);
