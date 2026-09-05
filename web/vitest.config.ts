import { defineConfig } from 'vitest/config'

// Kept apart from vite.config.ts: vitest ships its own Vite, and the two
// plugin type universes do not agree in one file.
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
  },
})
