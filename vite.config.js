import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

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
export default defineConfig(({ mode }) => {
  const mobile = mode === 'mobile'
  return {
    plugins: mobile ? [react(), basicSsl()] : [react()],
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
  }
})
