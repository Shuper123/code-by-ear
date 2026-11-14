import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { VitePWA } from 'vite-plugin-pwa'
import { buildInfo } from './scripts/build_info.mjs'

export default defineConfig({
  base: '/code-by-ear/',
  define: { __BUILD__: JSON.stringify(buildInfo()) },
  build: { target: 'es2022', sourcemap: false },
  worker: { format: 'es' },
  plugins: [
    preact(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        id: '/code-by-ear/',
        name: 'Code by Ear',
        short_name: 'Code by Ear',
        description: 'Hands-free SQL and Python practice.',
        start_url: '/code-by-ear/',
        scope: '/code-by-ear/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0e1013',
        theme_color: '#0e1013',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,json,sql,wasm,webmanifest}'],
        globIgnores: ['runtimes/pyodide/**'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/runtimes/pyodide/'),
            handler: 'CacheFirst',
            options: { cacheName: 'pyodide-runtime', expiration: { maxEntries: 40 } },
          },
        ],
      },
    }),
  ],
})
