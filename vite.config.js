import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { offlineServiceWorkerPlugin } from './scripts/offlineServiceWorkerPlugin.js';

/**
 * `npm run dev:mobile` serves over HTTPS on every network interface.
 *
 * Not a convenience. Safari and Chrome both gate the motion and orientation
 * sensors behind a secure context, and `localhost` is the only insecure origin
 * they treat as one — so a phone loading `http://192.168.x.x:3000` is handed no
 * sensors at all, silently. iOS additionally refuses to show the motion
 * permission prompt outside a secure context, which is what makes the recorder
 * look broken rather than blocked.
 *
 * Selected by Vite's own `--mode` rather than an environment variable, because
 * `MOBILE=1 vite` is a bare-word syntax error in the Windows shell npm uses.
 *
 * The certificate is self-signed, so the phone shows a warning that has to be
 * accepted once per device. That is the whole cost of the mobile path.
 */
/** The commit a build was made from, so a report from a phone says which build it came from. */
function revision() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig(({ mode }) => {
  const mobile = mode === 'mobile';
  const publicBuild = mode === 'public';
  return {
    plugins: mobile ? [react(), basicSsl()] : [react(), offlineServiceWorkerPlugin(publicBuild)],
    define: {
      __APP_REVISION__: JSON.stringify(revision()),
    },
    resolve: {
      alias: {
        '#voicegis-app': fileURLToPath(
          new URL(publicBuild ? './src/PublicApp.jsx' : './src/App.jsx', import.meta.url),
        ),
      },
    },
    server: {
      port: Number(process.env.PORT) || 3000,
      open: !mobile,
      // Bind every interface so the phone can reach this machine on the LAN.
      host: mobile ? true : undefined,
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
  };
});
