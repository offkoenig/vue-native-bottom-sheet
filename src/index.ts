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
 * Optional Vue plugin — registers <BottomSheet> globally, so it doesn't
 * need importing into every file. Usage is optional: you can just
 * `import { BottomSheet } from 'vue-native-bottom-sheet'` and use it
 * locally in a specific component.
 *
 * @example
 * import { createApp } from 'vue'
 * import { BottomSheetPlugin } from 'vue-native-bottom-sheet'
 *
 * createApp(App).use(BottomSheetPlugin).mount('#app')
 */
export interface BottomSheetPluginOptions {
  /** The name the component is registered under. @default 'BottomSheet' */
  componentName?: string
}

export const BottomSheetPlugin: Plugin = {
  install(app: App, options?: BottomSheetPluginOptions) {
    app.component(options?.componentName ?? 'BottomSheet', BottomSheet)
  },
}
