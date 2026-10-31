import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(({ command }) => {
  // Builds must be production-flavoured even when a local `.env` carries
  // NODE_ENV=development: Vite surfaces that value as VITE_USER_NODE_ENV and
  // applies it AFTER the config resolves (see vite's resolveConfig), silently
  // emitting a DEVELOPMENT React bundle (warning strings included) whose chunk
  // hashes can never match the host's production build — the readiness check's
  // "live frontend matches dist/" comparison failed exactly here.
  // Two belts: force the env var, and stop builds from loading `.env` at all
  // (nothing in src/ reads import.meta.env, so builds need no vars from it).
  // Dev mode (`vite` / the dev middleware) keeps its current behaviour.
  const isBuild = command === 'build';
  if (isBuild) process.env.NODE_ENV = 'production';
  return {
    plugins: [react(), tailwindcss()],
    envDir: isBuild ? false : undefined,
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        // Two apps, two shells. `index.html` is the customer dashboard; `ops.html`
        // is the owner-only Ops Console served at `/ops`. Separate entries keep
        // the console out of the customer bundle entirely — a customer's browser
        // never downloads owner code it is not allowed to run anyway.
        input: {
          main: path.resolve(__dirname, 'index.html'),
          ops: path.resolve(__dirname, 'ops.html'),
        },
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      // Dev-only tunnel hosts. Without this Vite answers 403 "Blocked request.
      // This host is not allowed." when the app is opened through a tunnel,
      // which Meta needs in order to reach the OAuth callback and webhooks.
      // Add extra hosts through the ALLOWED_HOSTS env var (comma separated).
      allowedHosts: [
        'localhost',
        '.trycloudflare.com',
        '.ngrok-free.app',
        '.ngrok-free.dev',
        '.ngrok.io',
        '.loca.lt',
        ...(process.env.ALLOWED_HOSTS || '')
          .split(',')
          .map((host) => host.trim())
          .filter(Boolean),
      ],
    },
  };
});
