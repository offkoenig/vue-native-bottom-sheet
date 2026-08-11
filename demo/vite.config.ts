import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Инлайнит весь JS/CSS прямо в index.html — получается один
// самодостаточный файл, который можно открыть двойным кликом, без сервера.
export default defineConfig({
  root: __dirname,
  plugins: [vue(), viteSingleFile()],
  build: {
    outDir: resolve(__dirname, '../demo-dist'),
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
  },
})
