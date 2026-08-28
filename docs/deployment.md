# Deploying the visitor build

`npm run build` produces the public visitor application in `dist/`. Inspector,
Studio, Recorder, their routes, and their JavaScript rendering dependencies are
not in the public entry graph. The application still uses a shared stylesheet,
so that CSS file contains selectors for operator surfaces; CSS-selector absence
is not the isolation boundary. It also shares the venue provider with the
operator build, so unused package activation/rollback helpers remain in the
main bundle even though the public application exposes no route or control that
can call them.

Operators use `npm run build:operator` or the development server on a
**different origin** (a different host or port). Never replace the visitor files
with the operator build at the same origin: the installed root-scoped visitor
worker correctly keeps serving its complete cached revision, so the operator
entry document would not load until every visitor registration and cache had
been removed out of band.

## Required gate

```bash
npm ci
npm run check
npm run test:browser
npm run build
```

The offline browser job performs a successful online installation, clears
Chromium's ordinary HTTP cache, closes the page, disables Chromium's network,
and opens a fresh page. It confirms the document and script came from the
worker before switching floors, checking in, and computing a route. It also
proves an evicted precache is reported unavailable and repaired only from the
current build bytes, a re-hashed IndexedDB fallback works when venue HTTP
responses are absent, and a self-consistent package stored under another
venue's identity is refused.

A separate isolated-output run exercises the worker lifecycle itself: a bad
first install settles to an online-only UI, a complete replacement waits while
the old client continues to receive one coherent old revision, and a later
replacement with a digest mismatch becomes redundant without displacing the
active known-good cache.

## Hosting contract

Serve the contents of `dist/` at the domain root over HTTPS. The current URLs
are root-relative (`/assets`, `/venues`, `/sw.js`), so a subdirectory deployment
is not supported without making those paths base-aware first.

Recommended response caching:

| Path                     | Cache policy                                         |
| ------------------------ | ---------------------------------------------------- |
| `/sw.js`                 | `Cache-Control: no-cache`                            |
| `/index.html`            | `Cache-Control: no-cache`                            |
| `/venues/catalog.json`   | `Cache-Control: no-cache`                            |
| `/venues/*.package.json` | revalidate (`no-cache` or a zero max-age)            |
| `/assets/*`              | `Cache-Control: public, max-age=31536000, immutable` |

Upload hashed assets first, then the venue packages and catalog, then
`index.html`, and publish `sw.js` last. The generated worker does not call
`skipWaiting`: a complete update waits until existing clients release the old
worker. While it waits, that worker continues to serve its own cached document,
catalog, packages, and assets as one revision; it never combines a new shell
with old venue data. A failed install leaves the preceding worker and cache
active, and old VoiceGIS caches are deleted only after the replacement
activates.

## Exact offline promise

After one completed online installation, while the browser retains the installed
storage, a fresh page can load the visitor shell and bundled venues without a
connection. Navigation requests, including check-in and venue query parameters,
fall back to the cached root document without storing one cache entry per query.
The active IndexedDB package is SHA-256 verified again before it can be used as
a fallback. Browsers may evict site storage: an open app detects that loss and
reports or repairs it, but no code can cold-start after the browser has removed
the document itself.

A first-ever visit while already offline is impossible. A coherently modified
server deployment, HTTPS certificate failure, arbitrary cross-origin venue URL,
and physical QR placement are outside this cache guarantee. Deployment itself
has not been performed by this repository.
