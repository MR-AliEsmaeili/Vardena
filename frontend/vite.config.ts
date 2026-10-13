import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

/**
 * Vite configuration (ADR-0002: React + TypeScript + Vite + Tailwind).
 *
 * The SPA talks only to the Vardena API (AR-19). The browser always calls a
 * RELATIVE base URL (`VITE_API_BASE_URL`, default `/api/v1`), so:
 *   - `npm run dev` proxies `/api` to the local API process;
 *   - a deployment serves the static build behind a reverse proxy that
 *     forwards `/api` to the API container.
 * No production host is ever hard-coded in the source.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const apiProxyTarget =
    env['VITE_DEV_API_PROXY_TARGET'] ?? 'http://localhost:3000';

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      // Bind on all interfaces so the dev server is reachable from a remote
      // browser / container preview. Dev server only — the production
      // artifact is a static bundle served by a real web server.
      host: true,
      port: 5173,
      allowedHosts: true,
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: true,
      port: 4173,
      allowedHosts: true,
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      rollupOptions: {
        output: {
          // Split the fixed stack into stable vendor chunks so a UI change
          // does not invalidate the whole bundle in the browser cache.
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            data: ['@tanstack/react-query', '@tanstack/react-table', 'axios'],
            forms: ['react-hook-form', '@hookform/resolvers', 'zod'],
          },
        },
      },
    },
  };
});
