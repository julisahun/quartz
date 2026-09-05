import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      workbox: {
        // The app shell only. The API is never cached: a stale note is worse
        // than no note, and the local vault already answers offline reads.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/auth/, /^\/healthz/],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
      manifest: {
        name: 'quartz',
        short_name: 'quartz',
        description: 'Notes, offline first',
        theme_color: '#1c1b19',
        background_color: '#1c1b19',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      // `npm run dev` talks to a local server; same-origin keeps the cookie
      // behaviour identical to production.
      '/api': 'http://127.0.0.1:8086',
      '/auth': 'http://127.0.0.1:8086',
    },
  },
})
