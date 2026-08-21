import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import QRCode from 'qrcode';
import { scannableAnchors, type AnchorLike } from '../src/capture/anchorCheckIn';

/**
 * Builds the printable sheet of check-in codes for every compiled venue.
 *
 * The codes are generated from the compiled package rather than authored
 * alongside it, so a printed sign can never encode a payload the venue does not
 * actually publish. Recompile a venue and regenerate; a sign that stops
 * resolving is then a visible diff rather than a mystery in a corridor.
 *
 * Output lands in `public/`, so it is served by the dev server at
 * /check-in-codes.html. That is the demo path: open it on a laptop, scan it
 * with a phone. Printing it is the field path.
 */

const VENUES = ['reference-medical-centre', 'asterion-medical-center', 'harbor-exchange'];

interface CompiledPackage {
  building: { id: string; name?: string };
  manifest: { contentHash: string };
  localizationAnchors: AnchorLike[];
  floors: Array<{ id: string; name?: string }>;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function cardFor(anchor: AnchorLike, floorName: string) {
  // Error correction M with a quiet zone: a sign gets scanned in bad corridor
  // light at an angle, which is exactly the case a tight margin fails.
  const svg = await QRCode.toString(anchor.payload, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 260,
  });
  return `      <article class="card">
        <div class="code">${svg}</div>
        <h2>${escapeHtml(floorName)}</h2>
        <p class="where">${escapeHtml(anchor.id)} &middot; ${anchor.position[0]}, ${anchor.position[1]} m</p>
        <p class="payload">${escapeHtml(anchor.payload)}</p>
      </article>`;
}

async function sheetFor(venue: string) {
  const path = resolve(`buildings/${venue}/compiled/building.package.json`);
  const pkg = JSON.parse(await readFile(path, 'utf8')) as CompiledPackage;
  const floorNames = new Map(pkg.floors.map((floor) => [floor.id, floor.name ?? floor.id]));
  const anchors = scannableAnchors(pkg.localizationAnchors).sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );

  const cards = await Promise.all(
    anchors.map((anchor) => cardFor(anchor, floorNames.get(anchor.floorId) ?? anchor.floorId)),
  );

  return `    <section class="venue">
      <header>
        <h1>${escapeHtml(pkg.building.name ?? pkg.building.id)}</h1>
        <p>${escapeHtml(pkg.building.id)} &middot; package ${pkg.manifest.contentHash.slice(0, 12)} &middot; ${anchors.length} check-in point(s)</p>
      </header>
      <div class="grid">
${cards.join('\n')}
      </div>
    </section>`;
}

async function main() {
  const sections = await Promise.all(VENUES.map(sheetFor));
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>VoiceGIS check-in codes</title>
    <style>
      :root { color-scheme: light; }
      body { margin: 0; padding: 32px; background: #fff; color: #111;
             font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
      .lede { max-width: 60ch; margin: 0 0 28px; color: #444; line-height: 1.55; }
      .venue { margin: 0 0 44px; }
      .venue > header { border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 20px; }
      .venue h1 { margin: 0; font-size: 20px; }
      .venue header p { margin: 4px 0 0; font-size: 12px; color: #555;
                        font-family: ui-monospace, monospace; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 20px; }
      .card { border: 1px solid #ccc; border-radius: 10px; padding: 14px; text-align: center;
              break-inside: avoid; }
      .code svg { width: 100%; height: auto; display: block; }
      .card h2 { margin: 10px 0 2px; font-size: 15px; }
      .where { margin: 0; font-size: 12px; color: #555; }
      .payload { margin: 6px 0 0; font-size: 10px; color: #777; word-break: break-all;
                 font-family: ui-monospace, monospace; }
      @media print { body { padding: 0; } .lede { display: none; } }
    </style>
  </head>
  <body>
    <p class="lede">
      Check-in codes generated from the compiled venue packages. Scanning one tells
      the app which anchor the package declares you are standing at, with no beacons
      and no lookup service &mdash; how well that matches the building depends
      entirely on each sign being placed at the position printed on its card, which
      is a physical measurement and is not automated. These venues are synthetic
      fixtures. Print the cards and place them, or display this page on a screen and
      scan it with the app.
    </p>
${sections.join('\n')}
  </body>
</html>
`;

  const out = resolve('public/check-in-codes.html');
  const total = html.split('<article class="card">').length - 1;

  // --check exists so the committed sheet cannot drift away from the packages
  // it claims to describe. A sign encoding a payload the venue no longer
  // publishes is the failure that looks fine on screen and fails in a corridor,
  // so it is a gate rather than a convention.
  if (process.argv.includes('--check')) {
    const existing = await readFile(out, 'utf8').catch(() => null);
    if (existing === null) {
      throw new Error(`No generated sheet at ${out}. Run: npm run codes`);
    }
    if (existing !== html) {
      throw new Error(
        `The check-in code sheet is stale: ${out} is not what the compiled packages produce now. Run: npm run codes`,
      );
    }
    process.stdout.write(`verified check-in codes (${total} codes)
`);
    return;
  }

  await writeFile(out, html, 'utf8');
  process.stdout.write(`wrote ${out} (${total} codes)
`);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
