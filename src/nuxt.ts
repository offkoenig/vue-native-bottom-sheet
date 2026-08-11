import { defineNuxtModule, addComponent, createResolver } from '@nuxt/kit'

export interface ModuleOptions {
  /** Имя, под которым компонент доступен глобально (авто-импорт). @default 'BottomSheet' */
  componentName?: string
}

/**
 * Nuxt 3 модуль для vue-native-bottom-sheet.
 *
 * Ничего, кроме регистрации компонента, не делает: стили лежат внутри
 * самого BottomSheet.vue (<style scoped>) и подхватываются штатной сборкой
 * Nuxt/Vite точно так же, как для любого другого .vue-компонента — никакого
 * отдельного CSS-файла подключать не нужно.
 *
 * @example nuxt.config.ts
 * export default defineNuxtConfig({
 *   modules: ['vue-native-bottom-sheet/nuxt'],
 *   // необязательно:
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
