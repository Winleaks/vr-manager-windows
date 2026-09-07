import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react({}),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          define: {
            __VR_HUB_GOOGLE_CLIENT_ID__: JSON.stringify(process.env.VR_HUB_GOOGLE_CLIENT_ID || ''),
            __VR_HUB_GOOGLE_CLIENT_SECRET__: JSON.stringify(process.env.VR_HUB_GOOGLE_CLIENT_SECRET || ''),
          },
          build: {
            rollupOptions: {
              external: ['better-sqlite3']
            }
          }
        }
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload()
        },
      },
    ]),
    renderer(),
  ],
  server: {
    fs: {
      strict: false,
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
