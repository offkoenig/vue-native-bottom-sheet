// Copies src/BottomSheet.vue to dist/BottomSheet.vue.
// Needed because dist/index.js does `import BottomSheet from './BottomSheet.vue'`
// (a relative path) — the .vue file itself has to physically sit next to
// the built index.js for that import to resolve at the package consumer's end.
import { copyFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

mkdirSync(join(root, 'dist'), { recursive: true })
copyFileSync(join(root, 'src', 'BottomSheet.vue'), join(root, 'dist', 'BottomSheet.vue'))

console.log('✓ BottomSheet.vue copied into dist/')
