import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    // Декларации эмитятся отдельно через vue-tsc (build:types) — он умеет
    // корректно анализировать типы .vue SFC через defineProps/defineEmits,
    // чего чистый esbuild/tsup сделать не может.
    dts: false,
    // false, потому что .d.ts из шага build:types кладутся в ту же dist/ —
    // не хотим, чтобы этот шаг их стирал вне зависимости от порядка запуска.
    clean: false,
    // BottomSheet.vue не бандлится: esbuild не умеет парсить .vue-синтаксис,
    // да это и не нужно — компонент поставляется исходником и компилируется
    // уже тем инструментом (Vite/webpack), который есть у потребителя пакета.
    external: [/\.vue$/],
    target: 'es2022',
    sourcemap: true,
    outExtension({ format }) {
      return { js: format === 'cjs' ? '.cjs' : '.js' }
    },
  },
  {
    // Nuxt-модуль собираем только в ESM: Nuxt 3 сам по себе ESM-first и
    // грузит модули через import, а resolver внутри опирается на
    // import.meta.url, который в CJS-сборке всегда пуст. CJS-вариант тут
    // был бы формально рабочим файлом, но заведомо сломанным при вызове —
    // лучше его не поставлять вовсе, чем поставлять неработающим.
    entry: { nuxt: 'src/nuxt.ts' },
    format: ['esm'],
    dts: false,
    clean: false,
    external: [/\.vue$/, '@nuxt/kit', '@nuxt/schema'],
    target: 'es2022',
    sourcemap: true,
  },
])
