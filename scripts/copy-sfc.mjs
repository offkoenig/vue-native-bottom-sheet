// Копирует src/BottomSheet.vue в dist/BottomSheet.vue.
// Нужен, потому что dist/index.js делает `import BottomSheet from './BottomSheet.vue'`
// (относительный путь) — рядом с собранным index.js должен физически лежать
// сам .vue-файл, чтобы этот импорт резолвился у потребителя пакета.
import { copyFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

mkdirSync(join(root, 'dist'), { recursive: true })
copyFileSync(join(root, 'src', 'BottomSheet.vue'), join(root, 'dist', 'BottomSheet.vue'))

console.log('✓ BottomSheet.vue скопирован в dist/')
