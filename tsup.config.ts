import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    // Declarations are emitted separately via vue-tsc (build:types) — it can
    // correctly analyze .vue SFC types through defineProps/defineEmits,
    // which plain esbuild/tsup can't do.
    dts: false,
    // false because the .d.ts files from the build:types step land in the
    // same dist/ — we don't want this step wiping them regardless of run order.
    clean: false,
    // BottomSheet.vue isn't bundled: esbuild can't parse .vue syntax, and
    // it doesn't need to — the component ships as source and gets compiled
    // by whichever tool (Vite/webpack) the package consumer already has.
    external: [/\.vue$/],
    target: 'es2022',
    sourcemap: true,
    outExtension({ format }) {
      return { js: format === 'cjs' ? '.cjs' : '.js' }
    },
  },
  {
    // The Nuxt module is built as ESM only: Nuxt 3 is itself ESM-first and
    // loads modules via import, and the resolver inside relies on
    // import.meta.url, which is always empty in a CJS build. A CJS variant
    // here would technically be a valid file but guaranteed broken when
    // called — better not to ship it at all than to ship it non-working.
    entry: { nuxt: 'src/nuxt.ts' },
    format: ['esm'],
    dts: false,
    clean: false,
    external: [/\.vue$/, '@nuxt/kit', '@nuxt/schema'],
    target: 'es2022',
    sourcemap: true,
  },
])
