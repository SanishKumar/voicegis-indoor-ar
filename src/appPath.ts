/**
 * The few URLs that name a place on the server rather than one beside the page.
 *
 * Venue catalogs name their packages root-relative (`/venues/…`), and those
 * names are also the packages' identities in storage and in the catalog. At a
 * domain root they can be fetched as written; under a project site, such as
 * GitHub Pages' `/voicegis-indoor-ar/`, they point outside the app. They are
 * resolved under the base only at the moment of fetching, so a stored identity
 * names the same package wherever the app happens to be hosted.
 */
export function underBase(path: string, base: string): string {
  // Only a root-relative path is the app's to move; a URL or a relative one is left alone.
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  const root = base.endsWith('/') ? base.slice(0, -1) : base;
  if (root === '' || path === root || path.startsWith(`${root}/`)) return path;
  return `${root}${path}`;
}

/** The base the build was made for: `/` at a domain root. */
export const APP_BASE: string = import.meta.env.BASE_URL;

export function appPath(path: string): string {
  return underBase(path, APP_BASE);
}
