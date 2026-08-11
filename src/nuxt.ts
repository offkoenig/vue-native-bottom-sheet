import { defineNuxtModule, addComponent, createResolver } from '@nuxt/kit'

export interface ModuleOptions {
  /** The name the component is globally available under (auto-import). @default 'BottomSheet' */
  componentName?: string
}

/**
 * Nuxt 3 module for vue-native-bottom-sheet.
 *
 * Does nothing beyond registering the component: styles live inside
 * BottomSheet.vue itself (<style scoped>) and get picked up by Nuxt/Vite's
 * standard build exactly like any other .vue component — no separate CSS
 * file needs to be imported.
 *
 * @example nuxt.config.ts
 * export default defineNuxtConfig({
 *   modules: ['vue-native-bottom-sheet/nuxt'],
 *   // optional:
 *   nativeBottomSheet: { componentName: 'BottomSheet' },
 * })
 */
export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'vue-native-bottom-sheet',
    configKey: 'nativeBottomSheet',
  },
  defaults: {
    componentName: 'BottomSheet',
  },
  setup(options) {
    const resolver = createResolver(import.meta.url)

    addComponent({
      name: options.componentName ?? 'BottomSheet',
      filePath: resolver.resolve('./BottomSheet.vue'),
    })
  },
})
