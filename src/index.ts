import type { App, Plugin } from 'vue'
import BottomSheet from './BottomSheet.vue'

export { BottomSheet }
export default BottomSheet

export type {
  BottomSheetProps,
  BottomSheetEmits,
  BottomSheetExposed,
  ClassValue,
} from './types'

/**
 * Опциональный Vue-плагин — регистрирует <BottomSheet> глобально, чтобы не
 * импортировать компонент в каждом файле. Использование не обязательно:
 * можно просто `import { BottomSheet } from 'vue-native-bottom-sheet'`
 * и использовать локально в конкретном компоненте.
 *
 * @example
 * import { createApp } from 'vue'
 * import { BottomSheetPlugin } from 'vue-native-bottom-sheet'
 *
 * createApp(App).use(BottomSheetPlugin).mount('#app')
 */
export interface BottomSheetPluginOptions {
  /** Имя, под которым регистрируется компонент. @default 'BottomSheet' */
  componentName?: string
}

export const BottomSheetPlugin: Plugin = {
  install(app: App, options?: BottomSheetPluginOptions) {
    app.component(options?.componentName ?? 'BottomSheet', BottomSheet)
  },
}
