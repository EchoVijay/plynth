import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'favicon-32.png', 'favicon-16.png', 'apple-touch-icon.png', 'logo.png', 'logo-128.png', 'robots.txt'],
      workbox: {
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        globIgnores: ['**/mediapipe/**'],
        runtimeCaching: [{
          urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith('/mediapipe/'),
          handler: 'CacheFirst',
          options: { cacheName: 'focus-monitor-models', expiration: { maxEntries: 8 }, cacheableResponse: { statuses: [200] } },
        }],
      },
      manifest: {
        name: 'Plynth',
        short_name: 'Plynth',
        description: 'Personal AI Dashboard',
        theme_color: '#0b1020',
        background_color: '#0b1020',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../supabase/functions/_shared/pure'),
    },
  },
  server: { port: 5173, host: true, allowedHosts: true, fs: { allow: ['..'] } },
});
